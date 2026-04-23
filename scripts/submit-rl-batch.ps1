<#
Submit many RL training jobs to fill the results table with diverse runs.

Usage:
  ./scripts/submit-rl-batch.ps1                       # 24 jobs at default LB
  ./scripts/submit-rl-batch.ps1 -Count 50
  ./scripts/submit-rl-batch.ps1 -ApiBase http://1.2.3.4 -Count 12
#>
param(
    [string]$ApiBase = "http://52.142.236.176",
    [int]$Count = 24
)

$ErrorActionPreference = "Stop"

# Sweep across algos, learning rates, and total_steps so the UI shows variety
$algos = @("PPO", "DQN")
$lrs   = @(1e-4, 3e-4, 5e-4, 1e-3)
$steps = @(10000, 20000, 40000)

Write-Host "Submitting $Count RL jobs to $ApiBase/api/jobs/rl ..."
$submitted = 0
$failed = 0
for ($i = 0; $i -lt $Count; $i++) {
    $body = @{
        algo          = $algos[$i % $algos.Count]
        learning_rate = $lrs[(Get-Random -Minimum 0 -Maximum $lrs.Count)]
        total_steps   = $steps[(Get-Random -Minimum 0 -Maximum $steps.Count)]
        seed          = Get-Random -Minimum 1 -Maximum 99999
    } | ConvertTo-Json -Compress

    try {
        $resp = curl.exe -s -X POST "$ApiBase/api/jobs/rl" `
            -H "Content-Type: application/json" `
            -d $body
        Write-Host ("[{0,3}] {1}  -> {2}" -f $i, $body, $resp)
        $submitted++
    } catch {
        Write-Warning "submit $i failed: $_"
        $failed++
    }
    Start-Sleep -Milliseconds 150
}

Write-Host ""
Write-Host "submitted=$submitted failed=$failed"
Write-Host "Watch KEDA scale: kubectl get hpa,pods -n aks-ai-demo -w"
Write-Host "Queue depth:    az servicebus queue show -g aks-ai-demo -n aidemo-sb-m23gd3 --name rl-jobs --query countDetails"
Write-Host "Results:        curl $ApiBase/api/results/rl?limit=$Count"
