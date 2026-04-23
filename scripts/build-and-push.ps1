# Build & push all images to the ACR provisioned by Terraform.
# Usage: ./scripts/build-and-push.ps1
$ErrorActionPreference = "Stop"
Push-Location "$PSScriptRoot/.."
try {
  $TF = "infra/terraform"
  $ACR = (terraform -chdir=$TF output -raw acr_login_server)
  $ACR_NAME = (terraform -chdir=$TF output -raw acr_name)

  Write-Host "ACR: $ACR"
  az acr login -n $ACR_NAME | Out-Host

  $images = @(
    @{ name="aidemo/forecast";  file="src/forecast/Dockerfile" },
    @{ name="aidemo/rl";        file="src/rl/Dockerfile" },
    @{ name="aidemo/simulator"; file="src/devices/Dockerfile" },
    @{ name="aidemo/api";       file="src/api/Dockerfile" },
    @{ name="aidemo/web";       file="web/Dockerfile" }
  )
  $tag = "0.1.0"
  foreach ($img in $images) {
    $ref = "$ACR/$($img.name):$tag"
    Write-Host "==> building $ref"
    docker build -f $img.file -t $ref .
    docker push $ref
  }
}
finally { Pop-Location }
