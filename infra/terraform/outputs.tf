output "acr_login_server" {
  value = azurerm_container_registry.acr.login_server
}
output "acr_name" {
  value = azurerm_container_registry.acr.name
}
output "servicebus_fqdn" {
  value = "${azurerm_servicebus_namespace.sb.name}.servicebus.windows.net"
}
output "servicebus_namespace" {
  value = azurerm_servicebus_namespace.sb.name
}
output "forecast_queue" {
  value = azurerm_servicebus_queue.forecast.name
}
output "rl_queue" {
  value = azurerm_servicebus_queue.rl.name
}
output "pg_host" {
  value = azurerm_postgresql_flexible_server.pg.fqdn
}
output "pg_database" {
  value = azurerm_postgresql_flexible_server_database.aidemo.name
}
output "pg_admin_user" {
  value = azurerm_postgresql_flexible_server.pg.administrator_login
}
output "pg_admin_password" {
  value     = random_password.pg_admin.result
  sensitive = true
}
output "blob_account_url" {
  value = azurerm_storage_account.artifacts.primary_blob_endpoint
}
output "blob_container" {
  value = azurerm_storage_container.artifacts.name
}
output "workload_identity_client_id" {
  value = azurerm_user_assigned_identity.wi.client_id
}
output "workload_identity_tenant_id" {
  value = azurerm_user_assigned_identity.wi.tenant_id
}
output "namespace" {
  value = kubernetes_namespace.ns.metadata[0].name
}
output "aks_oidc_issuer" {
  value = data.azurerm_kubernetes_cluster.aks.oidc_issuer_url
}
