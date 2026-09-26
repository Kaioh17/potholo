"""Build a CDOT pothole service request from a confirmed cluster.

Chicago runs a GeoReport v2 (Open311) endpoint, so a report can be filed
directly instead of driving the public web form:

    production  http://311api.cityofchicago.org/open311/v2
    test        http://test311api.cityofchicago.org/open311/v2

The service catalogue gives "Pothole in Street Complaint" the code below, and
its metadata marks one attribute required: where on the roadway the hole sits.

Submitting opens a real work order with the City.  Nothing here sends anything
unless a caller passes an API key *and* explicitly sets confirm=True, and the
endpoint defaults to the City's test system.  A detector that files reports on
its own would put bad data in front of a road crew.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

PRODUCTION = "http://311api.cityofchicago.org/open311/v2"
TEST = "http://test311api.cityofchicago.org/open311/v2"

SERVICE_CODE_STREET = "4fd3b656e750846c53000004"  # Pothole in Street Complaint (PHF)
SERVICE_CODE_ALLEY = "5c1849ce9e6e99eda0adada2"  # Alley Pothole Complaint (PHB)

ATTR_LOCATION = "FQ62961"  # required: where is the pothole located?
ATTR_DETAILS = "FQ62962"  # optional free text

LaneChoice = Literal[
    "Traffic Lane",
    "Curb Lane",
    "Intersection",
    "Bike Lane",
    "Bus Stop",
    "Crosswalk",
    "Center Lane",
    "2FM Parking Lot",
]


@dataclass
class ServiceRequest:
    endpoint: str
    payload: dict
    cluster_id: str

    def as_curl(self) -> str:
        body = " ".join(
            f'-F "{k}={v}"' for k, v in self.payload.items() if k != "api_key"
        )
        return (
            f"curl -X POST {self.endpoint}/requests.json "
            f'-F "api_key=$CHI311_KEY" {body}'
        )


def describe(cluster, severity_label: str) -> str:
    """Plain description a dispatcher can act on, with the evidence behind it."""
    return (
        f"Pothole detected by {cluster.devices} vehicles making "
        f"{cluster.detections} separate impact recordings at this location "
        f"({cluster.hit_rate:.0%} of vehicles passing this point "
        f"registered an impact). "
        f"Severity {severity_label} (index {cluster.severity:.0f}/100). "
        f"Position accurate to approximately {max(cluster.radius_m, 5):.0f} m. "
        f"Reported automatically from phone accelerometer data."
    )


def build_request(
    cluster,
    severity_label: str,
    lane: LaneChoice = "Traffic Lane",
    alley: bool = False,
    endpoint: str = TEST,
    api_key: str | None = None,
) -> ServiceRequest:
    """Assemble the Open311 payload. Does not send it."""
    payload = {
        "service_code": SERVICE_CODE_ALLEY if alley else SERVICE_CODE_STREET,
        "lat": f"{cluster.lat:.6f}",
        "long": f"{cluster.lon:.6f}",
        "description": describe(cluster, severity_label),
        f"attribute[{ATTR_LOCATION}]": lane,
        f"attribute[{ATTR_DETAILS}]": (
            f"potholo cluster {cluster.cluster_id}; confidence {cluster.confidence:.2f}"
        ),
    }
    if api_key:
        payload["api_key"] = api_key
    return ServiceRequest(
        endpoint=endpoint, payload=payload, cluster_id=cluster.cluster_id
    )


def submit(
    request: ServiceRequest,
    *,
    api_key: str | None = None,
    confirm: bool = False,
    timeout: float = 20.0,
) -> dict:
    """Actually file the request. Refuses unless explicitly confirmed."""
    if not confirm:
        return {
            "submitted": False,
            "reason": "confirm=False; nothing was sent",
            "preview": request.payload,
        }
    key = api_key or request.payload.get("api_key")
    if not key:
        return {
            "submitted": False,
            "reason": "no API key configured",
            "preview": request.payload,
        }
    if request.endpoint == PRODUCTION:
        # A guard rail, not a limitation: production files real work orders.
        return {
            "submitted": False,
            "reason": "production endpoint requires an operator to send it",
            "preview": request.payload,
        }

    import urllib.parse
    import urllib.request

    body = dict(request.payload, api_key=key)
    data = urllib.parse.urlencode(body).encode()
    req = urllib.request.Request(f"{request.endpoint}/requests.json", data=data)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        import json

        return {
            "submitted": True,
            "status": resp.status,
            "response": json.loads(resp.read()),
        }
