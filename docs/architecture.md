# Architecture

## High-level flow

```
                              ┌────────────────────────┐
                              │  Browser               │
                              │  (Next.js 14, Tailwind)│
                              └─────────┬──────────────┘
                                        │ HTTP
                                ┌───────▼────────┐
                                │  Web pod       │
                                │  /api/* proxy  │
                                └───────┬────────┘
                                        │ in-cluster
                                ┌───────▼─────────┐
                          ┌─────│  API (FastAPI)  │─────┐
                          │     └─────────────────┘     │
              GET/PATCH   │                             │ POST /jobs/{forecast,rl}
                          │                             │
                  ┌───────▼─────────┐         ┌─────────▼────────────┐
                  │ PostgreSQL      │         │ Azure Service Bus    │
                  │ (Flexible)      │         │ forecast-jobs queue  │
                  │                 │         │ rl-jobs queue        │
                  │ devices         │         └──┬───────────────┬───┘
                  │ device_telemetry│            │ KEDA scaler   │
                  │ jobs            │            │ (queue depth) │
                  │ forecast_results│       ┌────▼────────┐ ┌────▼────────┐
                  │ rl_results      │       │ forecast    │ │ rl-worker   │
                  └────────▲────────┘       │ -worker     │ │ (PPO/DQN)   │
                           │                │ (Chronos-2) │ │             │
              insert/update│                └──┬──────────┘ └──┬──────────┘
                           │                   │ saves         │ uploads policy.zip
                  ┌────────┴─────────┐         │               │
                  │ device-simulator │         └───────┬───────┘
                  │ (8 rooms, 5s tick│                 │
                  └──────────────────┘         ┌───────▼─────────┐
                                               │ Blob Storage    │
                                               │ artifacts/      │
                                               └─────────────────┘

  All workloads emit Prometheus metrics → kube-prometheus-stack → Grafana.
  GPU node also runs DCGM exporter and nvidia-device-plugin (time-sliced 4×).
```

## Components by layer

| Layer | Components |
|-------|------------|
| **UI** | Next.js 14, React 18, Tailwind, shadcn/ui, d3, SWR |
| **API** | FastAPI + uvicorn, psycopg, azure-servicebus, kubernetes client |
| **Workers** | Forecast (`torch + chronos-forecasting`), RL (`stable-baselines3 + gymnasium`) |
| **Simulator** | Pure Python, NumPy weather model, writes telemetry to Postgres |
| **Messaging** | Azure Service Bus (Standard, two queues, lock PT5M, TTL PT2H) |
| **Storage** | Azure Postgres Flex (state), Azure Blob (RL policy artifacts) |
| **Identity** | UAMI + Workload Identity Federation; ServiceAccount `aidemo-worker` |
| **Compute** | AKS `splatix-prod-aks` in RG `splatix.nl-prod`. System pool + `gpurecon` (NC24ads_A100_v4 autoscale 0..1) |
| **Scaling** | KEDA `ScaledObject` per worker, scaled by Service Bus queue depth (queueLength=1) |
| **Observability** | kube-prometheus-stack, DCGM exporter, ServiceMonitors per service |

## Key design decisions

| Decision | Rationale |
|---------|-----------|
| Service Bus + KEDA | Scale-to-zero workers; queue depth is the natural backpressure signal |
| Postgres Flex with AAD auth | Structured schema, foreign keys, no secrets in cluster |
| Time-sliced single A100 (4 logical GPUs) | Cost: NC24ads_A100_v4 × 1 vs multiple smaller GPUs; demo workloads are short |
| One pod per message | Simplifies orchestration; KEDA spins pod per queue item |
| Next.js server-side `/api` proxy | Single LB IP for browser; in-cluster DNS for API |
| Workload Identity (no static secrets) | Pods get federated tokens; nothing to rotate |
| Chronos-2 (encoder-only) | No `transformers` version pinning required vs Chronos-Bolt |
| Prometheus + Grafana | Open-source; embeds cleanly in the dashboard via iframe |

See [services.md](services.md) for per-component detail and [job-pipeline.md](job-pipeline.md) for end-to-end traces.
