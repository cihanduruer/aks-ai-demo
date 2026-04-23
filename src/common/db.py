"""Postgres helpers + lightweight migrations.

Connects via DefaultAzureCredential (Workload Identity in-cluster, az CLI locally).
Falls back to PGPASSWORD if PG_USE_PASSWORD=1.
"""
from __future__ import annotations

import json
import os
import uuid
from contextlib import contextmanager
from typing import Any, Iterator

import psycopg
from azure.identity import DefaultAzureCredential

_AAD_SCOPE = "https://ossrdbms-aad.database.windows.net/.default"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS jobs (
    id            UUID PRIMARY KEY,
    type          TEXT NOT NULL,
    status        TEXT NOT NULL,
    message_id    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,
    error         TEXT
);

CREATE TABLE IF NOT EXISTS forecast_results (
    job_id        UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    dataset       TEXT NOT NULL,
    horizon       INT  NOT NULL,
    forecast      JSONB NOT NULL,
    mape          NUMERIC,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rl_results (
    job_id        UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    algo          TEXT NOT NULL,
    total_steps   INT NOT NULL,
    mean_reward   NUMERIC,
    reward_curve  JSONB,
    policy_uri    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_type_status_idx ON jobs(type, status);

CREATE TABLE IF NOT EXISTS devices (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    room          TEXT NOT NULL,
    setpoint_c    NUMERIC NOT NULL DEFAULT 22.0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_telemetry (
    id              BIGSERIAL PRIMARY KEY,
    device_id       TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
    occupants       INT NOT NULL,
    outdoor_temp_c  NUMERIC NOT NULL,
    outdoor_humidity NUMERIC NOT NULL,
    indoor_temp_c   NUMERIC NOT NULL,
    setpoint_c      NUMERIC NOT NULL,
    energy_w        NUMERIC NOT NULL,
    action          TEXT
);
CREATE INDEX IF NOT EXISTS device_telemetry_device_ts_idx
    ON device_telemetry(device_id, ts DESC);
"""


def upsert_device(device_id: str, name: str, room: str, setpoint_c: float) -> None:
    """Insert device if missing; on conflict only refresh name/room and keep
    any user-adjusted setpoint already in the row."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO devices(id, name, room, setpoint_c) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, room=EXCLUDED.room",
            (device_id, name, room, setpoint_c),
        )


def fetch_setpoints() -> dict[str, float]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, setpoint_c::float8 FROM devices")
        return {r[0]: float(r[1]) for r in cur.fetchall()}


def insert_telemetry(device_id: str, occupants: int, out_t: float, out_h: float,
                     in_t: float, setpoint: float, energy_w: float,
                     action: str | None) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO device_telemetry(device_id, occupants, outdoor_temp_c, "
            "outdoor_humidity, indoor_temp_c, setpoint_c, energy_w, action) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (device_id, occupants, out_t, out_h, in_t, setpoint, energy_w, action),
        )


def recent_indoor_series(device_id: str, limit: int = 256) -> list[float]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT indoor_temp_c FROM device_telemetry WHERE device_id=%s "
            "ORDER BY ts DESC LIMIT %s",
            (device_id, limit),
        )
        rows = cur.fetchall()
    return [float(r[0]) for r in reversed(rows)]


def _password() -> str:
    if os.environ.get("PG_USE_PASSWORD") == "1":
        return os.environ["PGPASSWORD"]
    cred = DefaultAzureCredential()
    return cred.get_token(_AAD_SCOPE).token


def _conninfo() -> str:
    host = os.environ["PGHOST"]
    user = os.environ["PGUSER"]
    db = os.environ.get("PGDATABASE", "aidemo")
    port = os.environ.get("PGPORT", "5432")
    sslmode = os.environ.get("PGSSLMODE", "require")
    return f"host={host} port={port} dbname={db} user={user} sslmode={sslmode}"


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(_conninfo(), password=_password(), autocommit=True)
    try:
        yield conn
    finally:
        conn.close()


def ensure_schema() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(SCHEMA_SQL)


def insert_job(job_id: uuid.UUID, job_type: str, message_id: str | None) -> None:
    """Mark a job as running. If the row already exists (queued by API), update in place."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO jobs(id, type, status, message_id, started_at) "
            "VALUES (%s, %s, 'running', %s, now()) "
            "ON CONFLICT (id) DO UPDATE SET status='running', started_at=now(), "
            "  message_id=COALESCE(jobs.message_id, EXCLUDED.message_id)",
            (str(job_id), job_type, message_id),
        )


def enqueue_job(job_id: uuid.UUID, job_type: str, message_id: str | None) -> None:
    """Pre-create a job row in 'queued' state from the API at enqueue time."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO jobs(id, type, status, message_id) "
            "VALUES (%s, %s, 'queued', %s) "
            "ON CONFLICT (id) DO NOTHING",
            (str(job_id), job_type, message_id),
        )


def finish_job(job_id: uuid.UUID, status: str, error: str | None = None) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE jobs SET status=%s, finished_at=now(), error=%s WHERE id=%s",
            (status, error, str(job_id)),
        )


def save_forecast(job_id: uuid.UUID, dataset: str, horizon: int,
                  forecast: list[Any], mape: float | None) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO forecast_results(job_id, dataset, horizon, forecast, mape) "
            "VALUES (%s, %s, %s, %s::jsonb, %s) "
            "ON CONFLICT (job_id) DO UPDATE SET forecast=EXCLUDED.forecast, mape=EXCLUDED.mape",
            (str(job_id), dataset, horizon, json.dumps(forecast), mape),
        )


def save_rl(job_id: uuid.UUID, algo: str, total_steps: int,
            mean_reward: float, reward_curve: list[float],
            policy_uri: str | None) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO rl_results(job_id, algo, total_steps, mean_reward, reward_curve, policy_uri) "
            "VALUES (%s, %s, %s, %s, %s::jsonb, %s) "
            "ON CONFLICT (job_id) DO UPDATE SET mean_reward=EXCLUDED.mean_reward, "
            "reward_curve=EXCLUDED.reward_curve, policy_uri=EXCLUDED.policy_uri",
            (str(job_id), algo, total_steps, mean_reward,
             json.dumps(reward_curve), policy_uri),
        )
