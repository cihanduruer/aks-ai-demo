# Reference

## Endpoints

| Service | URL | Notes |
|---------|-----|-------|
| Web UI | http://52.142.236.176 | LoadBalancer |
| API (proxied) | http://52.142.236.176/api | Same LB; goes through Next.js `/api` route |
| API (in cluster) | `http://aidemo-api.aks-ai-demo.svc:8000` | ClusterIP |
| Grafana | http://52.157.251.61 | LoadBalancer; anonymous Viewer |
| Prometheus (in cluster) | `http://prometheus.monitoring.svc.cluster.local:9090` | |

## Azure resource names (current demo)

| Kind | Name |
|------|------|
| AKS cluster | `splatix-prod-aks` (RG `splatix.nl-prod`) |
| AKS GPU node pool | `gpurecon` (NC24ads_A100_v4, autoscale 0..1) |
| ACR | `aidemoacrm23gd3` |
| Service Bus namespace | `aidemo-sb-m23gd3` (RG `aks-ai-demo`) |
| SB queues | `forecast-jobs`, `rl-jobs` (lock PT5M) |
| Postgres Flex | `aidemo-pg-m23gd3.postgres.database.azure.com`, db `aidemo` |
| Storage | `aidemoartm23gd3`, container `artifacts` |
| UAMI | `aidemo-workload-id`, client_id `41a75acf-2c75-4ff6-9223-70dcfa208338` |
| Tenant | `a01cc91b-6d33-4777-9c32-0b02b5cd3473` |

## Environment variables matrix

| Variable | API | Sim | Forecast | RL | Web |
|---------|:---:|:---:|:---:|:---:|:---:|
| `PGHOST` / `PGUSER` / `PGDATABASE` / `PGPORT` / `PGSSLMODE` | ✓ | ✓ | ✓ | ✓ | – |
| `PG_USE_PASSWORD` / `PGPASSWORD` (local only) | ✓ | ✓ | ✓ | ✓ | – |
| `SERVICEBUS_FQDN` | ✓ | – | ✓ | ✓ | – |
| `FORECAST_QUEUE` (`forecast-jobs`) | ✓ | – | – | – | – |
| `RL_QUEUE` (`rl-jobs`) | ✓ | – | – | – | – |
| `SERVICEBUS_QUEUE` | – | – | ✓ | ✓ | – |
| `BLOB_ACCOUNT_URL` / `BLOB_CONTAINER` | – | – | – | ✓ | – |
| `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` (Workload Identity) | ✓ | ✓ | ✓ | ✓ | – |
| `CHRONOS_MODEL` (`amazon/chronos-2`) | – | – | ✓ | – | – |
| `REQUIRE_GPU` (`1`) | – | – | ✓ | ✓ | – |
| `IDLE_EXIT_SECONDS` (`30`) | – | – | ✓ | ✓ | – |
| `METRICS_PORT` (`9090`) | – | ✓ | ✓ | ✓ | – |
| `DEVICE_COUNT` / `TICK_SECONDS` / `SIM_SPEED` | – | ✓ | – | – | – |
| `GPU_NODE_LABEL` / `GPU_NAMESPACE` | ✓ | – | – | – | – |
| `NEXT_PUBLIC_API_BASE` (`/api`) | – | – | – | – | ✓ |
| `API_TARGET` (`http://aidemo-api:8000`) | – | – | – | – | ✓ |
| `GRAFANA_URL` | – | – | – | – | ✓ |

## Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `tf-bootstrap.ps1` | Create the storage account + container that backs Terraform remote state, then `terraform init` |
| `build-and-push.ps1` | Build and push all five images to ACR |
| `deploy-helm.ps1` | Read `terraform output -json` and `helm upgrade --install` the chart |
| `install-monitoring.ps1` | Install kube-prometheus-stack + DCGM + nvidia-device-plugin (idempotent) |
| `run-web-local.ps1` | Port-forward API and run the web image locally for development |
| `submit-rl-batch.ps1` | Submit a sweep of RL jobs (algo / lr / seed) for demos |

## Tests (`tests/test_smoke.py`)

```python
def test_hvac_env_runs():
    env = HvacRoomEnv(seed=0)
    obs, _ = env.reset()
    assert obs.shape == (5,)
    for _ in range(96):
        env.step(env.action_space.sample())

def test_metrics_module_imports():
    from common import metrics
    assert metrics.JOB_TOTAL is not None

def test_logging_setup():
    from common.logging_setup import get_logger
    log = get_logger("test")
    log.info("hello", extra={"k": "v"})
```

Run with `pytest tests/`.

## Image tags (current)

| Image | Tag |
|-------|-----|
| `aidemo/api` | `0.1.6` |
| `aidemo/web` | `0.1.22` |
| `aidemo/simulator` | `0.1.2` |
| `aidemo/forecast` | `0.2.0` |
| `aidemo/rl` | `0.1.2` |

## Useful one-liners

```powershell
# Tail every worker pod
kubectl -n aks-ai-demo logs -f -l app=rl-worker --max-log-requests=8

# Show GPU node state
$node = (kubectl get nodes -l workload=gpu-recon -o jsonpath='{.items[0].metadata.name}')
kubectl describe node $node | Select-String 'nvidia|Capacity:|Allocatable:'

# Latest jobs
curl -s http://52.142.236.176/api/jobs?limit=10 | ConvertFrom-Json | Format-Table id,type,status,created_at,finished_at

# GPU pool state from API
curl -s http://52.142.236.176/api/cluster/gpu | ConvertFrom-Json
```
