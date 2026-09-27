FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /srv/api

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# The SQLite file lives on a volume so it survives redeploys.
ENV POTHOLO_DATABASE_URL=sqlite:////data/potholo.db
RUN useradd --system --uid 10001 potholo && mkdir /data && chown potholo /data
USER potholo
VOLUME /data

EXPOSE 8044
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8044/health')"

CMD ["fastapi", "run", "--host", "0.0.0.0", "--port", "8044", "--proxy-headers"]
