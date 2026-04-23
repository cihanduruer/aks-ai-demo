# Bootstrap: creates the storage account that holds remote Terraform state.
# Run this ONCE with local state, then `terraform init -migrate-state` is not
# needed because the main stack uses its own backend block.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.14" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

variable "subscription_id" {
  type = string
}
variable "location" {
  type    = string
  default = "westeurope"
}
variable "resource_group" {
  type    = string
  default = "aks-ai-demo"
}

resource "random_string" "sfx" {
  length  = 6
  special = false
  upper   = false
  numeric = true
}

resource "azurerm_resource_group" "rg" {
  name     = var.resource_group
  location = var.location
}

resource "azurerm_storage_account" "tfstate" {
  name                          = "tfstate${random_string.sfx.result}aidemo"
  resource_group_name           = azurerm_resource_group.rg.name
  location                      = azurerm_resource_group.rg.location
  account_tier                  = "Standard"
  account_replication_type      = "LRS"
  min_tls_version               = "TLS1_2"
  public_network_access_enabled = true
  shared_access_key_enabled     = true
}

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.tfstate.id
  container_access_type = "private"
}

output "backend_resource_group_name" {
  value = azurerm_resource_group.rg.name
}
output "backend_storage_account_name" {
  value = azurerm_storage_account.tfstate.name
}
output "backend_container_name" {
  value = azurerm_storage_container.tfstate.name
}
