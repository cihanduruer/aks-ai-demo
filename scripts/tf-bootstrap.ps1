# Bootstrap remote Terraform state, then init main stack.
$ErrorActionPreference = "Stop"
Push-Location "$PSScriptRoot/../infra/terraform"
try {
  $SUB = (az account show --query id -o tsv)
  Push-Location bootstrap
  try {
    terraform init
    terraform apply -auto-approve -var "subscription_id=$SUB"
    $RG  = terraform output -raw backend_resource_group_name
    $SA  = terraform output -raw backend_storage_account_name
    $CT  = terraform output -raw backend_container_name
  } finally { Pop-Location }

  terraform init -reconfigure `
    -backend-config="resource_group_name=$RG" `
    -backend-config="storage_account_name=$SA" `
    -backend-config="container_name=$CT" `
    -backend-config="key=aks-ai-demo.tfstate"

  if (-not (Test-Path terraform.tfvars)) {
    Copy-Item terraform.example.tfvars terraform.tfvars
    (Get-Content terraform.tfvars) -replace '"4f0fd422-0201-4029-9c73-5f1d57aeed13"', "`"$SUB`"" | Set-Content terraform.tfvars
  }

  terraform plan -out tfplan
  Write-Host "`nReview the plan above. Run: terraform -chdir=infra/terraform apply tfplan"
}
finally { Pop-Location }
