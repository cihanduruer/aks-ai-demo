# Infrastructure (Terraform)

Terraform under `infra/terraform/` provisions the Azure-side resources and a Kubernetes namespace + ServiceAccount with Workload Identity Federation against the existing AKS cluster.

The AKS cluster itself (`splatix-prod-aks` in RG `splatix.nl-prod`, with the `gpurecon` node pool) is **out of scope** for this Terraform project — it is reused.

## Providers

`azurerm`, `azuread`, `kubernetes`, `helm`. State backed by Azure Storage (bootstrap container created by `scripts/tf-bootstrap.ps1`).

## Variables

| Variable | Default |
|---------|---------|
| `subscription_id` | required (set by tf-bootstrap) |
| `resource_group` | `aks-ai-demo` |
| `aks_name` | `splatix-prod-aks` |
| `aks_resource_group` | `splatix.nl-prod` |
| `namespace` | `aks-ai-demo` |
| `admin_ip` | `""` |

## Provisioned resources

| Resource | Name | Notes |
|----------|------|-------|
| Resource group | `aks-ai-demo` | Container for everything below |
| ACR | `aidemoacr{random6}` (currently `aidemoacrm23gd3`) | Basic SKU; AKS kubelet identity granted `AcrPull` |
| Service Bus namespace | `aidemo-sb-{random6}` | Standard tier |
| SB queue `forecast-jobs` | — | `lock_duration=PT5M`, max delivery 5 |
| SB queue `rl-jobs` | — | `lock_duration=PT5M`, max delivery 3 |
| Postgres Flexible Server | `aidemo-pg-{random6}` | AAD authentication enabled, UAMI as administrator |
| Postgres database | `aidemo` | UTF-8 |
| Storage account | `aidemoart{random6}` | Premium block-blob, container `artifacts` |
| Blob container | `artifacts` | RL `policy.zip` uploads land here |
| User-Assigned Managed Identity | `aidemo-workload-id` | Reused by all pods |
| Federated credential | OIDC issuer of AKS ↔ `system:serviceaccount:aks-ai-demo:aidemo-worker` | Removes need for static secrets |
| Kubernetes namespace | `aks-ai-demo` | Created by `kubernetes_namespace` |
| ServiceAccount | `aidemo-worker` | annotated `azure.workload.identity/client-id=<UAMI>` |
| Role assignments | UAMI granted: SB `Sender` + `Receiver` on both queues, Blob `Storage Blob Data Contributor` on container, Postgres AAD admin | |

## Outputs (consumed by Helm)

```
acr_login_server                  e.g. aidemoacrm23gd3.azurecr.io
servicebus_fqdn                   e.g. aidemo-sb-m23gd3.servicebus.windows.net
servicebus_namespace              short name (used by KEDA)
forecast_queue, rl_queue
pg_host, pg_database, pg_user
blob_account_url, blob_container
workload_identity_client_id
workload_identity_tenant_id
namespace
aks_oidc_issuer
```

`scripts/deploy-helm.ps1` reads these via `terraform output -json` and feeds them into `helm upgrade --install` so `values.yaml` stays generic.

## AKS cluster expectations

The shared AKS cluster must have:

- OIDC issuer enabled (`az aks update --enable-oidc-issuer --enable-workload-identity`).
- A GPU node pool with:
  - Label `workload=gpu-recon`
  - Taint `nvidia.com/gpu=present:NoSchedule`
  - Cluster autoscaler min=0, max=1 (NC24ads_A100_v4 in this demo)
- nvidia-device-plugin installed cluster-wide and configured for time-slicing (4× per A100). The plugin's daemonset selects on `nvidia.com/gpu.present=true`, which on AKS GPU nodes must be **applied manually after each scale-up** (see [operations.md](operations.md)).
