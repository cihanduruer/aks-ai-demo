terraform {
  required_version = ">= 1.6.0"

  backend "azurerm" {
    # Filled in by `terraform init -backend-config=...`
  }

  required_providers {
    azurerm    = { source = "hashicorp/azurerm", version = "~> 4.14" }
    azuread    = { source = "hashicorp/azuread", version = "~> 3.0" }
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.32" }
    helm       = { source = "hashicorp/helm", version = "~> 2.16" }
    random     = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "azurerm" {
  features {
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }
  subscription_id = var.subscription_id
}

provider "azuread" {}

data "azurerm_client_config" "current" {}

# ---------- Discover existing AKS ----------
data "azurerm_kubernetes_cluster" "aks" {
  name                = var.aks_name
  resource_group_name = var.aks_resource_group
}

provider "kubernetes" {
  host                   = data.azurerm_kubernetes_cluster.aks.kube_config[0].host
  client_certificate     = base64decode(data.azurerm_kubernetes_cluster.aks.kube_config[0].client_certificate)
  client_key             = base64decode(data.azurerm_kubernetes_cluster.aks.kube_config[0].client_key)
  cluster_ca_certificate = base64decode(data.azurerm_kubernetes_cluster.aks.kube_config[0].cluster_ca_certificate)
}

provider "helm" {
  kubernetes {
    host                   = data.azurerm_kubernetes_cluster.aks.kube_config[0].host
    client_certificate     = base64decode(data.azurerm_kubernetes_cluster.aks.kube_config[0].client_certificate)
    client_key             = base64decode(data.azurerm_kubernetes_cluster.aks.kube_config[0].client_key)
    cluster_ca_certificate = base64decode(data.azurerm_kubernetes_cluster.aks.kube_config[0].cluster_ca_certificate)
  }
}

# ---------- Resource group ----------
data "azurerm_resource_group" "rg" {
  name = var.resource_group
}

resource "random_string" "sfx" {
  length  = 6
  special = false
  upper   = false
  numeric = true
}

# ---------- ACR ----------
resource "azurerm_container_registry" "acr" {
  name                = "aidemoacr${random_string.sfx.result}"
  resource_group_name = data.azurerm_resource_group.rg.name
  location            = data.azurerm_resource_group.rg.location
  sku                 = "Basic"
  admin_enabled       = false
}

resource "azurerm_role_assignment" "aks_acr_pull" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPull"
  principal_id         = data.azurerm_kubernetes_cluster.aks.kubelet_identity[0].object_id
}

# ---------- Service Bus ----------
resource "azurerm_servicebus_namespace" "sb" {
  name                = "aidemo-sb-${random_string.sfx.result}"
  resource_group_name = data.azurerm_resource_group.rg.name
  location            = data.azurerm_resource_group.rg.location
  sku                 = "Standard"
}

resource "azurerm_servicebus_queue" "forecast" {
  name                                 = "forecast-jobs"
  namespace_id                         = azurerm_servicebus_namespace.sb.id
  max_delivery_count                   = 5
  dead_lettering_on_message_expiration = true
  lock_duration                        = "PT5M"
  default_message_ttl                  = "PT2H"
}

resource "azurerm_servicebus_queue" "rl" {
  name                                 = "rl-jobs"
  namespace_id                         = azurerm_servicebus_namespace.sb.id
  max_delivery_count                   = 3
  dead_lettering_on_message_expiration = true
  lock_duration                        = "PT5M"
  default_message_ttl                  = "PT4H"
}

# ---------- Storage (artifacts) ----------
resource "azurerm_storage_account" "artifacts" {
  name                     = "aidemoart${random_string.sfx.result}"
  resource_group_name      = data.azurerm_resource_group.rg.name
  location                 = data.azurerm_resource_group.rg.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
}

resource "azurerm_storage_container" "artifacts" {
  name                  = "artifacts"
  storage_account_id    = azurerm_storage_account.artifacts.id
  container_access_type = "private"
}

# ---------- PostgreSQL Flexible Server ----------
resource "random_password" "pg_admin" {
  length           = 24
  special          = true
  override_special = "!#%*-_=+"
}

resource "azurerm_postgresql_flexible_server" "pg" {
  name                          = "aidemo-pg-${random_string.sfx.result}"
  resource_group_name           = data.azurerm_resource_group.rg.name
  location                      = data.azurerm_resource_group.rg.location
  version                       = "16"
  administrator_login           = "pgadmin"
  administrator_password        = random_password.pg_admin.result
  sku_name                      = "B_Standard_B1ms"
  storage_mb                    = 32768
  storage_tier                  = "P4"
  public_network_access_enabled = true
  backup_retention_days         = 7

  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = true
    tenant_id                     = data.azurerm_client_config.current.tenant_id
  }
}

