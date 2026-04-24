# GitHub Actions

Four workflows live under `.github/workflows/`. All Azure access uses **OIDC (passwordless federated credentials)** — no client secrets stored as GitHub secrets.

| Workflow | Trigger | What it does |
|---------|---------|--------------|
| [`ci.yml`](workflows/ci.yml) | push / PR to `main` | Python lint (ruff) + smoke tests, web `npm ci && npm run build`, `helm lint && helm template` |
| [`images.yml`](workflows/images.yml) | push to `main` (path-filtered) or manual | Builds and pushes only the changed images to ACR with Buildx + registry cache |
| [`deploy.yml`](workflows/deploy.yml) | manual (`workflow_dispatch`) | `helm upgrade --reuse-values` against AKS, with rollout status |
| [`terraform.yml`](workflows/terraform.yml) | PR touching `infra/**`, or manual (`plan`/`apply`) | `fmt → validate → plan` (and `apply` on dispatch) |

## One-time setup

### 1. Create a federated credential on the GitHub Actions identity

Reuse the existing UAMI (`aidemo-workload-id`) **or** create a separate one for CI. For each subject you need to authenticate from:

```bash
SUB="repo:<org>/<repo>:ref:refs/heads/main"               # main branch
# Plus one per environment GitHub Actions hits:
SUB_PR="repo:<org>/<repo>:pull_request"
SUB_ENV="repo:<org>/<repo>:environment:production"

az identity federated-credential create \
  --name gha-main \
  --identity-name aidemo-workload-id \
  --resource-group aks-ai-demo \
  --issuer https://token.actions.githubusercontent.com \
  --subject "$SUB" \
  --audience api://AzureADTokenExchange
```

Repeat for `pull_request` and the `production` environment subjects.

### 2. Grant the identity what each workflow needs

| Workflow | Required Azure RBAC |
|---------|---------------------|
| `images.yml` | `AcrPush` on the ACR |
| `deploy.yml` | `Azure Kubernetes Service Cluster User Role` + a Kubernetes RoleBinding (or `Azure Kubernetes Service RBAC Cluster Admin`) on the namespace |
| `terraform.yml` | `Contributor` on the resource group `aks-ai-demo` + permissions on the TF state storage account |

### 3. Configure repository variables

Settings → Secrets and variables → Actions → **Variables**:

| Name | Example |
|------|---------|
| `AZURE_CLIENT_ID` | `41a75acf-2c75-4ff6-9223-70dcfa208338` |
| `AZURE_TENANT_ID` | `a01cc91b-6d33-4777-9c32-0b02b5cd3473` |
| `AZURE_SUBSCRIPTION_ID` | `4f0fd422-0201-4029-9c73-5f1d57aeed13` |
| `ACR_NAME` | `aidemoacrm23gd3` |
| `AKS_NAME` | `splatix-prod-aks` |
| `AKS_RESOURCE_GROUP` | `splatix.nl-prod` |
| `NAMESPACE` | `aks-ai-demo` |

### 4. Create environments

Settings → Environments → create `production` (and optionally `preview`). Add required reviewers on `production` to gate `deploy.yml` and `terraform apply`.

## Typical flow

```
git push origin main
  ├─ ci.yml runs (lint, test, helm template)
  └─ images.yml runs:
       - paths-filter detects which of api/web/simulator/forecast/rl changed
       - builds & pushes to ACR with two tags: <sha> and latest

# Then manually:
Actions → Deploy to AKS → Run workflow
  image_tag = <sha>     # or 'latest'
  components = all      # or 'api,web'
```

## Notes

- `images.yml` uses `cache-from`/`cache-to` against a `:buildcache` registry tag for layer reuse — the GPU images (forecast/rl) benefit the most.
- `deploy.yml` uses `--reuse-values` plus `--set <component>.image.tag=<tag>`. To change other values, edit `values.yaml` (and merge to main) or do a one-off `helm upgrade ... -f file.yaml --reset-values` from a workstation.
- `terraform.yml` does not run apply automatically on PR merge — explicitly dispatch it. The Terraform state backend is the storage account created by `scripts/tf-bootstrap.ps1`.
- All workflows are idempotent and safe to re-run.
