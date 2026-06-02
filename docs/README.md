# aks-ai-demo — Documentation

End-to-end Azure / AKS demo that combines:

- A **fleet of simulated HVAC devices** producing realtime telemetry into PostgreSQL.
- A **FastAPI control plane** that exposes the fleet, queues ML jobs, and proxies cluster introspection.
- Two GPU workloads on a time-sliced A100:
  - **Forecast worker** running Amazon Chronos-2 time-series forecasts.
  - **RL worker** training Stable-Baselines3 PPO/DQN policies on a Gymnasium HVAC environment.
- A **Next.js 14 dashboard** that visualizes everything (devices, jobs, results, GPU pool, architecture).
- Full **observability** via kube-prometheus-stack, DCGM exporter, and Grafana dashboards.
- **KEDA** scale-to-zero workers triggered by Azure Service Bus queue depth.

## Documentation map

| Document | What's in it |
|----------|--------------|
| [architecture.md](architecture.md) | High-level diagram, data flow, design decisions |
| [services.md](services.md) | Each `src/*` service: entry point, env vars, ports, dependencies |
| [web-app.md](web-app.md) | Next.js app structure, pages, components, API proxy, theme |
| [data-model.md](data-model.md) | PostgreSQL schema and DB helper functions |
| [job-pipeline.md](job-pipeline.md) | Forecast and RL submission → Service Bus → worker → result |
| [infrastructure.md](infrastructure.md) | Terraform-provisioned Azure resources |
| [helm-chart.md](helm-chart.md) | `deploy/helm/aks-ai-demo` values and templates |
| [deployment.md](deployment.md) | Bootstrap → infra → monitoring → images → helm |
| [monitoring.md](monitoring.md) | Prometheus, Grafana, DCGM, ServiceMonitors |
| [operations.md](operations.md) | Runbooks, gotchas, common failures and fixes |
| [reference.md](reference.md) | Environment variable matrix, endpoints, scripts, tests |
| [../.github/README.md](../.github/README.md) | GitHub Actions workflows (CI, image build, AKS deploy, Terraform) |

## Read by task

| If you want to... | Read this first |
|-------------------|-----------------|
| Understand system flow and design decisions | [architecture.md](architecture.md) |
| Deploy from scratch in Azure | [deployment.md](deployment.md) |
| Operate and troubleshoot a live cluster | [operations.md](operations.md) |
| Tune service-level environment variables | [services.md](services.md) + [reference.md](reference.md) |
| Update Helm values/templates | [helm-chart.md](helm-chart.md) |
| Understand data persisted in PostgreSQL | [data-model.md](data-model.md) |
| Work on the dashboard UI | [web-app.md](web-app.md) |

## Live endpoints

| Service | URL |
|---------|-----|
| Web UI (LoadBalancer) | http://52.142.236.176 |
| API (via web `/api` proxy) | http://52.142.236.176/api |
| Grafana (LoadBalancer) | http://52.157.251.61 |

## Repo layout

```
aks-ai-demo/
├── src/                    # Python services (api, devices, forecast, rl, common)
├── web/                    # Next.js 14 dashboard
├── deploy/                 # Helm chart + Grafana dashboard JSON
├── infra/                  # Terraform (Azure resources, AKS namespace, UAMI)
├── scripts/                # PowerShell automation (build/push/deploy/monitoring)
├── cli/                    # Optional Python CLI to submit jobs directly
├── tests/                  # Smoke tests (env, metrics, logging)
└── docs/                   # ← you are here
```
