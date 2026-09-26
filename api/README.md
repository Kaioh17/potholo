# Potholo API

FastAPI backend for Potholo. Uses SQLAlchemy with SQLite and UUID primary keys.
There is no auth yet, and the only route is `/health`.

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
tests/
```

## Adding a model

Subclass `Base` with `UUIDPrimaryKeyMixin` and, if needed, `TimestampMixin`.
Import the model in `app/models/__init__.py` so its table is created on startup.
