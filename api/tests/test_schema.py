"""A database created before a model changed must be refused, not served."""

import pytest
from sqlalchemy import create_engine, text

from app.config import API_DIR, Settings
from app.models import Base
from app.schema import SchemaMismatchError, check_schema, schema_problems


@pytest.fixture
def engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'schema.db'}")
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


def test_fresh_database_matches_the_models(engine):
    assert schema_problems(engine) == []
    check_schema(engine)


def test_a_column_added_after_the_database_was_made_is_reported(engine):
    # This is the real failure: detecting_trip_count was added to the model, and
    # create_all does nothing to a table that already exists.
    with engine.begin() as conn:
        conn.execute(
            text("ALTER TABLE pothole_clusters DROP COLUMN detecting_trip_count")
        )

    assert schema_problems(engine) == [
        "column pothole_clusters.detecting_trip_count is missing"
    ]
    with pytest.raises(SchemaMismatchError, match="seed_db.py --reset"):
        check_schema(engine)


def test_a_missing_table_is_reported(engine):
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE devices"))
    assert schema_problems(engine) == ["table devices is missing"]


def test_default_database_does_not_depend_on_the_working_directory(monkeypatch):
    monkeypatch.delenv("POTHOLO_DATABASE_URL", raising=False)
    assert Settings().database_url == f"sqlite:///{API_DIR / 'potholo.db'}"
