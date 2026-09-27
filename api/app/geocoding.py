"""Reverse geocoding: what street is a pothole on?

Uses OpenStreetMap's Nominatim, which is free and needs no API key. Its usage
policy shapes this module: one request a second at most, an identifying
User-Agent, and results cached. A pothole never moves, so the cache is
effective and hovering a pin only costs an upstream call the first time.

The browser asks this API rather than Nominatim directly, so the policy is
enforced in one place however many people have the dashboard open.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass

from app.config import settings

MIN_INTERVAL_S = 1.1  # a little over Nominatim's one request a second
CACHE_SIZE = 2000
KEY_DECIMALS = 4  # about 11 m, finer than a cluster's own spread
TIMEOUT_S = 8.0

ATTRIBUTION = "Address data from OpenStreetMap contributors"


class GeocodeUnavailable(Exception):
    """The geocoding service could not be reached or gave an unusable reply."""


class NoAddress(Exception):
    """The service is fine but knows of nothing at that spot, such as open water."""


@dataclass(frozen=True)
class Address:
    label: str
    road: str | None
    house_number: str | None
    area: str | None
    city: str | None
    postcode: str | None


_cache: OrderedDict[tuple[float, float], Address] = OrderedDict()
_lock = threading.Lock()
_last_call = 0.0


def _request(lat: float, lon: float) -> dict:
    query = urllib.parse.urlencode(
        {"format": "jsonv2", "lat": lat, "lon": lon, "zoom": 18, "addressdetails": 1}
    )
    req = urllib.request.Request(
        f"{settings.geocoder_url}?{query}",
        headers={"User-Agent": settings.geocoder_user_agent, "Accept-Language": "en"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
            return json.load(res)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        raise GeocodeUnavailable(str(exc)) from exc


def parse(payload: dict) -> Address:
    """Turn a Nominatim reply into a short label.

    A pothole is in the road, not at a door, so when there is no house number the
    label is the street and neighbourhood rather than an invented address.
    """
    if "error" in payload or not payload.get("address"):
        raise NoAddress(payload.get("error", "no address"))
    a = payload["address"]
    road = a.get("road") or a.get("pedestrian") or a.get("footway")
    number = a.get("house_number")
    area = (
        a.get("neighbourhood")
        or a.get("suburb")
        or a.get("quarter")
        or a.get("city_district")
    )
    city = a.get("city") or a.get("town") or a.get("village")

    street = f"{number} {road}" if number and road else road or payload.get("name")
    parts = [p for p in (street, area, city) if p]
    if not parts:
        raise NoAddress("no usable address parts")
    return Address(
        label=", ".join(parts),
        road=road,
        house_number=number,
        area=area,
        city=city,
        postcode=a.get("postcode"),
    )


def reverse(lat: float, lon: float) -> tuple[Address, bool]:
    """The address at a point, and whether it came from the cache."""
    global _last_call
    key = (round(lat, KEY_DECIMALS), round(lon, KEY_DECIMALS))
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key], True
        # Holding the lock while waiting is the rate limit: concurrent hovers
        # queue up and go upstream one at a time.
        wait = _last_call + MIN_INTERVAL_S - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        try:
            address = parse(_request(lat, lon))
        finally:
            _last_call = time.monotonic()
        _cache[key] = address
        if len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
        return address, False
