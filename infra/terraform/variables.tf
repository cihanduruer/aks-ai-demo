variable "subscription_id" {
  type = string
}
variable "resource_group" {
  type    = string
  default = "aks-ai-demo"
}
variable "aks_name" {
  type    = string
  default = "splatix-prod-aks"
}
variable "aks_resource_group" {
  type    = string
  default = "splatix.nl-prod"
}
variable "namespace" {
  type    = string
  default = "aks-ai-demo"
}
variable "admin_ip" {
  type    = string
  default = ""
}
