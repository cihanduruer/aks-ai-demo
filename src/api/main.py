"""Read-only-ish API for the dashboard.

Exposes:
  GET  /devices                   -> fleet
  GET  /devices/{id}/telemetry    -> recent rows
  GET  /jobs                      -> jobs
  GET  /results/forecast          -> forecast results
  GET  /results/rl                -> RL results
  POST /jobs/forecast             -> enqueue a forecast job (uses device series)
  POST /jobs/rl                   -> enqueue an RL training job
  GET  /healthz
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from azure.identity import DefaultAzureCredential
from azure.servicebus import ServiceBusClient, ServiceBusMessage
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import make_asgi_app
from pydantic import BaseModel, Field

from common import db

app = FastAPI(title="aks-ai-demo")

_cors_origins_env = os.environ.get("CORS_ALLOWED_ORIGINS", "")
_cors_origins: list[str] = (
    [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
    if _cors_origins_env
    else ["*"]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept", "X-Requested-With"],
)
app.mount("/metrics", make_asgi_app())


class ForecastReq(BaseModel):
    device_id: str
    horizon: int = Field(default=24, ge=1, le=168)
    num_samples: int = Field(default=20, ge=1, le=100)


class RlReq(BaseModel):
    algo: Literal["PPO", "DQN"] = "PPO"
    total_steps: int = Field(default=20000, ge=1000, le=10_000_000)
    learning_rate: float = Field(default=3e-4, gt=0.0, le=1.0)
    seed: int | None = None


class SetpointReq(BaseModel):
    setpoint_c: float


def _sb() -> ServiceBusClient:
    return ServiceBusClient(os.environ["SERVICEBUS_FQDN"], DefaultAzureCredential())


def _send(queue: str, payload: dict[str, Any]) -> str:
    mid = str(uuid.uuid4())
    with _sb() as sb, sb.get_queue_sender(queue) as sender:
        sender.send_messages(ServiceBusMessage(json.dumps(payload), message_id=mid))
    return mid


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/devices")
def devices() -> list[dict[str, Any]]:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT d.id, d.name, d.room, d.setpoint_c::float8 AS setpoint_c, "
            "  (SELECT row_to_json(t) FROM ("
            "    SELECT ts, occupants, outdoor_temp_c::float8 AS outdoor_temp_c, "
            "           outdoor_humidity::float8 AS outdoor_humidity, "
            "           indoor_temp_c::float8 AS indoor_temp_c, "
            "           energy_w::float8 AS energy_w, action "
            "    FROM device_telemetry WHERE device_id=d.id "
            "    ORDER BY ts DESC LIMIT 1) t) AS latest "
            "FROM devices d ORDER BY d.id"
        )
        cols = [c.name for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


@app.get("/devices/{device_id}/telemetry")
def telemetry(device_id: str, limit: int = 200, hours: float | None = None) -> list[dict[str, Any]]:
    with db.connect() as conn, conn.cursor() as cur:
        if hours is not None and hours > 0:
            cur.execute(
                "SELECT ts, occupants, outdoor_temp_c::float8 AS outdoor_temp_c, "
                "outdoor_humidity::float8 AS outdoor_humidity, "
                "indoor_temp_c::float8 AS indoor_temp_c, setpoint_c::float8 AS setpoint_c, "
                "energy_w::float8 AS energy_w, action "
                "FROM device_telemetry "
                "WHERE device_id=%s AND ts >= NOW() - (%s || ' hours')::interval "
                "ORDER BY ts DESC LIMIT %s",
                (device_id, str(hours), min(limit, 50000)),
            )
        else:
            cur.execute(
                "SELECT ts, occupants, outdoor_temp_c::float8 AS outdoor_temp_c, "
                "outdoor_humidity::float8 AS outdoor_humidity, "
                "indoor_temp_c::float8 AS indoor_temp_c, setpoint_c::float8 AS setpoint_c, "
                "energy_w::float8 AS energy_w, action "
                "FROM device_telemetry WHERE device_id=%s ORDER BY ts DESC LIMIT %s",
                (device_id, min(limit, 50000)),
            )
        cols = [c.name for c in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    rows.reverse()
    return rows


@app.patch("/devices/{device_id}")
def update_device(device_id: str, req: SetpointReq) -> dict[str, Any]:
    sp = float(req.setpoint_c)
    if sp < 10.0 or sp > 32.0:
        raise HTTPException(status_code=400, detail="setpoint_c out of range (10–32)")
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE devices SET setpoint_c=%s WHERE id=%s RETURNING id, setpoint_c::float8",
            (sp, device_id),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="device not found")
    return {"id": row[0], "setpoint_c": row[1]}


@app.get("/jobs")
def jobs(limit: int = 50) -> list[dict[str, Any]]:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, type, status, message_id, created_at, started_at, "
            "finished_at, error FROM jobs ORDER BY created_at DESC LIMIT %s",
            (min(limit, 500),),
        )
        cols = [c.name for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


@app.get("/results/forecast")
def forecast_results(limit: int = 50) -> list[dict[str, Any]]:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT job_id, dataset, horizon, mape, forecast, created_at "
            "FROM forecast_results ORDER BY created_at DESC LIMIT %s",
            (min(limit, 500),),
        )
        cols = [c.name for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


@app.get("/results/rl")
def rl_results(limit: int = 50) -> list[dict[str, Any]]:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT job_id, algo, total_steps, mean_reward, reward_curve, "
            "policy_uri, created_at FROM rl_results "
            "ORDER BY created_at DESC LIMIT %s",
            (min(limit, 500),),
        )
        cols = [c.name for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


@app.post("/jobs/forecast")
def submit_forecast(req: ForecastReq) -> dict[str, str]:
    series = db.recent_indoor_series(req.device_id, limit=256)
    if len(series) < 32:
        raise HTTPException(400, "device has insufficient telemetry yet")
    job_id = uuid.uuid4()
    payload = {
        "job_id": str(job_id),
        "dataset": req.device_id,
        "context": series,
        "horizon": req.horizon,
        "num_samples": req.num_samples,
    }
    mid = _send(os.environ.get("FORECAST_QUEUE", "forecast-jobs"), payload)
    db.enqueue_job(job_id, "forecast", mid)
    return {"job_id": str(job_id), "message_id": mid}


@app.post("/jobs/rl")
def submit_rl(req: RlReq) -> dict[str, str]:
    job_id = uuid.uuid4()
    payload = req.model_dump()
    if payload.get("seed") is None:
        payload["seed"] = int(uuid.uuid4().int % 100000)
    payload["job_id"] = str(job_id)
    mid = _send(os.environ.get("RL_QUEUE", "rl-jobs"), payload)
    db.enqueue_job(job_id, "rl", mid)
    return {"job_id": str(job_id), "message_id": mid}


# ---------------------------------------------------------------------------
# Cluster / GPU node introspection
# ---------------------------------------------------------------------------

_GPU_LABEL = os.environ.get("GPU_NODE_LABEL", "workload=gpu-recon")
_GPU_NS = os.environ.get("GPU_NAMESPACE", os.environ.get("POD_NAMESPACE", "aks-ai-demo"))
_K8S_CORE = None  # type: ignore


def _k8s():
    """Return a cached CoreV1Api client, configured from the in-cluster SA token."""
    global _K8S_CORE
    if _K8S_CORE is not None:
        return _K8S_CORE
    from kubernetes import client, config  # type: ignore

    try:
        config.load_incluster_config()
    except Exception:
        config.load_kube_config()
    _K8S_CORE = client.CoreV1Api()
    return _K8S_CORE


def _node_ready(node) -> bool:
    for c in (node.status.conditions or []):
        if c.type == "Ready":
            return c.status == "True"
    return False


def _pod_schedule_status(pod) -> tuple[str, str]:
    """Return (reason, message) from PodScheduled condition; ('', '') if scheduled."""
    for c in (pod.status.conditions or []):
        if c.type == "PodScheduled" and c.status != "True":
            return (c.reason or "", c.message or "")
    return ("", "")


def _classify(nodes: list[dict[str, Any]], pods: list[dict[str, Any]]) -> str:
    """Return one of: offline | scaling | blocked | starting | ready.

    - offline:  no GPU nodes and no work waiting
    - scaling:  no nodes yet, pods waiting, scheduler hasn't yet declared them Unschedulable
                (or did so very recently — cluster-autoscaler may still react)
    - blocked:  no nodes and pods are Unschedulable for >60s (autoscaler refused to add a node;
                e.g. quota, missing toleration, taint mismatch). UI must NOT pretend we are scaling.
    - starting: a node exists but is not Ready yet, or pods are ContainerCreating
    - ready:    node Ready and pods Running
    """
    pending = [p for p in pods if p["phase"] == "Pending"]
    if not nodes:
        if not pending:
            return "offline"
        # If any pending pod has been Unschedulable for >60s, we are not actually scaling.
        now = datetime.now(timezone.utc)
        unsched_old = False
        for p in pending:
            if (p.get("schedule_reason") or "") == "Unschedulable":
                age = (now - datetime.fromisoformat(p["created_at"])).total_seconds() if p.get("created_at") else 0
                if age > 60:
                    unsched_old = True
                    break
        return "blocked" if unsched_old else "scaling"
    if any(not n["ready"] for n in nodes):
        return "starting"
    if any(p["phase"] in ("Pending", "ContainerCreating") for p in pods):
        return "starting"
    if any(p["phase"] == "Running" for p in pods):
        return "ready"
    return "ready"


@app.get("/cluster/gpu")
def cluster_gpu() -> dict[str, Any]:
    """Snapshot of GPU node pool + workload pods for the dashboard."""
    try:
        api = _k8s()
    except Exception as exc:
        raise HTTPException(503, f"kube client unavailable: {exc}") from exc

    label = _GPU_LABEL
    nodes_resp = api.list_node(label_selector=label)
    nodes: list[dict[str, Any]] = []
    for n in nodes_resp.items:
        cap = n.status.capacity or {}
        alloc = n.status.allocatable or {}
        nodes.append({
            "name": n.metadata.name,
            "ready": _node_ready(n),
            "created_at": n.metadata.creation_timestamp.isoformat() if n.metadata.creation_timestamp else None,
            "instance_type": (n.metadata.labels or {}).get("node.kubernetes.io/instance-type", ""),
            "gpu_capacity": int(cap.get("nvidia.com/gpu", 0) or 0),
            "gpu_allocatable": int(alloc.get("nvidia.com/gpu", 0) or 0),
            "kubelet_version": n.status.node_info.kubelet_version if n.status.node_info else "",
        })

    # workload pods we care about (forecast + rl in our namespace)
    pods_resp = api.list_namespaced_pod(
        namespace=_GPU_NS,
        label_selector="app in (forecast-worker,rl-worker)",
    )
    pods: list[dict[str, Any]] = []
    for p in pods_resp.items:
        ctrs: list[dict[str, Any]] = []
        for cs in (p.status.container_statuses or []):
            state = cs.state
            if state and state.running:
                state_name = "running"
                detail = state.running.started_at.isoformat() if state.running.started_at else ""
            elif state and state.waiting:
                state_name = "waiting"
                detail = state.waiting.reason or ""
            elif state and state.terminated:
                state_name = "terminated"
                detail = state.terminated.reason or ""
            else:
                state_name = "unknown"
                detail = ""
            ctrs.append({
                "name": cs.name,
                "ready": bool(cs.ready),
                "restarts": int(cs.restart_count or 0),
                "state": state_name,
                "detail": detail,
            })
        schedule_reason, schedule_message = _pod_schedule_status(p)
        pods.append({
            "name": p.metadata.name,
            "app": (p.metadata.labels or {}).get("app", ""),
            "phase": p.status.phase or "Unknown",
            "node": p.spec.node_name or "",
            "created_at": p.metadata.creation_timestamp.isoformat() if p.metadata.creation_timestamp else None,
            "started_at": p.status.start_time.isoformat() if p.status.start_time else None,
            "schedule_reason": schedule_reason,
            "schedule_message": schedule_message,
            "containers": ctrs,
        })

    summary = {
        "state": _classify(nodes, pods),
        "node_count": len(nodes),
        "ready_node_count": sum(1 for n in nodes if n["ready"]),
        "gpu_capacity": sum(n["gpu_capacity"] for n in nodes),
        "running_pods": sum(1 for p in pods if p["phase"] == "Running"),
        "pending_pods": sum(1 for p in pods if p["phase"] == "Pending"),
    }
    return {"summary": summary, "nodes": nodes, "pods": pods}
