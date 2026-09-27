"""Turn raw detections into a plain-language readout, for one driver or the
whole fleet.

Claude sees only the aggregated numbers below, never raw sensor samples, and
it is asked to summarise, not diagnose: the prompt is careful to ask for
"get it looked at" advice rather than a claimed mechanical fault.  If there
is no API key, or the call fails, a deterministic fallback built from the
same numbers is returned instead -- the feature degrades, it does not break.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.detection import severity as sev
from app.devices import activity
from app.models.detection import PotholeCluster, PotholeDetection
from app.models.device import Device

logger = logging.getLogger(__name__)

MAX_TOKENS = 300

SYSTEM_PROMPT = """You explain pothole-detection numbers to the person whose \
phone collected them. They are not a mechanic or an engineer.

Respond with ONLY a JSON object, no markdown fences and no text outside it, \
matching exactly this shape:

{"overview": "...", "confirmed": "..." or null, "advice": "..."}

- "overview": one or two short sentences on what the phone found, in plain \
terms like "a couple of minor bumps" or "several hard hits", not the raw \
numbers, and whether the pattern (severity and how often) is the kind of \
thing that could add up to real, if easy to miss, wear on a car --  \
suspension, alignment, tires -- over time.
- "confirmed": one or two short sentences on whether other drivers also felt \
these same spots, and what that corroboration is worth. Use null if none of \
these hits were confirmed by another driver.
- "advice": one plain next step, always present: tell them to get it checked \
out if the data suggests they should, keep an eye on it if it is borderline, \
or tell them they are all good if it genuinely looks fine. Never invent a \
specific diagnosis or part that is broken -- you are pointing at a pattern, \
not writing a repair order.

