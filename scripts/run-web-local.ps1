<#
Run the aks-ai-demo web UI locally in Docker, pointing at the API in AKS.

How it works:
  - kubectl port-forward exposes svc/aidemo-api:8000 on localhost:8000
  - docker runs the web image with API_TARGET=http://host.docker.internal:8000
  - browse http://localhost:3000

Prereqs: az login + kubectl context = splatix-prod-aks, docker desktop running.
#>
param(
    [string]$Acr = "aidemoacrm23gd3.azurecr.io",
    [string]$Image = "aidemo/web:0.1.1",
    [int]$WebPort = 3000,
    [int]$ApiPort = 8000,
    [string]$Namespace = "aks-ai-demo",
    [string]$GrafanaUrl = "",
    [string]$PrometheusUrl = ""
)

$ErrorActionPreference = "Stop"
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")

Write-Host "==> Logging in to ACR $Acr ..."
az acr login -n ($Acr.Split(".")[0]) | Out-Null

Write-Host "==> Pulling $Acr/$Image ..."
docker pull "$Acr/$Image"

Write-Host "==> Starting kubectl port-forward svc/aidemo-api ${ApiPort}:8000 -n $Namespace ..."
$pf = Start-Process -FilePath "kubectl" `
    -ArgumentList @("port-forward","svc/aidemo-api","${ApiPort}:8000","-n",$Namespace) `
    -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3

# Sanity-check the API is reachable
try {
    $hc = curl.exe -s -o NUL -w "%{http_code}" "http://localhost:${ApiPort}/healthz"
    if ($hc -ne "200") { throw "API healthz returned $hc" }
    Write-Host "    API healthz=200 ✔"
} catch {
    Write-Warning "API healthz check failed: $_"
    Write-Warning "Killing port-forward and exiting."
    Stop-Process -Id $pf.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "==> Stopping any existing 'aidemo-web-local' container ..."
docker rm -f aidemo-web-local 2>$null | Out-Null

Write-Host "==> Running web container on http://localhost:$WebPort (API_TARGET=http://host.docker.internal:$ApiPort) ..."
if (-not $GrafanaUrl) {
    $svcIp = kubectl get svc kube-prometheus-stack-grafana -n monitoring -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>$null
    if ($svcIp) { $GrafanaUrl = "http://$svcIp"; Write-Host "    auto-detected GrafanaUrl=$GrafanaUrl" }
}
docker run -d --name aidemo-web-local `
    -p "${WebPort}:3000" `
    -e "API_TARGET=http://host.docker.internal:${ApiPort}" `
    -e "GRAFANA_URL=$GrafanaUrl" `
    -e "PROMETHEUS_URL=$PrometheusUrl" `
    --add-host "host.docker.internal:host-gateway" `
    "$Acr/$Image" | Out-Null

Start-Sleep -Seconds 2
$webStatus = docker inspect -f '{{.State.Status}}' aidemo-web-local
Write-Host "    web container: $webStatus"

Write-Host ""
Write-Host "✔ UI:        http://localhost:$WebPort"
Write-Host "✔ API proxy: http://localhost:$ApiPort  (kubectl port-forward PID $($pf.Id))"
Write-Host ""
Write-Host "When done:"
Write-Host "  docker rm -f aidemo-web-local"
Write-Host "  Stop-Process -Id $($pf.Id)  # stops port-forward"
