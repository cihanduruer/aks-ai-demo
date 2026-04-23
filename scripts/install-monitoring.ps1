# Install kube-prometheus-stack and the NVIDIA DCGM exporter on AKS.
# Idempotent. After install, prints the Grafana LoadBalancer URL.
param(
  [string]$Namespace = "monitoring",
  [string]$KpsRelease = "kube-prometheus-stack",
  [string]$DcgmRelease = "dcgm-exporter",
  [string]$ResourceGroup = "splatix.nl-prod",
  [string]$Cluster = "splatix-prod-aks"
)
$ErrorActionPreference = "Stop"

Write-Host "==> az aks get-credentials $Cluster ..."
az aks get-credentials -g $ResourceGroup -n $Cluster --overwrite-existing | Out-Null

Write-Host "==> Adding helm repos ..."
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts | Out-Null
helm repo add gpu-helm-charts https://nvidia.github.io/dcgm-exporter/helm-charts | Out-Null
helm repo update | Out-Null

kubectl get ns $Namespace 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { kubectl create namespace $Namespace | Out-Null }

Write-Host "==> Installing kube-prometheus-stack ..."
helm upgrade --install $KpsRelease prometheus-community/kube-prometheus-stack `
  -n $Namespace `
  -f deploy/monitoring/values-kps.yaml `
  --wait --timeout 10m

Write-Host "==> Installing dcgm-exporter ..."
helm upgrade --install $DcgmRelease gpu-helm-charts/dcgm-exporter `
  -n $Namespace `
  -f deploy/monitoring/values-dcgm.yaml `
  --timeout 5m

Write-Host "==> Applying custom DCGM Grafana dashboard ..."
kubectl apply -f deploy/monitoring/dashboard-dcgm.yaml

Write-Host "==> Waiting for Grafana LoadBalancer IP ..."
$ip = $null
for ($i = 0; $i -lt 60; $i++) {
  $ip = kubectl get svc "$KpsRelease-grafana" -n $Namespace -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>$null
  if ($ip) { break }
  Start-Sleep -Seconds 5
}

if (-not $ip) {
  Write-Host "Grafana LB IP not assigned yet. Check: kubectl get svc -n $Namespace $KpsRelease-grafana"
  exit 1
}

$grafana = "http://$ip"
Write-Host ""
Write-Host "✔ Grafana ready at $grafana  (anonymous Viewer enabled)"
Write-Host "  Admin login: admin / admin"
Write-Host ""
Write-Host "Run the local UI with the Grafana URL:"
Write-Host "  ./scripts/run-web-local.ps1 -GrafanaUrl $grafana"
