# Operations runbook

Field-tested gotchas and how to fix them.

## 1. GPU node is `Ready` but pods stay `Pending` with "Insufficient nvidia.com/gpu"

After the cluster autoscaler adds a `gpurecon` node, it joins as `Ready` but its `Capacity` does not include `nvidia.com/gpu`. The `nvidia-device-plugin` daemonset selects nodes by the label `nvidia.com/gpu.present=true`, which AKS does **not** apply automatically.

```powershell
$node = (kubectl get nodes -l workload=gpu-recon -o jsonpath='{.items[0].metadata.name}')
kubectl label node $node nvidia.com/gpu.present=true --overwrite

# Verify the plugin pod schedules and registers GPU capacity
kubectl get pods -A -l app.kubernetes.io/name=nvidia-device-plugin
kubectl describe node $node | Select-String 'nvidia.com/gpu'
```

Once registered you should see `nvidia.com/gpu: 4` in both `Capacity` and `Allocatable` (time-sliced 4×).

## 2. RL or forecast job fails with `MessageLockLostError`

Service Bus caps `lockDuration` at **PT5M**. Any job whose worker takes longer than 5 minutes to call `complete_message` will fail when it tries to ack:

```
azure.servicebus.exceptions.MessageLockLostError:
  The lock on the message lock has expired.
```

The training itself usually succeeded — the failure is on `receiver.complete_message(msg)` in `src/common/dispatcher.py`.

Mitigations:

| Approach | Image rebuild? | Max job size |
|----------|----------------|--------------|
| Bump queue `lockDuration` to PT5M (the max) | No (`az servicebus queue update`) | ≤ 5 min |
| `AutoLockRenewer(max_lock_renewal_duration=4*3600)` in `dispatcher.py` | Yes — rl + forecast images | Effectively unbounded |
| `complete_message` immediately, then run training; track state in Postgres | Yes | Unbounded but loses SB redelivery semantics |

For the demo we keep PT5M and stay under ~200k PPO steps; throughput is ~740 steps/s.

```powershell
az servicebus queue update -g aks-ai-demo --namespace-name aidemo-sb-m23gd3 `
  --name rl-jobs --lock-duration PT5M
az servicebus queue update -g aks-ai-demo --namespace-name aidemo-sb-m23gd3 `
  --name forecast-jobs --lock-duration PT5M
```

## 3. `helm --reuse-values` strips GPU resources

If you ever ran `helm upgrade --set rl.resources.requests.cpu=4 ...`, helm stores `rl.resources` as a *partial* subtree. Subsequent `--reuse-values` calls then overlay that partial subtree on top of chart defaults, **losing** `nvidia.com/gpu: 1`. Result: cluster autoscaler refuses to scale up the gpurecon pool because the pod no longer requests a GPU and won't tolerate the taint usefully.

Recovery:

```powershell
helm get values aks-ai-demo -n aks-ai-demo -o yaml > .tmp-values.yaml
# remove the rl.resources block (and any other unwanted partials)
notepad .tmp-values.yaml
helm upgrade aks-ai-demo deploy/helm/aks-ai-demo `
  -n aks-ai-demo --reset-values -f .tmp-values.yaml
Remove-Item .tmp-values.yaml
```

Verify the spec has it back:

```powershell
kubectl -n aks-ai-demo get deploy rl-worker -o yaml | Select-String 'nvidia.com/gpu'
```

## 4. ACR Tasks build hangs on Windows

Streaming logs from `az acr build` can deadlock on Windows because of colorama + cp1252 not handling Next.js's `▲` glyph. Always use:

```powershell
az acr build -r aidemoacrm23gd3 -t aidemo/web:0.1.x -f web/Dockerfile --no-logs --no-wait .
az acr task list-runs -r aidemoacrm23gd3 --top 6 -o table
```

## 5. Postgres connection failures from local dev

In-cluster auth uses Workload Identity (no password). Locally:

```powershell
$env:PG_USE_PASSWORD = "1"
$env:PGPASSWORD = "<password>"
$env:PGHOST = "aidemo-pg-m23gd3.postgres.database.azure.com"
$env:PGUSER = "aidemo-workload-id"
$env:PGDATABASE = "aidemo"
$env:PGSSLMODE = "require"
```

Or use the same UAMI from your dev box: `az login --identity` is not available off-Azure, so prefer the password fallback for local work.

## 6. Cost-saving teardown of the GPU pool

```powershell
# After demo
az aks nodepool scale --cluster-name splatix-prod-aks `
  --resource-group splatix.nl-prod --name gpurecon --node-count 0
```

KEDA will keep `forecast-worker`/`rl-worker` at 0 replicas; the next job submission will trigger autoscaler to bring a node back up (≈ 2–3 min cold start), at which point you must re-apply the `nvidia.com/gpu.present=true` label (item 1).

## 7. Westeurope availability zone "1" not available

This subscription cannot place Postgres Flex in zone 1. Do **not** set `availability_zone` on the `azurerm_postgresql_flexible_server` resource — leave it null and let Azure pick.

## 8. Forecast worker requires GPU

`REQUIRE_GPU=1` is set by default; the worker raises if no CUDA device is present. Before changing this, make sure pods actually schedule on a GPU node — see item 1.

## 9. Truncating job history

```sql
TRUNCATE TABLE forecast_results;
TRUNCATE TABLE rl_results;
TRUNCATE TABLE jobs CASCADE;
```

Or via psql with the same env as item 5.

## 10. Reproducing job submissions from the CLI

```powershell
# Forecast (200 sample horizon = 24)
curl -s -X POST http://52.142.236.176/api/jobs/forecast `
  -H 'content-type: application/json' `
  -d '{"device_id":"dev-000","horizon":24,"num_samples":20}'

# RL — keep total_steps <= 200k to stay within PT5M lock
curl -s -X POST http://52.142.236.176/api/jobs/rl `
  -H 'content-type: application/json' `
  -d '{"algo":"PPO","total_steps":80000,"learning_rate":0.0003}'
```
