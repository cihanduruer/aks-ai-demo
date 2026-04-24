# Deployment

Order from a clean subscription to a working demo.

## 0. Prerequisites

- Azure CLI logged in (`az login`), correct subscription set.
- An existing AKS cluster `splatix-prod-aks` in RG `splatix.nl-prod` with:
  - OIDC issuer + Workload Identity enabled
  - Node pool `gpurecon` (NC24ads_A100_v4, autoscale 0..1, label `workload=gpu-recon`, taint `nvidia.com/gpu=present:NoSchedule`)
- Tools: `terraform`, `kubectl`, `helm`, `docker`, PowerShell 7+.

## 1. Bootstrap Terraform backend

```powershell
./scripts/tf-bootstrap.ps1
```

Creates the storage account / container that backs the remote state, then `terraform init`s `infra/terraform/`.

## 2. Provision Azure resources

```powershell
terraform -chdir=infra/terraform plan -out tfplan
terraform -chdir=infra/terraform apply tfplan
```

This creates ACR, Service Bus + queues, Postgres Flex, Storage, UAMI, the K8s namespace and ServiceAccount, and federated credentials. See [infrastructure.md](infrastructure.md) for the full inventory.

## 3. Install monitoring stack

```powershell
./scripts/install-monitoring.ps1
```

Installs:

- `kube-prometheus-stack` (Prometheus, Grafana with anonymous viewer, Node Exporter; AlertManager and control-plane scrapers disabled because AKS doesn't expose them).
- `nvidia-device-plugin` daemonset with time-slicing (`replicas: 4`) — selects nodes via `nvidia.com/gpu.present=true`.
- `dcgm-exporter` daemonset on `workload=gpu-recon` nodes, with a ServiceMonitor.
- The DCGM Grafana dashboard ConfigMap (auto-discovered via `grafana_dashboard=1`).

The script prints the Grafana LoadBalancer IP on completion.

## 4. Build & push images

```powershell
./scripts/build-and-push.ps1
```

Builds and pushes:

- `aidemo/api`
- `aidemo/simulator`
- `aidemo/forecast` (CUDA base; large)
- `aidemo/rl` (CUDA base; large)
- `aidemo/web`

For Windows + ACR Tasks builds, prefer `--no-logs --no-wait` and poll with:

```powershell
az acr task list-runs -r aidemoacrm23gd3 --top 6 -o table
```

(Avoids a known colorama/cp1252 hang when streaming the Next.js ▲ character.)

## 5. Deploy Helm chart

```powershell
./scripts/deploy-helm.ps1
```

Reads `terraform output -json`, fills `values.yaml`, and runs `helm upgrade --install aks-ai-demo deploy/helm/aks-ai-demo --wait`.

## 6. Label the GPU node when it scales up

The first time a worker triggers cluster autoscaler to add a `gpurecon` node, the node will be `Ready` but **without** `nvidia.com/gpu` capacity, because the device plugin's selector requires `nvidia.com/gpu.present=true`. Run:

```powershell
$node = (kubectl get nodes -l workload=gpu-recon -o jsonpath='{.items[0].metadata.name}')
kubectl label node $node nvidia.com/gpu.present=true --overwrite
```

This is also needed after every node replacement. See [operations.md](operations.md).

## 7. Verify

```powershell
kubectl get pods -n aks-ai-demo
kubectl get svc -n aks-ai-demo aidemo-web      # external IP
```

Open the web LoadBalancer IP and:

- `/devices` should show 8 simulated rooms with live telemetry.
- `/jobs` lets you submit a forecast or RL job.
- `/cluster` shows the GPU pool state.
- `/results` shows completed forecasts and RL training runs.

## Updating individual components

```powershell
# Just the web app
docker build -t aidemoacrm23gd3.azurecr.io/aidemo/web:0.1.23 -f web/Dockerfile .
docker push aidemoacrm23gd3.azurecr.io/aidemo/web:0.1.23
helm upgrade aks-ai-demo deploy/helm/aks-ai-demo -n aks-ai-demo `
  --reuse-values --set web.image.tag=0.1.23

# Tearing down the GPU node (cost saver)
az aks nodepool scale --cluster-name splatix-prod-aks `
  --resource-group splatix.nl-prod --name gpurecon --node-count 0
```

## Cluster recreation checklist

If the AKS cluster is rebuilt:

1. Recreate cluster with OIDC + Workload Identity.
2. Update the federated credential on `aidemo-workload-id` with the new OIDC issuer URL.
3. Recreate / re-label the gpurecon node pool.
4. Re-run steps 3 → 7.
