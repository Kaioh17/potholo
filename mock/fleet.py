"""Populate the API with a small fleet of simulated phones, for the admin page.

Start the API first (`cd api && fastapi dev`), then:

    python mock/fleet.py

The fleet is deliberately uneven, so every state on the dashboard shows up:
phones that confirm a pothole together, one that only sees a candidate, phones on
smooth roads that find nothing, and phones sampling too slowly to see a strike.
Every payload is in the wire format a real phone sends.
"""

from __future__ import annotations

import argparse
import json
import urllib.request

from phone import build_batch
from streets import route_for

API = "http://127.0.0.1:8044"

# (device, street number, potholes at t seconds, IMU rate Hz, pothole depth m)
FLEET = [
    ("pixel-8-a41f", 0, [20.0], 100.0, 0.09),
    ("galaxy-s23-7c02", 0, [20.0], 100.0, 0.08),
    ("pixel-7-9be3", 0, [20.0], 100.0, 0.10),
    ("moto-g-2d68", 0, [20.0], 100.0, 0.07),
    ("iphone-14-55aa", 0, [20.0], 100.0, 0.09),
    ("galaxy-a54-e310", 1, [20.0], 100.0, 0.05),
    ("pixel-6a-0c9d", 1, [20.0], 100.0, 0.06),
    ("oneplus-11-b7f4", 2, [], 100.0, 0.0),
    ("pixel-8-quiet-3e1a", 3, [], 100.0, 0.0),
    ("galaxy-a14-slow-88d0", 2, [20.0], 25.0, 0.10),
    ("moto-e-slow-1f6b", 3, [20.0], 50.0, 0.09),
]


def post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def main(trips: int) -> None:
    for i, (device, street, potholes, fs, depth) in enumerate(FLEET):
        for k in range(trips):
            raw = build_batch(
                device_id=device,
                trip_id=f"{device}-trip-{k}",
                duration_s=40,
                fs=fs,
                speed=11.0,
                potholes=potholes,
                depth_m=depth or 0.08,
                seed=1000 + i * 10 + k,
                route=route_for(street, 2),
            )
            res = post(
                "/v1/batches",
                {k2: v for k2, v in raw.items() if not k2.startswith("_")},
            )
            print(
                f"{device:<24} trip {k}: {len(res['detections'])} detections, "
                f"{res['effective_rate_hz']:.0f} Hz, {len(res['warnings'])} warnings"
            )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Populate the API with a simulated fleet.")
    p.add_argument("--trips", type=int, default=2, help="trips per device")
    main(p.parse_args().trips)
