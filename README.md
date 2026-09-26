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
| Web app (`web/`) | In progress | React landing page, login, and a simulated pothole demo. |
| Data processing API | Planned | FastAPI. This is real, not mocked. |
| Mobile app | Not started | React Native. Out of scope for the prototype. |

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
  CLAUDE.md       Instructions for coding agents
  AGENT.md        Symlink to CLAUDE.md
```

A FastAPI service directory will be added when backend work starts.

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
- `/demo` is a simulated drive through a pothole with mock phone readings.
- `/login` is the login form.
  It is UI only for now, because authentication arrives with the API.

## Design

- The app name uses the Fredoka font.
  Everything else uses DM Sans.
- The look is flat and editorial: warm off-white, asphalt black, and road-marking amber as the single accent.
- Icons come from Phosphor.

## Configuration

Secrets live in `.env`, which is gitignored.
Never commit it.
