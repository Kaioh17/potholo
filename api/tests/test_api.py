"""End-to-end: phone payloads in over HTTP, confirmed potholes out.

These go through the real router, the real SQLAlchemy session and the real
detector.  Only the phone is simulated.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "mock"))

from phone import build_batch  # noqa: E402

from app.main import app  # noqa: E402

LAT, LON = 41.8781, -87.6298
POTHOLE_T = 20.0


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def payload(
    device: str, trip: str, lat: float = LAT, potholes=(POTHOLE_T,), seed=1, **kw
) -> dict:
    """One trip driving east along a street at `lat`.

    Every test picks its own latitude.  The suite shares a single database, and
    the trips all run east-west, so a couple of hundred metres of separation is
    what keeps one test's cluster out of another's.
    """
    raw = build_batch(
        device_id=device,
        trip_id=trip,
        duration_s=40,
        fs=100,
        speed=11.0,
        potholes=list(potholes),
        seed=seed,
        start_lat=lat,
        start_lon=LON,
        **kw,
    )
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def test_batch_returns_detections(client):
    r = client.post("/v1/batches", json=payload("device-1", "trip-0001", lat=LAT))
    assert r.status_code == 200
    body = r.json()
    assert body["effective_rate_hz"] == pytest.approx(100.0, abs=1.0)
    assert len(body["detections"]) == 1
    assert body["detections"][0]["kind"] == "pothole"


def test_malformed_batch_is_rejected(client):
    bad = payload("device-x", "trip-bad", lat=LAT + 0.002)
    bad["imu"] = bad["imu"][:4]  # below the minimum length
    assert client.post("/v1/batches", json=bad).status_code == 422


def test_one_device_stays_a_candidate(client):
    lat = LAT + 0.004
    for k in range(5):
        client.post(
            "/v1/batches",
            json=payload("lonely-device", f"trip-solo-{k}", lat=lat, seed=k + 20),
        )
    rows = client.get("/v1/clusters").json()
    mine = [c for c in rows if abs(c["lat"] - lat) < 0.001]
    assert mine, "expected a cluster on this street"
    # Five trips, but all from one phone: still one vehicle's word for it.
    assert all(c["devices"] == 1 and c["status"] == "candidate" for c in mine)


def test_independent_devices_confirm_and_can_be_reported(client):
    lat = LAT + 0.006
    for k in range(4):
        r = client.post(
            "/v1/batches",
            json=payload(f"fleet-device-{k}", f"trip-fleet-{k}", lat=lat, seed=k + 40),
        )
        assert r.status_code == 200

    confirmed = [
        c
        for c in client.get("/v1/clusters", params={"status": "confirmed"}).json()
        if abs(c["lat"] - lat) < 0.001
    ]
    assert confirmed, "four independent vehicles should confirm the same pothole"
    top = confirmed[0]
    assert top["devices"] >= 3
    assert 0.0 < top["hit_rate"] <= 1.0

    # Dry run: prepared, never sent.
    r = client.post(f"/v1/clusters/{top['cluster_id']}/report", json={})
    assert r.status_code == 200
    out = r.json()
    assert out["submitted"] is False
    assert out["preview"]["service_code"] == "4fd3b656e750846c53000004"
    assert out["preview"]["attribute[FQ62961]"] == "Traffic Lane"
    assert "test311api" in out["endpoint"]


def test_unconfirmed_cluster_cannot_be_reported(client):
    lat = LAT + 0.008
    client.post(
        "/v1/batches", json=payload("single-device", "trip-single-1", lat=lat, seed=77)
    )
    rows = client.get("/v1/clusters").json()
    candidate = next(
        c for c in rows if c["status"] == "candidate" and abs(c["lat"] - lat) < 0.001
    )
    r = client.post(f"/v1/clusters/{candidate['cluster_id']}/report", json={})
    assert r.status_code == 409


def test_production_endpoint_refuses_to_send(client):
    """Filing a real work order must not be one API call away."""
    lat = LAT + 0.010
    for k in range(4):
        client.post(
            "/v1/batches",
            json=payload(f"prod-device-{k}", f"trip-prod-{k}", lat=lat, seed=k + 60),
        )
    confirmed = [
        c
        for c in client.get("/v1/clusters", params={"status": "confirmed"}).json()
        if abs(c["lat"] - lat) < 0.001
    ]
    assert confirmed
    r = client.post(
        f"/v1/clusters/{confirmed[0]['cluster_id']}/report",
        json={"confirm": True, "use_production": True},
    )
    assert r.json()["submitted"] is False


def test_reuploading_the_same_batch_does_not_double_count(client):
    """A phone retrying a failed upload must not inflate the evidence."""
    lat = LAT + 0.012
    body = payload("retry-device", "trip-retry", lat=lat, seed=91)
    first = client.post("/v1/batches", json=body).json()
    assert len(first["detections"]) == 1

    client.post("/v1/batches", json=body)  # same batch again
    rows = [c for c in client.get("/v1/clusters").json() if abs(c["lat"] - lat) < 0.001]
    assert len(rows) == 1
    assert rows[0]["detections"] == 1
