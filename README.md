# aks-ai-demo

Two AI workloads on AKS, queued via Azure Service Bus, autoscaled with KEDA,
observed with Prometheus + Grafana, results in PostgreSQL, all visualized in a
Next.js + shadcn/ui dashboard.

## Start here

- New to the project? Read the docs index: [`docs/README.md`](docs/README.md).
- Need a full deployment flow? Go straight to [`docs/deployment.md`](docs/deployment.md).
- Need runbooks and troubleshooting? See [`docs/operations.md`](docs/operations.md).
- Need environment variables, scripts, and test commands? See [`docs/reference.md`](docs/reference.md).

## Components

| Component | Path | What it does |
|---|---|---|
| Forecast worker | `src/forecast/` | Chronos-2 inference on A100 GPU |
| RL worker | `src/rl/` | Stable-Baselines3 PPO/DQN on a custom HVAC `gymnasium` env |
| Device simulator | `src/devices/` | Generates HVAC telemetry (8 virtual rooms by default) |
| API | `src/api/` | FastAPI: devices, telemetry, jobs, results, submit endpoints |
| Web | `web/` | Next.js 14 + Tailwind + shadcn/ui dashboard with live charts |
| CLI | `cli/submit.py` | Push messages to Service Bus from the terminal |
| Infra | `infra/terraform/` | RG, ACR, Service Bus, PostgreSQL Flex, Storage, UAMI, AKS namespace |
| Helm | `deploy/helm/aks-ai-demo/` | All deployments + KEDA scalers + ServiceMonitors |

## Prerequisites
Azure CLI, Docker, kubectl, helm ≥ 3.14, Terraform ≥ 1.6, Python 3.11.
You must already be `az login`'d into the subscription that owns
`splatix-prod-aks` (RG `splatix.nl-prod`, westeurope).

## Bring-up

```powershell
# 1) Provision infra (creates RG aks-ai-demo and everything inside it)
./scripts/tf-bootstrap.ps1
terraform -chdir=infra/terraform apply tfplan

# 2) Install Prometheus + DCGM (skips if already present)
./scripts/install-monitoring.ps1

# 3) Build & push images to the new ACR
./scripts/build-and-push.ps1

# 4) Install the chart (renders values from Terraform outputs)
./scripts/deploy-helm.ps1

# 5) Open the dashboard
kubectl -n aks-ai-demo get svc aidemo-web    # external IP
```

After deployment, verify core workloads are healthy:

```powershell
kubectl -n aks-ai-demo get pods
kubectl -n monitoring get pods
```

## Run a demo

```powershell
# A) Through the UI:  click "Run forecast" on a device tile, "Submit RL job" on /jobs
# B) From the CLI:
$env:SERVICEBUS_FQDN = (terraform -chdir=infra/terraform output -raw servicebus_fqdn)
python -m cli.submit both --count 5
```

KEDA will scale `forecast-worker` (A100 pool) and `rl-worker` (CPU pool) from
0 to N pods based on queue depth, then back to 0 when idle.

## Observability

* Prometheus: `kubectl -n monitoring port-forward svc/kube-prometheus-stack-prometheus 9090`
* Grafana:    `kubectl -n monitoring get svc kube-prometheus-stack-grafana`
  (admin / admin) — import `deploy/grafana/aks-ai-demo-dashboard.json`.

Useful PromQL:
* `aidemo_forecast_mape`
* `aidemo_rl_mean_reward`
* `histogram_quantile(0.95, sum(rate(aidemo_job_duration_seconds_bucket[5m])) by (le, job_type))`
* `aidemo_device_indoor_temp_c`
* `DCGM_FI_DEV_GPU_UTIL`

## Costs (approx. westeurope)
* PostgreSQL Flex B1ms: ~$13/mo
* Service Bus Standard: ~$10/mo
* Storage Standard LRS: <$1/mo
* ACR Basic: ~$5/mo
* AKS GPU pool: only when KEDA scales up (`count=0` at idle)

## Teardown
```powershell
terraform -chdir=infra/terraform destroy
```
This removes the `aks-ai-demo` RG; the existing AKS cluster is untouched.

## Architecture
```
[Web (Next.js+shadcn)] -> [API (FastAPI)] -> [PostgreSQL]
                                       \
                                        \-> [Service Bus] --(KEDA)--> [Forecast Worker (A100)]
                                                                  \-> [RL Worker (CPU)]
[Device Simulator] -----> [PostgreSQL]
[All workers] --> Prometheus --> Grafana
```
