# Services (`src/`)

Each service is a Python package with its own Dockerfile and `requirements.txt`. All share the helpers in `src/common/` (DB access, dispatcher loop, Prometheus metrics, structured logging).

## src/api — FastAPI control plane

- **Entry**: `src/api/main.py`
- **Image**: `aidemo/api`
- **Port**: 8000 (HTTP), `/metrics` for Prometheus
- **Service in cluster**: `aidemo-api.aks-ai-demo.svc:8000` (ClusterIP)

### Endpoints

```
GET    /healthz
GET    /devices                              fleet + latest telemetry per device
GET    /devices/{id}/telemetry?hours=24&limit=20000
PATCH  /devices/{id}                         { "setpoint_c": 23.5 }
GET    /jobs?limit=50
POST   /jobs/forecast                        { device_id, horizon, num_samples }
POST   /jobs/rl                              { algo, total_steps, learning_rate, seed? }
GET    /results/forecast?limit=50
GET    /results/rl?limit=50
GET    /cluster/gpu                          GPU pool + worker pod schedule reasons
GET    /metrics                              Prometheus exposition
```

### Environment

```
PGHOST, PGUSER, PGDATABASE, PGPORT, PGSSLMODE, PG_USE_PASSWORD, PGPASSWORD
SERVICEBUS_FQDN
FORECAST_QUEUE=forecast-jobs
RL_QUEUE=rl-jobs
AZURE_CLIENT_ID, AZURE_TENANT_ID                # Workload Identity
GPU_NODE_LABEL=workload=gpu-recon
GPU_NAMESPACE=aks-ai-demo
```

### External calls

- Postgres for all state read/write.
- Service Bus `send` for queueing jobs.
- Kubernetes `CoreV1Api` (in-cluster config) for `/cluster/gpu` (lists nodes by label and pods in the namespace, classifies the pool state as `offline | scaling | starting | blocked | ready`).

## src/devices — HVAC simulator

- **Entry**: `src/devices/simulator.py`
- **Image**: `aidemo/simulator`
- **Port**: 9090 (metrics only)

Generates a fleet of `DEVICE_COUNT` (default 8) virtual rooms across a small set of room types (lobby, office-1/2, lab, server-room, meeting). Every `TICK_SECONDS` (default 5) it samples weather, updates indoor temperature with a hysteresis-based AC controller, and writes a row to `device_telemetry`. Setpoints set by the API via PATCH are picked up by `db.fetch_setpoints()` every tick (was every 30s; tightened to ~5s in `0.1.2`).

### Environment

```
DEVICE_COUNT=8
TICK_SECONDS=5
SIM_SPEED=1                # >1 accelerates simulated time vs wall clock
METRICS_PORT=9090
PG*                        # same as API
```

### Prometheus metrics

`device_indoor_c{device_id}`, `device_outdoor_c`, `device_occupants`, `device_energy_w`, `telemetry_total`.

## src/forecast — Chronos-2 worker

- **Entry**: `src/forecast/worker.py`
- **Image**: `aidemo/forecast` (CUDA 12.1 base, `torch==2.5.1+cu121`)
- **GPU**: requests `nvidia.com/gpu: 1`
- **Scheduling**: `nodeSelector: workload=gpu-recon`, toleration `nvidia.com/gpu=present:NoSchedule`

Loop driven by `common.dispatcher.run("forecast", FORECAST_QUEUE, handle)`:

1. Receive message in PEEK_LOCK mode.
2. Load Chronos pipeline (`amazon/chronos-2` by default).
3. Pull either the in-message `context` series or generate a synthetic one.
4. Generate quantile forecast for `horizon` steps, take the median.
5. Optional MAPE against a holdout slice.
6. `db.save_forecast(job_id, dataset, horizon, forecast, mape)` and complete the message.
7. Exit when the queue has been idle for `IDLE_EXIT_SECONDS` so KEDA scales the deployment back to 0.

### Environment

```
SERVICEBUS_FQDN, SERVICEBUS_QUEUE=forecast-jobs
CHRONOS_MODEL=amazon/chronos-2
REQUIRE_GPU=1                # raises if no CUDA
IDLE_EXIT_SECONDS=30
METRICS_PORT=9090
PG*, AZURE_CLIENT_ID, AZURE_TENANT_ID
```

## src/rl — Stable-Baselines3 worker

- **Entry**: `src/rl/worker.py`
- **Image**: `aidemo/rl` (CUDA 12.1, torch 2.5.1, `stable-baselines3 2.4`, `gymnasium 1.0`)
- **GPU**: requests `nvidia.com/gpu: 1` (time-sliced 4× via nvidia-device-plugin)
- **maxReplicas**: 4 (one per logical GPU slice)

Loop:

1. Receive job from `rl-jobs`.
2. Build `HvacRoomEnv` (Gymnasium, 5-dim observation, 5 discrete actions; reward `-|indoor − setpoint| − energy_cost − occupant_discomfort`).
3. Train PPO or DQN (`MlpPolicy`, `n_envs=8`) for `total_steps`.
4. Evaluate mean reward over 5 episodes; collect a reward curve via callback.
5. Optionally upload `policy.zip` to Blob `artifacts/rl/{job_id}/policy.zip`.
6. Save row to `rl_results`, complete the message.

### Environment

```
SERVICEBUS_FQDN, SERVICEBUS_QUEUE=rl-jobs
BLOB_ACCOUNT_URL, BLOB_CONTAINER=artifacts
REQUIRE_GPU=1
IDLE_EXIT_SECONDS=30
METRICS_PORT=9090
PG*, AZURE_CLIENT_ID, AZURE_TENANT_ID
```

### Throughput note

Measured on the demo cluster: PPO ≈ **740 steps/sec** on a time-sliced A100. Combined with Service Bus's 5-minute lock cap, that means a single message must complete within ≈ **220 000 steps**. Larger jobs need `AutoLockRenewer` in `dispatcher.py` (see [operations.md](operations.md)).

## src/common — Shared library

| Module | Responsibility |
|--------|----------------|
| `db.py` | Postgres connection (AAD token via `DefaultAzureCredential` or PGPASSWORD), schema bootstrap, all CRUD helpers |
| `dispatcher.py` | Generic Service Bus PEEK_LOCK loop with handler injection, status transitions, metrics, idle exit |
| `metrics.py` | Prometheus counters/histograms (`JOB_TOTAL`, `JOB_DURATION`, device gauges, etc.) |
| `logging_setup.py` | Structured JSON logger via `python-json-logger` |
| `auth.py` | Helpers around `DefaultAzureCredential` and AAD token acquisition for Postgres |
