FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /srv

# Same dependencies as the API: seed_db.py runs batches through the real
# pipeline, not a mock of it, so it needs sqlalchemy, numpy and friends too.
COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

COPY api/app ./api/app
COPY mock ./mock

# The same volume-backed database file the api service writes to.
ENV POTHOLO_DATABASE_URL=sqlite:////data/potholo.db
VOLUME /data

# Only seeds an empty database: a volume that already has data from a
# previous run is left alone, so restarting the stack does not duplicate the
# scenario catalogue and corridor on top of whatever is already there.
CMD ["sh", "-c", "test -f /data/potholo.db || python mock/seed_db.py"]
