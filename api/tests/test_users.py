"""Joining the demo: name rules, device ids, and the link to uploaded data."""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "mock"))

from phone import build_batch  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def unique(prefix: str = "rider") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def join(client, name: str, phone: str = "pixel-8"):
    return client.post("/v1/users/join", json={"name": name, "phone": phone})


def test_phone_list_is_served(client):
    phones = client.get("/v1/phones").json()
    assert {"slug": "pixel-8", "label": "Google Pixel 8"} in phones


def test_join_generates_device_id_from_the_phone(client):
    res = join(client, unique(), "galaxy-s23")
    assert res.status_code == 201
    body = res.json()
    assert body["device_id"].startswith("galaxy-s23-")
    assert body["phone"]["label"] == "Samsung Galaxy S23"


def test_two_users_on_the_same_model_get_different_devices(client):
    a = join(client, unique(), "pixel-8").json()
    b = join(client, unique(), "pixel-8").json()
    assert a["device_id"] != b["device_id"]


@pytest.mark.parametrize("name", ["", "abc", "   ab   ", "a b"])
def test_name_must_be_longer_than_three_characters(client, name):
    res = join(client, name)
    assert res.status_code == 422
    assert "longer than 3" in res.text


def test_name_of_four_characters_is_accepted(client):
    assert join(client, uuid.uuid4().hex[:4]).status_code == 201


def test_name_must_be_unique_ignoring_case_and_spacing(client):
    name = unique("Ada")
    assert join(client, name).status_code == 201
    for again in (name, name.upper(), f"  {name}  "):
        res = join(client, again)
        assert res.status_code == 409
        assert "taken" in res.json()["detail"]


def test_unknown_phone_is_rejected(client):
    assert join(client, unique(), "nokia-3310").status_code == 422


def test_unknown_or_malformed_user_id(client):
    assert client.get(f"/v1/users/{uuid.uuid4()}").status_code == 404
    assert client.get("/v1/users/not-a-uuid").status_code == 422


def test_user_sees_their_own_upload_stats(client):
    user = join(client, unique()).json()
    view = client.get(f"/v1/users/{user['user_id']}").json()
    assert view["device"] is None

    raw = build_batch(
        device_id=user["device_id"], duration_s=10, fs=100.0, potholes=[], seed=3
    )
    body = {k: v for k, v in raw.items() if not k.startswith("_")}
    assert client.post("/v1/batches", json=body).status_code == 200

    view = client.get(f"/v1/users/{user['user_id']}").json()
    assert view["device"]["device_id"] == user["device_id"]
    assert view["device"]["batches"] == 1


def test_joined_time_carries_a_utc_marker_on_every_route(client):
    user = join(client, unique()).json()
    fetched = client.get(f"/v1/users/{user['user_id']}").json()
    assert user["joined"].endswith("Z")
    assert fetched["joined"].endswith("Z")
