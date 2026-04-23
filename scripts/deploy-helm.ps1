# Render Helm values from Terraform outputs and install the chart.
# Usage: ./scripts/deploy-helm.ps1
$ErrorActionPreference = "Stop"
Push-Location "$PSScriptRoot/.."
try {
  Push-Location "infra/terraform"
  try {
    $ACR        = (terraform output -raw acr_login_server)
    $SB_FQDN    = (terraform output -raw servicebus_fqdn)
    $SB_NS      = (terraform output -raw servicebus_namespace)
    $FQ         = (terraform output -raw forecast_queue)
    $RQ         = (terraform output -raw rl_queue)
    $PG_HOST    = (terraform output -raw pg_host)
    $PG_DB      = (terraform output -raw pg_database)
    $BLOB_URL   = (terraform output -raw blob_account_url)
    $BLOB_CT    = (terraform output -raw blob_container)
    $WI_CID     = (terraform output -raw workload_identity_client_id)
    $WI_TID     = (terraform output -raw workload_identity_tenant_id)
    $NS         = (terraform output -raw namespace)
  } finally { Pop-Location }
  # PG user = UAMI principal name = "aidemo-workload-id" (token auth).
  $PG_USER    = "aidemo-workload-id"

  # Detect Prometheus Operator CRDs.
  $smEnabled = $true
  try { kubectl get crd servicemonitors.monitoring.coreos.com 2>$null | Out-Null } catch { $smEnabled = $false }

  kubectl create namespace $NS --dry-run=client -o yaml | kubectl apply -f -

  helm upgrade --install aks-ai-demo deploy/helm/aks-ai-demo `
    --namespace $NS `
    --set image.registry=$ACR `
    --set workloadIdentity.clientId=$WI_CID `
    --set workloadIdentity.tenantId=$WI_TID `
    --set serviceBus.fqdn=$SB_FQDN `
    --set serviceBus.namespace=$SB_NS `
    --set serviceBus.forecastQueue=$FQ `
    --set serviceBus.rlQueue=$RQ `
    --set postgres.host=$PG_HOST `
    --set postgres.database=$PG_DB `
    --set postgres.user=$PG_USER `
    --set storage.accountUrl=$BLOB_URL `
    --set storage.container=$BLOB_CT `
    --set serviceMonitor.enabled=$smEnabled `
    --wait
}
finally { Pop-Location }