Plain language, no jargon, no marketing words like "seamless" or \
"cutting-edge", no em dash, and do not repeat the raw numbers back verbatim."""


@dataclass
class SummarySection:
    key: str
    title: str
    body: str


@dataclass
class SummaryResult:
    overview: str
    sections: list[SummarySection]
    written_by_claude: bool


def _clean_json(text: str) -> str:
    """Claude was asked for a bare JSON object; be forgiving of the odd code
    fence around it."""
    return text.strip().removeprefix("```json").removeprefix("```").strip().removesuffix("```").strip()


def _parse_sections_json(
    text: str, section_titles: dict[str, str]
) -> tuple[str, list[SummarySection]] | None:
    """Parse a `{"overview": ..., <key>: ... or null, ...}` response into an
    overview and the sections that were not null. Anything unparsable is
    treated as no answer at all -- the fallback is always safer than showing
    broken JSON."""
    try:
        parsed = json.loads(_clean_json(text))
    except json.JSONDecodeError:
        logger.warning("Claude summary was not valid JSON")
        return None
    if not isinstance(parsed, dict) or not isinstance(parsed.get("overview"), str):
        return None

    sections = [
        SummarySection(key=key, title=title, body=parsed[key])
        for key, title in section_titles.items()
        if isinstance(parsed.get(key), str) and parsed[key].strip()
    ]
    return parsed["overview"], sections


@dataclass
class DriverStats:
    total: int
    severe: int
    moderate: int
    minor: int
    confirmed: int
    max_severity: float
    mean_severity: float
    mean_speed_kmh: float

    @property
    def worst_bucket(self) -> str:
        if self.severe:
            return "severe"
        if self.moderate:
            return "moderate"
        return "minor"


def gather_stats(session: Session, device_id: str) -> DriverStats | None:
    """Every detection this device has made, boiled down to what matters.

    Returns None when the device has found nothing yet, which is itself an
    answer worth giving the user without spending a model call on it.
    """
    stmt = (
        select(
            PotholeDetection.severity,
            PotholeDetection.speed,
            PotholeCluster.status,
        )
        .join(PotholeCluster, PotholeCluster.id == PotholeDetection.cluster_id)
        .where(PotholeDetection.device_id == device_id)
    )
    rows = session.execute(stmt).all()
    if not rows:
        return None

    severities = [row.severity for row in rows]
    buckets = [sev.bucket(s) for s in severities]
    return DriverStats(
        total=len(rows),
        severe=buckets.count("severe"),
        moderate=buckets.count("moderate"),
        minor=buckets.count("minor"),
        confirmed=sum(1 for row in rows if row.status in ("confirmed", "reported")),
        max_severity=max(severities),
        mean_severity=sum(severities) / len(severities),
        mean_speed_kmh=sum(row.speed for row in rows) / len(rows) * 3.6,
    )


DRIVER_SECTION_TITLES = {
    "confirmed": "Confirmed by other drivers",
    "advice": "What to do next",
}


def _fallback_driver_overview(stats: DriverStats) -> str:
    """What to say when there is no model to ask, built from the same numbers
    the prompt would have used."""
    counts = []
    if stats.severe:
        counts.append(f"{stats.severe} severe")
    if stats.moderate:
        counts.append(f"{stats.moderate} moderate")
    if stats.minor:
        counts.append(f"{stats.minor} minor")
    breakdown = ", ".join(counts)
    plural = "s" if stats.total != 1 else ""
    return f"Your phone flagged {stats.total} pothole hit{plural} ({breakdown})."


def _fallback_driver_sections(stats: DriverStats) -> list[SummarySection]:
    sections = []
    if stats.confirmed:
        plural = "s" if stats.confirmed != 1 else ""
        sections.append(
            SummarySection(
                key="confirmed",
                title=DRIVER_SECTION_TITLES["confirmed"],
                body=f"{stats.confirmed} of these hit{plural} were also felt by other drivers at the same spot.",
            )
        )

    if stats.worst_bucket == "severe":
        advice = (
            "That is hard enough, and often enough, that it is worth having "
            "your suspension and alignment checked."
        )
    elif stats.worst_bucket == "moderate":
        advice = "Nothing urgent, but keep an eye on how the car rides over the next few drives."
    else:
        advice = "Nothing here suggests a problem. You are all good."
    sections.append(SummarySection(key="advice", title=DRIVER_SECTION_TITLES["advice"], body=advice))
    return sections


def _prompt(stats: DriverStats, phone_label: str) -> str:
    return (
        f"Phone: {phone_label}\n"
        f"Total detections: {stats.total}\n"
        f"Severe (70-100): {stats.severe}\n"
        f"Moderate (40-69): {stats.moderate}\n"
        f"Minor (0-39): {stats.minor}\n"
        f"Confirmed by other drivers at the same spot: {stats.confirmed}\n"
        f"Worst single hit: {stats.max_severity:.0f}/100\n"
        f"Average severity: {stats.mean_severity:.0f}/100\n"
        f"Average speed at impact: {stats.mean_speed_kmh:.0f} km/h"
    )


def _call_claude(prompt: str, system: str, api_key: str, model: str) -> str | None:
    import anthropic

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=model,
            max_tokens=MAX_TOKENS,
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_config={"effort": "low"},
        )
    except anthropic.AnthropicError:
        logger.exception("Claude summary call failed")
        return None
    parts = (block.text for block in message.content if block.type == "text")
    text = "".join(parts).strip()
    return text or None


def summarise(
    stats: DriverStats | None,
    phone_label: str,
    api_key: str | None,
    model: str,
) -> SummaryResult:
    """The summary, broken into an overview and a section per topic, and
    whether it was actually written by Claude."""
    if stats is None:
        return SummaryResult(
            overview="No potholes found yet. Drive a bit more and check back.",
            sections=[],
            written_by_claude=False,
        )

    fallback = SummaryResult(
        overview=_fallback_driver_overview(stats),
        sections=_fallback_driver_sections(stats),
        written_by_claude=False,
    )
    if not api_key:
        return fallback

    written = _call_claude(_prompt(stats, phone_label), SYSTEM_PROMPT, api_key, model)
    if written is None:
        return fallback
    parsed = _parse_sections_json(written, DRIVER_SECTION_TITLES)
    if parsed is None:
        return fallback
    overview, sections = parsed
    return SummaryResult(overview=overview, sections=sections, written_by_claude=True)


FLEET_SYSTEM_PROMPT = """You explain fleet-wide pothole-detection numbers to \
the operator running the dashboard. They manage the phones, not the drivers, \
and they care about the state of the road network and the fleet, not any one \
car.

Respond with ONLY a JSON object, no markdown fences and no text outside it, \
matching exactly this shape:

{"overview": "...", "candidate": "..." or null, "confirmed": "..." or null, "reported": "..." or null}

- "overview": one or two short sentences on how much the fleet has found and \
roughly how bad it is (a handful of minor bumps versus a real cluster of hard \
hits).
- "candidate": one or two short sentences of advice about the unconfirmed \
candidate locations -- whether they need more passes before anyone acts on \
them. Use null if there are none.
- "confirmed": one or two short sentences of advice about locations that are \
confirmed but not yet reported -- which ones to triage first, or that the \
queue looks under control. Use null if there are none.
- "reported": one or two short sentences on the locations already filed with \
the city -- whether that looks proportionate to what has been found. Use \
null if there are none.

