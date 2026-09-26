from fastapi.testclient import TestClient

from app.main import app


def test_health() -> None:
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_activity_thresholds():
    from datetime import UTC, datetime, timedelta

    from app.devices import activity

    now = datetime(2025, 1, 1, 12, tzinfo=UTC)
    assert activity(now - timedelta(minutes=2), now) == "active"
    assert activity(now - timedelta(minutes=30), now) == "idle"
    assert activity(now - timedelta(hours=3), now) == "offline"
    # SQLite returns naive timestamps, which are UTC.
    assert activity(datetime(2025, 1, 1, 11, 59), now) == "active"
