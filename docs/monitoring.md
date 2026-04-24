# Monitoring

Installed by `scripts/install-monitoring.ps1` into the `monitoring` namespace.

## Stack

| Component | Purpose | Notes |
|-----------|---------|-------|
| `kube-prometheus-stack` | Prometheus + Grafana + Node Exporter | AlertManager and `kube-apiserver / controller-manager / scheduler / etcd` scrapers disabled (not exposed on AKS) |
| `nvidia-device-plugin` | Advertises `nvidia.com/gpu` resource on GPU nodes | Time-sliced 4× per A100 (`replicas: 4`); selects on `nvidia.com/gpu.present=true` |
| `dcgm-exporter` | GPU utilization / mem / temp / SM clock | Daemonset, schedules only on `workload=gpu-recon` |
| Grafana dashboards | DCGM dashboard ConfigMap | Auto-discovered via `grafana_dashboard=1` label |

## Prometheus

- Retention: 6 h (demo).
- Scrape interval: 15 s.
- Discovers ServiceMonitors **cluster-wide** (the chart's release label is `release: kps`).

## Grafana

- LoadBalancer service, anonymous Viewer enabled, embeddable in iframes.
- Default credentials configured by chart (`admin / prom-operator`).
- The web UI's dashboard page embeds Grafana panels via the `web.grafanaUrl` value.

## ServiceMonitors (chart)

Created when `serviceMonitor.enabled: true`:

| Name | Selector | Port | Interval |
|------|----------|------|----------|
| `aidemo-api` | `app=aidemo-api` | `metrics` (8000) | 15 s |
| `aidemo-forecast` | `app=forecast-worker` | `metrics` (9090) | 15 s |
| `aidemo-rl` | `app=rl-worker` | `metrics` (9090) | 15 s |

DCGM exporter has its own ServiceMonitor in the `monitoring` namespace.

## Application metrics

From `src/common/metrics.py`:

| Metric | Type | Labels |
|--------|------|--------|
| `job_total` | Counter | `type`, `status` |
| `job_duration_seconds` | Histogram | `type` |
| `device_indoor_c` | Gauge | `device_id` |
| `device_outdoor_c` | Gauge | `device_id` |
| `device_occupants` | Gauge | `device_id` |
| `device_energy_w` | Gauge | `device_id` |
| `telemetry_total` | Counter | `device_id` |
| `forecast_mape` | Gauge | `dataset` |
| `rl_mean_reward` | Gauge | `algo` |

## Sample queries

```promql
# Job throughput last 5 min
sum by (type, status) (rate(job_total[5m]))

# A100 utilization
DCGM_FI_DEV_GPU_UTIL{Hostname=~"aks-gpurecon-.*"}

# Telemetry rate per device
rate(telemetry_total[1m])

# Recent forecast accuracy
forecast_mape{dataset="dev-000"}
```

## Endpoints

| Service | URL |
|---------|-----|
| Grafana | `http://52.157.251.61` |
| Prometheus (in-cluster) | `http://prometheus.monitoring.svc.cluster.local:9090` |