Plain language, no jargon, no marketing words like "seamless" or \
"cutting-edge", no em dash, and do not repeat the raw numbers back verbatim."""


@dataclass
class FleetStats:
    devices: int
    active_devices: int
    total_detections: int
    severe: int
    moderate: int
    minor: int
    locations: int
    candidate_locations: int
    confirmed_locations: int
    reported_locations: int
    mean_severity: float
    max_severity: float

    @property
    def worst_bucket(self) -> str:
        if self.severe:
            return "severe"
        if self.moderate:
            return "moderate"
        return "minor"


def gather_fleet_stats(session: Session) -> FleetStats | None:
    """Every detection across every device, boiled down to what matters.

    Returns None when nothing has been found yet, which is itself an answer
    worth giving the operator without spending a model call on it.
    """
    severities = list(session.scalars(select(PotholeDetection.severity)))
    if not severities:
        return None

    buckets = [sev.bucket(s) for s in severities]
    clusters = list(session.scalars(select(PotholeCluster)))
    devices = list(session.scalars(select(Device)))
    now = datetime.now(UTC)

    return FleetStats(
        devices=len(devices),
        active_devices=sum(1 for d in devices if activity(d.updated_at, now) == "active"),
        total_detections=len(severities),
        severe=buckets.count("severe"),
        moderate=buckets.count("moderate"),
        minor=buckets.count("minor"),
        locations=len(clusters),
        candidate_locations=sum(1 for c in clusters if c.status == "candidate"),
        confirmed_locations=sum(1 for c in clusters if c.status == "confirmed"),
        reported_locations=sum(1 for c in clusters if c.status == "reported"),
        mean_severity=sum(severities) / len(severities),
        max_severity=max(severities),
    )


FLEET_SECTION_TITLES = {
    "candidate": "Candidate locations",
    "confirmed": "Confirmed, not yet reported",
    "reported": "Reported to the city",
}


def _fallback_fleet_overview(stats: FleetStats) -> str:
    """What to say when there is no model to ask, built from the same numbers
    the prompt would have used."""
    counts = []
    if stats.severe:
        counts.append(f"{stats.severe} severe")
    if stats.moderate:
        counts.append(f"{stats.moderate} moderate")
    if stats.minor:
        counts.append(f"{stats.minor} minor")
    breakdown = ", ".join(counts)
    plural = "s" if stats.total_detections != 1 else ""
    return (
        f"The fleet has flagged {stats.total_detections} pothole hit{plural} "
        f"({breakdown}) across {stats.locations} location"
        f"{'s' if stats.locations != 1 else ''}."
    )


def _fallback_fleet_sections(stats: FleetStats) -> list[SummarySection]:
    sections = []
    if stats.candidate_locations:
        plural = "s" if stats.candidate_locations != 1 else ""
        sections.append(
            SummarySection(
                key="candidate",
                title=FLEET_SECTION_TITLES["candidate"],
                body=(
                    f"{stats.candidate_locations} location{plural} still need more "
                    "passes before they can be confirmed."
                ),
            )
        )
    if stats.confirmed_locations:
        plural = "s" if stats.confirmed_locations != 1 else ""
        if stats.worst_bucket == "severe":
            advice = "Worth triaging the severe ones first."
        elif stats.worst_bucket == "moderate":
            advice = "Nothing urgent, but worth working through the queue."
        else:
            advice = "Nothing here looks urgent."
        sections.append(
            SummarySection(
                key="confirmed",
                title=FLEET_SECTION_TITLES["confirmed"],
                body=f"{stats.confirmed_locations} location{plural} confirmed and not yet reported. {advice}",
            )
        )
    if stats.reported_locations:
        plural = "s" if stats.reported_locations != 1 else ""
        sections.append(
            SummarySection(
                key="reported",
                title=FLEET_SECTION_TITLES["reported"],
                body=f"{stats.reported_locations} location{plural} already filed with the city.",
            )
        )
    return sections


def _fleet_prompt(stats: FleetStats) -> str:
    return (
        f"Devices seen: {stats.devices} ({stats.active_devices} active now)\n"
        f"Total detections: {stats.total_detections}\n"
        f"Severe (70-100): {stats.severe}\n"
        f"Moderate (40-69): {stats.moderate}\n"
        f"Minor (0-39): {stats.minor}\n"
        f"Locations found: {stats.locations}\n"
        f"Candidate locations (unconfirmed): {stats.candidate_locations}\n"
        f"Confirmed locations: {stats.confirmed_locations}\n"
        f"Reported to the city: {stats.reported_locations}\n"
        f"Worst single hit: {stats.max_severity:.0f}/100\n"
        f"Average severity: {stats.mean_severity:.0f}/100"
    )


def summarise_fleet(
    stats: FleetStats | None,
    api_key: str | None,
    model: str,
) -> SummaryResult:
    """The fleet-wide summary, broken into an overview and one section per
    location status, and whether it was actually written by Claude."""
    if stats is None:
        return SummaryResult(
            overview="No potholes found yet. Once phones start uploading, a summary will appear here.",
            sections=[],
            written_by_claude=False,
        )

    fallback = SummaryResult(
        overview=_fallback_fleet_overview(stats),
        sections=_fallback_fleet_sections(stats),
        written_by_claude=False,
    )
    if not api_key:
        return fallback

    written = _call_claude(_fleet_prompt(stats), FLEET_SYSTEM_PROMPT, api_key, model)
    if written is None:
        return fallback
    parsed = _parse_sections_json(written, FLEET_SECTION_TITLES)
    if parsed is None:
        return fallback
    overview, sections = parsed
    return SummaryResult(overview=overview, sections=sections, written_by_claude=True)