resource "azurerm_postgresql_flexible_server_database" "aidemo" {
  name      = "aidemo"
  server_id = azurerm_postgresql_flexible_server.pg.id
  collation = "en_US.utf8"
  charset   = "UTF8"
}

# Allow Azure services + (optional) admin IP for setup
resource "azurerm_postgresql_flexible_server_firewall_rule" "azure" {
  name             = "AllowAllAzure"
  server_id        = azurerm_postgresql_flexible_server.pg.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "admin_ip" {
  count            = var.admin_ip == "" ? 0 : 1
  name             = "AdminIP"
  server_id        = azurerm_postgresql_flexible_server.pg.id
  start_ip_address = var.admin_ip
  end_ip_address   = var.admin_ip
}

# ---------- Workload Identity (UAMI + federated cred) ----------
resource "azurerm_user_assigned_identity" "wi" {
  name                = "aidemo-workload-id"
  resource_group_name = data.azurerm_resource_group.rg.name
  location            = data.azurerm_resource_group.rg.location
}

resource "azurerm_federated_identity_credential" "wi" {
  name                = "aidemo-wi-fed"
  resource_group_name = data.azurerm_resource_group.rg.name
  parent_id           = azurerm_user_assigned_identity.wi.id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = data.azurerm_kubernetes_cluster.aks.oidc_issuer_url
  subject             = "system:serviceaccount:${var.namespace}:aidemo-worker"
}

# Service Bus data plane
resource "azurerm_role_assignment" "sb_receiver" {
  scope                = azurerm_servicebus_namespace.sb.id
  role_definition_name = "Azure Service Bus Data Receiver"
  principal_id         = azurerm_user_assigned_identity.wi.principal_id
}

resource "azurerm_role_assignment" "sb_sender" {
  scope                = azurerm_servicebus_namespace.sb.id
  role_definition_name = "Azure Service Bus Data Sender"
  principal_id         = azurerm_user_assigned_identity.wi.principal_id
}

# Storage data plane
resource "azurerm_role_assignment" "blob_contrib" {
  scope                = azurerm_storage_account.artifacts.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.wi.principal_id
}

# Postgres AAD admin = workload identity (so pods can use AAD token).
resource "azurerm_postgresql_flexible_server_active_directory_administrator" "wi" {
  server_name         = azurerm_postgresql_flexible_server.pg.name
  resource_group_name = data.azurerm_resource_group.rg.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  object_id           = azurerm_user_assigned_identity.wi.principal_id
  principal_name      = azurerm_user_assigned_identity.wi.name
  principal_type      = "ServicePrincipal"
}

# ---------- KEDA TriggerAuth needs an identity for the SB scaler ----------
resource "azurerm_federated_identity_credential" "keda" {
  name                = "aidemo-keda-fed"
  resource_group_name = data.azurerm_resource_group.rg.name
  parent_id           = azurerm_user_assigned_identity.wi.id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = data.azurerm_kubernetes_cluster.aks.oidc_issuer_url
  subject             = "system:serviceaccount:kube-system:keda-operator"
}

# ---------- Namespace ----------
resource "kubernetes_namespace" "ns" {
  metadata {
    name = var.namespace
    labels = {
      "app.kubernetes.io/part-of"   = "aks-ai-demo"
      "azure.workload.identity/use" = "true"
    }
  }
}

resource "kubernetes_resource_quota" "quota" {
  metadata {
    name      = "aidemo-quota"
    namespace = kubernetes_namespace.ns.metadata[0].name
  }
  spec {
    hard = {
      "requests.cpu"            = "32"
      "requests.memory"         = "128Gi"
      "limits.cpu"              = "64"
      "limits.memory"           = "256Gi"
      "requests.nvidia.com/gpu" = "4"
    }
  }
}
