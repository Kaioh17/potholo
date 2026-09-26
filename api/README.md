# Potholo API

FastAPI backend for Potholo. Uses SQLAlchemy with SQLite and UUID primary keys.
There is no auth yet.

Phones upload raw accelerometer, gyroscope and GPS samples; the service does the
detection, clusters strikes across vehicles, and prepares CDOT service requests.
The maths is documented in `../docs/detection-model.md`.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /health` | liveness, including a database round trip |
| `POST /v1/batches` | ingest a few seconds of a trip, return what was found in it |
| `GET /v1/devices` | every phone that has uploaded, with its upload health and what it found |
| `GET /v1/clusters` | cross-checked pothole locations, best evidence first |
| `POST /v1/clusters/{id}/report` | prepare a CDOT Open311 request for a confirmed cluster |

`GET /v1/clusters` takes `status` (`candidate`, `confirmed`, `reported`) and
`min_confidence`. `POST /v1/batches` takes an optional `z_threshold` override.

Reporting is a **dry run by default**: it targets the City's test endpoint,
needs `CHI311_API_KEY` set and `confirm=true` to send anything at all, and
refuses the production endpoint outright. Each real request opens a work order
against a road crew's queue.

## Trying it without a phone

`mock/phone.py` generates payloads in exactly the format a real phone sends, so
nothing downstream can tell the difference:

```bash
python mock/phone.py --duration 60 --potholes 12 31 47.5 --out batch.json
curl -X POST http://127.0.0.1:8000/v1/batches -H 'content-type: application/json' -d @batch.json
curl http://127.0.0.1:8000/v1/clusters
```

A cluster needs 3 distinct devices, 4 detections and a 35% hit rate before it is
confirmed, so post batches with several `device_id` values to see one confirm.
`python mock/fleet.py` posts a whole uneven fleet at once, which fills the admin page.

## Setup

Requires Python 3.12 or newer.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

Use `requirements.txt` instead if you only need to run the API.

## Run

```bash
fastapi dev
```

The API runs at http://127.0.0.1:8000, and the interactive docs are at `/docs`.
Tables are created on startup, and there are no migrations yet.

## Configuration

Settings come from environment variables with the `POTHOLO_` prefix.

| Variable | Default | Purpose |
| --- | --- | --- |
| `POTHOLO_DATABASE_URL` | `sqlite:///./potholo.db` | Database connection URL |

## Checks

```bash
pytest
ruff check . && ruff format --check .
ty check app
```

## Layout

```
app/
  main.py         app and startup
  config.py       settings
  database.py     engine, session, SessionDep
  models/         SQLAlchemy models (base.py has Base and the UUID and timestamp mixins)
  routers/        route modules
  detection/      the signal processing and decision logic
    signal_ops.py   orientation, band-pass, adaptive threshold
    detector.py     candidate shocks, shape test, vehicle-state gates
    severity.py     strike impulse to a 0-100 index
    locate.py       impact time to a position, with an error bar
    cluster.py      confirmation thresholds and scoring
  pipeline.py     one batch of samples in, located detections out
  repository.py   database-backed clustering
  schemas.py      the wire format a phone sends
  reporting/      CDOT Open311 service requests
tests/
```

## Adding a model

Subclass `Base` with `UUIDPrimaryKeyMixin` and, if needed, `TimestampMixin`.
Import the model in `app/models/__init__.py` so its table is created on startup.
