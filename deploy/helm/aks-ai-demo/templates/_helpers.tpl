{{- define "aidemo.envCommon" -}}
- name: SERVICEBUS_FQDN
  value: {{ .Values.serviceBus.fqdn | quote }}
- name: PGHOST
  value: {{ .Values.postgres.host | quote }}
- name: PGDATABASE
  value: {{ .Values.postgres.database | quote }}
- name: PGUSER
  value: {{ .Values.postgres.user | quote }}
- name: PGSSLMODE
  value: {{ .Values.postgres.sslmode | quote }}
- name: BLOB_ACCOUNT_URL
  value: {{ .Values.storage.accountUrl | quote }}
- name: BLOB_CONTAINER
  value: {{ .Values.storage.container | quote }}
- name: METRICS_PORT
  value: "9090"
- name: AZURE_CLIENT_ID
  value: {{ .Values.workloadIdentity.clientId | quote }}
- name: AZURE_TENANT_ID
  value: {{ .Values.workloadIdentity.tenantId | quote }}
{{- end -}}
