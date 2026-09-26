# Potholo

Potholo detects and records potholes in Chicago using the gyroscope and accelerometer already inside ordinary phones.
Readings are collected on the phone, sent to a FastAPI service, and turned into cross-checked, mapped pothole records.

## Why it exists

- **Insurance claims:** timestamped, location-tagged evidence of where and when road damage happened.
- **Government allocation:** ranked, mapped pothole data to decide where construction money should go.
- **Data analysis and prevention:** trends, repeat offenders and repair quality, so future potholes can be prevented.

## Architecture

The final product is a React Native app plus a backend.
This repository is the prototype, and it has two parts.

| Part | Status | Notes |
| --- | --- | --- |
| Web app (`web/`) | In progress | React landing page and login. It will later host a demo. |
| Data processing API (`api/`) | Working | FastAPI. Ingest, detection, clustering, CDOT reporting. |
| Mock phone (`mock/`) | Working | Sedan, SUV, semi and bus, in the real phone wire format. |
| Real drive data (`data/`) | Working | 418s of instrumented drive, recovered from a screen recording. |
| Mobile app | Not started | React Native. Out of scope for the prototype. |

## How detection works

The phone streams raw motion and location; every decision is made in the API.
In short: find "up" from the data rather than assuming it, band-pass to the
8-15 Hz range where a wheel strike rings, score each shock against a local
baseline so rough roads raise their own bar, and require the shape of a **drop
followed by a strike** -- a pothole unloads the suspension before it hits, a
speed bump lifts it first.

A single vehicle is never enough. Detections are clustered across trips, and a
location is only confirmed once at least 3 distinct devices have hit it and at
least 35% of the vehicles that drove over the spot registered an impact. That
hit rate is the point: ranking by raw detection count just ranks by traffic
volume.

`docs/detection-model.md` has the full method, the measured detection and
false-positive rates, and the evidence behind the 100 Hz sampling requirement.
`docs/synthetic-fleet.md` covers the four vehicle classes and the labelled
scenario catalogue they are exercised with.

### What is mocked

Only the phone side is mocked.
The React Native app would read motion data through Android's `SensorEventListener`.
For the prototype, we generate sensor readings that look like what that listener would deliver.
Everything downstream of those readings is real: the FastAPI service really ingests, processes and analyses them.

The mock data exists to demonstrate the data analysis end to end.
It should be replaceable by real phone readings without changing the API.

## Repository layout

```text
potholo/
  web/            React web app (Vite)
  api/            FastAPI service: ingest, detection, clustering, CDOT reporting
  mock/           Mock phone sensor generator, kept out of the API
                  vehicles.py  quarter-car models for sedan, SUV, semi, bus
                  scenarios.py labelled test and edge cases
                  seed_db.py   runs them all and populates the database
  data/           Real instrumented drive, plus the scripts that recovered it
  docs/           Detection model and evidence
  CLAUDE.md       Instructions for coding agents
  AGENT.md        Symlink to CLAUDE.md
```

## Running the web app

Requires Node 22 or newer.

```bash
cd web
npm install
npm run dev
```

Other scripts:

- `npm run build` creates a production build in `web/dist`.
- `npm run lint` runs oxlint.

Routes:

- `/` is the landing page.
- `/login` is the login form.
  It is UI only for now, because authentication arrives with the API.

## Running the API

Requires Python 3.12 or newer. See `api/README.md` for the full setup.

```bash
cd api
pip install -r requirements-dev.txt
fastapi dev
```

Then feed it a trip without needing a phone:

```bash
python mock/phone.py --duration 60 --potholes 12 31 47.5 --out batch.json
curl -X POST http://127.0.0.1:8000/v1/batches -H 'content-type: application/json' -d @batch.json
```

To reproduce the detection and false-positive numbers:

```bash
python data/analysis/validate.py
```

To fill the database with a synthetic fleet and score the detector against 31
labelled test and edge cases:

```bash
python mock/seed_db.py --reset
```

## Design

- The app name uses the Fredoka font.
  Everything else uses DM Sans.
- The look is flat and editorial: warm off-white, asphalt black, and road-marking amber as the single accent.
- Icons come from Phosphor.

## Reporting to CDOT

Chicago runs an Open311 endpoint, so a confirmed pothole can be filed directly
rather than through the public web form. The service builds the request
(service code `4fd3b656e750846c53000004`, "Pothole in Street Complaint").

Nothing is filed automatically. Submission needs an API key and an explicit
confirmation from an operator, defaults to the City's test endpoint, and refuses
the production endpoint outright -- every request opens a work order against a
real road crew's queue.

## Configuration

Secrets live in `.env`, which is gitignored.
Never commit it.

| Variable | Purpose |
| --- | --- |
| `POTHOLO_DATABASE_URL` | Database connection URL |
| `CHI311_API_KEY` | Chicago Open311 key, required before anything can be filed |
