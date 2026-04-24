# Helm chart (`deploy/helm/aks-ai-demo`)

Single application chart that deploys all in-cluster components: API, web, simulator, forecast/rl workers, KEDA scalers, RBAC, and ServiceMonitors.

## Templates

| Template | Kind(s) | Purpose |
|----------|---------|---------|
| `serviceaccount.yaml` | ServiceAccount | `aidemo-worker` (referenced by every pod, annotated with UAMI client id) |
| `rbac.yaml` | ClusterRole + ClusterRoleBinding, Role + RoleBinding | Workers can `get/list/watch` nodes; API can `get/list` pods/logs in the namespace (for `/cluster/gpu`) |
| `api.yaml` | Deployment + Service | FastAPI (1 replica), ClusterIP `aidemo-api:8000` |
| `web.yaml` | Deployment + Service | Next.js (1 replica), LoadBalancer on port 80 |
| `simulator.yaml` | Deployment | Single replica, writes telemetry every 5s |
| `forecast-worker.yaml` | Deployment + Service | GPU pod, scaled by KEDA |
| `rl-worker.yaml` | Deployment + Service | GPU pod, scaled by KEDA (max 4) |
| `keda.yaml` | TriggerAuthentication + 2× ScaledObject | Scale workers by Service Bus queue depth |
| `servicemonitor.yaml` | ServiceMonitor (×3) | Prometheus discovers `/metrics` for api, forecast, rl |

## `values.yaml` keys

```yaml
namespace: aks-ai-demo

image:
  registry: ""                  # ACR login server (set by deploy-helm.ps1)
  forecastRepo: aidemo/forecast
  forecastTag: 0.2.0
  rlRepo: aidemo/rl
  rlTag: 0.1.2
  pullPolicy: IfNotPresent

workloadIdentity:
  clientId: ""                  # UAMI client_id
  tenantId: ""

serviceBus:
  fqdn: ""                      # *.servicebus.windows.net
  namespace: ""                 # short name (KEDA)
  forecastQueue: forecast-jobs
  rlQueue: rl-jobs

postgres:
  host: ""
  database: aidemo
  user: aidemo-workload-id
  sslmode: require

storage:
  accountUrl: ""
  container: artifacts

forecast:
  enabled: true
  minReplicas: 0
  maxReplicas: 2
  queueLength: 1
  resources:
    requests: { cpu: 2, memory: 8Gi, nvidia.com/gpu: 1 }
    limits:   { cpu: 8, memory: 32Gi, nvidia.com/gpu: 1 }
  nodeSelector: { workload: gpu-recon }
  tolerations:
    - key: nvidia.com/gpu
      operator: Equal
      value: present
      effect: NoSchedule

rl:
  enabled: true
  minReplicas: 0
  maxReplicas: 4                # time-sliced A100 = 4 logical GPUs
  queueLength: 1
  resources:
    requests: { cpu: 4, memory: 6Gi, nvidia.com/gpu: 1 }
    limits:   { cpu: 5, memory: 12Gi, nvidia.com/gpu: 1 }
  nodeSelector: { workload: gpu-recon }
  tolerations: [ ... same as forecast ... ]

simulator:
  enabled: true
  deviceCount: 8
  tickSeconds: 5
  simSpeed: 1
  image: { repo: aidemo/simulator, tag: 0.1.2 }

api:
  enabled: true
  replicas: 1
  image: { repo: aidemo/api, tag: 0.1.6 }
  service: { type: ClusterIP, port: 8000 }

web:
  enabled: true
  replicas: 1
  image: { repo: aidemo/web, tag: 0.1.22 }
  grafanaUrl: ""                # e.g. http://52.157.251.61
  service: { type: LoadBalancer, port: 80 }

serviceMonitor:
  enabled: true                 # set false if Prometheus Operator CRDs are missing
```

## Releasing

Always pass terraform-derived values via `-f` or `--set`. **Do not** rely on `--reuse-values` after a partial `--set rl.resources.*` override — it captures a partial subtree that overrides chart defaults (notably stripping `nvidia.com/gpu` from the request, which makes the cluster autoscaler ignore the pod). To recover, dump current values, edit out the offending block, and re-apply with `--reset-values -f`.

```powershell
helm get values aks-ai-demo -n aks-ai-demo -o yaml > .tmp-values.yaml
# remove the bad rl.resources block
helm upgrade aks-ai-demo deploy/helm/aks-ai-demo `
  -n aks-ai-demo --reset-values -f .tmp-values.yaml
```

## Image bumps (typical demo flow)

```powershell
docker build -t aidemoacrm23gd3.azurecr.io/aidemo/web:0.1.22 -f web/Dockerfile .
docker push aidemoacrm23gd3.azurecr.io/aidemo/web:0.1.22

helm upgrade aks-ai-demo deploy/helm/aks-ai-demo `
  -n aks-ai-demo --reuse-values --set web.image.tag=0.1.22

kubectl -n aks-ai-demo rollout status deploy/aidemo-web --timeout=180s
```

`--reuse-values` is safe **as long as** you have not previously left a partial override in stored values.
