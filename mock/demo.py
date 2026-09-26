"""Drive a fleet of simulated phones past the API and show what comes out.

Start the API first (`cd api && fastapi dev`), then:

    python mock/demo.py

Every payload is in the wire format a real phone sends. The service does the
detection; nothing here is pre-labelled or pre-clustered.
"""
from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request

from phone import build_batch

API = "http://127.0.0.1:8000"
LAT, LON = 41.8781, -87.6298
POTHOLE_AT_S = 20.0
RULE = "-" * 74


def post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        API + path, data=json.dumps(body).encode(),
        headers={"content-type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def get(path: str) -> dict | list:
    with urllib.request.urlopen(API + path, timeout=30) as r:
        return json.loads(r.read())


def main(vehicles: int, clean: int) -> None:
    print(f"{RULE}\nDriving {vehicles} vehicles over the same pothole\n{RULE}")
    for k in range(vehicles):
        raw = build_batch(device_id=f"demo-phone-{k}", trip_id=f"demo-trip-{k}",
                          duration_s=40, fs=100.0, speed=11.0,
                          potholes=[POTHOLE_AT_S], depth_m=0.08, seed=100 + k,
                          start_lat=LAT, start_lon=LON)
        body = {k2: v for k2, v in raw.items() if not k2.startswith("_")}
        res = post("/v1/batches", body)
        for d in res["detections"]:
            print(f"  device {k}: strike at t={d['t']:.2f}s  severity {d['severity']:.0f}"
                  f"  dv {d['delta_v']:.3f} m/s  confidence {d['confidence']:.2f}"
                  f"  ({d['lat']:.5f}, {d['lon']:.5f}) +/-{d['location_error_m']:.0f} m")
        if not res["detections"]:
            print(f"  device {k}: nothing detected")
        for w in res["warnings"]:
            print(f"  device {k}: WARNING {w}")

    if clean:
        print(f"\n  ...and {clean} vehicles over the same street with no pothole,")
        print("     which is what gives the hit rate a denominator")
        for k in range(clean):
            raw = build_batch(device_id=f"demo-clean-{k}", trip_id=f"demo-clean-trip-{k}",
                              duration_s=40, fs=100.0, speed=11.0, potholes=[],
                              seed=500 + k, start_lat=LAT, start_lon=LON)
            post("/v1/batches", {k2: v for k2, v in raw.items() if not k2.startswith("_")})

    print(f"\n{RULE}\nWhat the service concluded\n{RULE}")
    rows = get("/v1/clusters")
    for c in rows:
        print(f"  {c['status']:>9}  ({c['lat']:.5f}, {c['lon']:.5f}) "
              f"+/-{c['radius_m']:.0f} m")
        print(f"             {c['detections']} detections from {c['devices']} devices, "
              f"{c['passes']} passes -> hit rate {c['hit_rate']:.0%}")
        print(f"             severity {c['severity']:.0f}/100, "
              f"confidence {c['confidence']:.2f}")

    confirmed = [c for c in rows if c["status"] == "confirmed"]
    if not confirmed:
        print("\n  Nothing confirmed yet: 3 devices, 4 detections and a 35% hit rate")
        print("  are required before a location is reported.")
        return

    print(f"\n{RULE}\nCDOT service request (dry run, nothing sent)\n{RULE}")
    out = post(f"/v1/clusters/{confirmed[0]['cluster_id']}/report", {})
    print(f"  endpoint : {out['endpoint']}")
    print(f"  submitted: {out['submitted']}  ({out['reason']})")
    for key, value in out["preview"].items():
        print(f"  {key:<26} {value}")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--vehicles", type=int, default=4)
    p.add_argument("--clean", type=int, default=3,
                   help="vehicles that drive the street without hitting anything")
    args = p.parse_args()
    try:
        main(args.vehicles, args.clean)
    except urllib.error.URLError:
        raise SystemExit(f"No API at {API}. Start it with: cd api && fastapi dev") from None
