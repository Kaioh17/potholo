"""Cross-check detections from independent vehicles.

This is the part that makes the data trustworthy, and it is the thing a
self-reporting form cannot do at all.  One car flagging one shock proves very
little: the driver may have clipped a kerb, the phone may have slid off the
seat.  But when a quarter of the cars that drive down a block all report a
strike within a few metres of the same spot, that is a road defect.

Two counts matter, not one:

  detections -- how many vehicles hit something here
  passes     -- how many vehicles drove over this spot at all

Their ratio is the useful signal.  Raw detection counts just rank by traffic
volume, which would send crews to Lake Shore Drive and never to a side street.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from .locate import metres_between

CLUSTER_RADIUS_M = 12.0  # a lane is ~3.5 m; GPS scatter dominates this
PASS_RADIUS_M = 20.0
MIN_DEVICES = 3
MIN_DETECTIONS = 4
MIN_HIT_RATE = 0.35


def evaluate_status(
    devices: int, detections: int, hit_rate: float, current: str = "candidate"
) -> str:
    """The bar a location has to clear before a crew is sent to it."""
    if current == "reported":
        return current
    ready = (
        devices >= MIN_DEVICES
        and detections >= MIN_DETECTIONS
        and hit_rate >= MIN_HIT_RATE
    )
    return "confirmed" if ready else "candidate"


def cluster_confidence(devices: int, hit_rate: float, mean_single: float) -> float:
    """Agreement between independent vehicles, not the strength of any one hit."""
    device_term = min(1.0, devices / 5.0)
    rate_term = min(1.0, hit_rate / 0.6)
    return round(0.45 * device_term + 0.35 * rate_term + 0.20 * mean_single, 3)


@dataclass
class Cluster:
    cluster_id: str
    lat: float
    lon: float
    detections: list = field(default_factory=list)
    devices: set[str] = field(default_factory=set)
    trips: set[str] = field(default_factory=set)
    passing_trips: set[str] = field(default_factory=set)
    status: str = "candidate"

    def add(self, det) -> None:
        n = len(self.detections)
        # running centroid, weighted equally -- GPS error is roughly the same
        # on every fix, so there is nothing to weight by
        self.lat = (self.lat * n + det.lat) / (n + 1)
        self.lon = (self.lon * n + det.lon) / (n + 1)
        self.detections.append(det)
        self.devices.add(det.device_id)
        self.trips.add(det.trip_id)
        self.passing_trips.add(det.trip_id)

    @property
    def hit_rate(self) -> float:
        total = len(self.passing_trips)
        return len(self.trips) / total if total else 0.0

    @property
    def severity(self) -> float:
        vals = sorted(d.severity for d in self.detections)
        mid = len(vals) // 2
        return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2

    @property
    def radius_m(self) -> float:
        if len(self.detections) < 2:
            return self.detections[0].location_error_m if self.detections else 0.0
        return max(
            metres_between(self.lat, self.lon, d.lat, d.lon) for d in self.detections
        )

    @property
    def confidence(self) -> float:
        single = sum(d.confidence for d in self.detections) / len(self.detections)
        return cluster_confidence(len(self.devices), self.hit_rate, single)

    def evaluate(self) -> str:
        self.status = evaluate_status(
            len(self.devices), len(self.detections), self.hit_rate, self.status
        )
        return self.status


class ClusterIndex:
    """Greedy incremental clustering on a coarse grid.

    Greedy rather than DBSCAN because detections arrive as a stream and must be
    placed on contact; re-clustering the whole city per upload would not hold up.
    The grid keeps each lookup to a handful of neighbours.
    """

    CELL_DEG = 0.0005  # ~55 m of latitude

    def __init__(self) -> None:
        self.clusters: dict[str, Cluster] = {}
        self._grid: dict[tuple[int, int], list[str]] = {}

    def _cell(self, lat: float, lon: float) -> tuple[int, int]:
        return int(lat / self.CELL_DEG), int(lon / self.CELL_DEG)

    def _nearby(self, lat: float, lon: float):
        ci, cj = self._cell(lat, lon)
        for i in (ci - 1, ci, ci + 1):
            for j in (cj - 1, cj, cj + 1):
                for cid in self._grid.get((i, j), ()):
                    yield self.clusters[cid]

    def add(self, det) -> Cluster:
        best, best_d = None, CLUSTER_RADIUS_M
        for c in self._nearby(det.lat, det.lon):
            d = metres_between(c.lat, c.lon, det.lat, det.lon)
            if d <= best_d:
                best, best_d = c, d
        if best is None:
            best = Cluster(cluster_id=uuid.uuid4().hex[:12], lat=det.lat, lon=det.lon)
            self.clusters[best.cluster_id] = best
            cell = self._cell(det.lat, det.lon)
            self._grid.setdefault(cell, []).append(best.cluster_id)
        best.add(det)
        best.evaluate()
        return best

    def record_pass(self, trip_id: str, track: list) -> None:
        """Note every cluster this trip drove over, hit or not.

        Without this the hit rate has no denominator, and a busy street would
        always outrank a genuinely broken one.
        """
        for fix in track:
            for c in self._nearby(fix.lat, fix.lon):
                if metres_between(c.lat, c.lon, fix.lat, fix.lon) <= PASS_RADIUS_M:
                    c.passing_trips.add(trip_id)
        for c in self.clusters.values():
            c.evaluate()
