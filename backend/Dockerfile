FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

# Stamped by the release process so a running container can say which commit it is.
ARG RELEASE_VERSION=unknown
ENV RELEASE_VERSION=$RELEASE_VERSION

# Run as a non-root user; the container needs no write access to its own filesystem.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8000/health/live || exit 1

# The migration is NOT run here. A4 §5.16: a schema change is a controlled release step with a
# backup in front of it, not something that happens implicitly every time a container restarts —
# a crash-looping container would otherwise replay migrations with nobody watching.
# Run `scripts/release_migrate.sh` (or `alembic upgrade head`) before starting a new version.
#
# One worker on purpose: the target VPS is 4 vCPU / 8 GB and already busy.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", \
     "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header"]
