"""Catch a database that no longer matches the models.

`Base.metadata.create_all` only creates tables that are missing.  It never adds a
column to a table that already exists, so after a model gains a field an older
database file keeps working right up until a query names the new column, and then
every route that touches that table fails with "no such column".

There are no migrations yet.  Until there are, the honest behaviour is to refuse
to start and say exactly what is wrong, instead of serving 500s.
"""

from __future__ import annotations

from sqlalchemy import Engine, inspect

from app.models import Base

RESET_HINT = (
    "The development database only holds generated data. Rebuild it with "
    "`python mock/seed_db.py --reset` (recreates every table and reseeds), or "
    "delete the SQLite file and restart."
)


class SchemaMismatchError(RuntimeError):
    """The database is missing tables or columns the models expect."""


def schema_problems(engine: Engine) -> list[str]:
    """What the models expect that the database does not have."""
    live = inspect(engine)
    existing_tables = set(live.get_table_names())
    problems = []
    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            problems.append(f"table {table.name} is missing")
            continue
        have = {column["name"] for column in live.get_columns(table.name)}
        problems.extend(
            f"column {table.name}.{column.name} is missing"
            for column in table.columns
            if column.name not in have
        )
    return problems


def check_schema(engine: Engine) -> None:
    """Raise `SchemaMismatchError` if the database is behind the models."""
    problems = schema_problems(engine)
    if problems:
        raise SchemaMismatchError(
            "Database schema is out of date: "
            + "; ".join(problems)
            + f". {RESET_HINT} Database: {engine.url.render_as_string()}"
        )
