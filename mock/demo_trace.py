"""Write the recorded trace the /demo page replays as if it were a phone.

The demo car passes one pothole every loop.  This renders what a phone in that
car would record over one pass, at the sim's own timing, and saves it where the
web app can import it.  The page adds a little random variation to every upload,
so no two batches are byte-identical.

Regenerate it after changing the timeline in web/src/sim/CityBlockScene.jsx:

    python mock/demo_trace.py --pass-seconds 26.22 --front-hit 12.45

`pass-seconds` is the simulation time one loop takes, and `front-hit` is the
simulation time the front axle is over the pothole's centre.  Both come from the
timeline tables in CityBlockScene.jsx, not from the real-time CONFIG numbers,
because slow motion makes the two differ.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from phone import simulate

OUT = Path(__file__).resolve().parents[1] / "web" / "src" / "demo" / "tripTemplate.json"


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--pass-seconds", type=float, required=True)
    p.add_argument("--front-hit", type=float, required=True)
    p.add_argument("--speed", type=float, default=8.0, help="m/s, the demo car's speed")
    p.add_argument("--fs", type=float, default=100.0)
    p.add_argument("--seed", type=int, default=11)
    a = p.parse_args()

    imu, _gps, truth = simulate(
        duration_s=a.pass_seconds,
        fs=a.fs,
        speed=a.speed,
        potholes=[a.front_hit],
        seed=a.seed,
    )
    template = {
        "fs": a.fs,
        "speed": a.speed,
        "passSeconds": a.pass_seconds,
        "frontHitAt": a.front_hit,
        "strikes": truth[0]["axle_strikes"],
        # One row per sample: ax, ay, az (m/s^2, gravity included), gx, gy, gz (rad/s).
        "imu": [[s["ax"], s["ay"], s["az"], s["gx"], s["gy"], s["gz"]] for s in imu],
    }
    OUT.write_text(json.dumps(template, separators=(",", ":")) + "\n")
    print(f"wrote {OUT}: {len(imu)} samples, strikes at {template['strikes']}")


if __name__ == "__main__":
    main()
