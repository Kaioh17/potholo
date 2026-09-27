import pytest
from fastapi.testclient import TestClient

from app import geocoding
from app.main import app

# Trimmed from a real Nominatim reply for a point on West Lake Street.
LAKE_ST = {
    "name": "Lake Street Bridge",
    "address": {
        "man_made": "Lake Street Bridge",
        "road": "West Lake Street",
        "suburb": "Loop",
        "city": "Chicago",
        "state": "Illinois",
        "postcode": "60654",
    },
}


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    geocoding._cache.clear()
    monkeypatch.setattr(geocoding, "MIN_INTERVAL_S", 0.0)
    calls = []

    def fake(lat, lon):
        calls.append((lat, lon))
        return LAKE_ST

    monkeypatch.setattr(geocoding, "_request", fake)
    return calls


def get(lat=41.88573, lon=-87.63805):
    with TestClient(app) as client:
        return client.get("/v1/geocode/reverse", params={"lat": lat, "lon": lon})


def test_label_is_street_and_area_without_an_invented_number():
    body = get().json()
    assert body["label"] == "West Lake Street, Loop, Chicago"
    assert body["house_number"] is None
    assert body["cached"] is False


def test_house_number_is_used_when_the_source_has_one():
    address = {"house_number": "233", "road": "South Wacker Drive", "city": "Chicago"}
    payload = {"address": address}
    assert geocoding.parse(payload).label == "233 South Wacker Drive, Chicago"


def test_repeat_and_nearby_lookups_use_the_cache(fresh):
    assert get().json()["cached"] is False
    assert get().json()["cached"] is True
    assert get(41.885732, -87.638052).json()["cached"] is True  # a metre away
    assert len(fresh) == 1


def test_no_address_is_a_404(monkeypatch):
    monkeypatch.setattr(
        geocoding, "_request", lambda *_: {"error": "Unable to geocode"}
    )
    assert get().status_code == 404


def test_upstream_failure_is_a_502_and_not_cached(monkeypatch):
    def down(lat, lon):
        raise geocoding.GeocodeUnavailable("timeout")

    monkeypatch.setattr(geocoding, "_request", down)
    assert get().status_code == 502
    assert not geocoding._cache


def test_rejects_impossible_coordinates():
    assert get(lat=123).status_code == 422
