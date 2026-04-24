# Web app (`web/`)

Next.js 14.2.18 app, React 18, Tailwind 3.4 (`darkMode: 'class'`), shadcn/ui primitives, d3 7, SWR 2.

## Pages (`web/app`)

| Route | Purpose |
|-------|---------|
| `/` | Dashboard: device cards, fleet stats, embedded Grafana iframe |
| `/devices` | Device list, expandable rows with 24-hour telemetry chart |
| `/devices/[id]` | Single device detail with thermostat (PATCH `/devices/{id}`) |
| `/jobs` | Submit forecast / RL jobs and watch live status (queued → running → succeeded / failed) |
| `/results` | Forecast and RL result tables with chart previews |
| `/cluster` | GPU pool status (count, state, pending pod schedule reasons) and worker pods |
| `/technical` | Architecture diagram + textual description of components, RL env, and reward |

## Components (`web/components`)

| Component | Notes |
|-----------|-------|
| `architecture-diagram.tsx` | D3 swimlane diagram with show/hide pills for `data | ctrl | scrape | embed` edges |
| `gpu-status-card.tsx` | SWR-polled `/cluster/gpu`; states `offline | scaling | starting | blocked | ready` with pulse animation |
| `thermostat.tsx` | Setpoint UI; debounced PATCH; `mutate('/devices')` triggers immediate SWR refresh |
| `device-row.tsx` | Expandable row with d3 line chart of indoor/outdoor/setpoint/energy/humidity/occupants |
| `theme-toggle.tsx` | Light/dark toggle (default **light**, persists to `localStorage.theme`) |
| `ui/*` | shadcn/ui primitives (button, card, badge, table, tabs, …) |

## API proxy

`web/app/api/[...path]/route.ts` is a Node.js runtime proxy. Every `/api/*` request from the browser is forwarded to `API_TARGET` (default `http://aidemo-api:8000` in cluster) preserving method, headers and body. This means the browser only needs the single web LoadBalancer IP.

```ts
// web/lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/api";
export function useApi<T>(path, refreshMs = 5000)        // SWR
export async function postJson<T>(path, body)
export async function patchJson<T>(path, body)
```

## Theme handling

Pre-hydration script in `web/app/layout.tsx` reads `localStorage.theme`; if `"dark"`, it adds `dark` class to `<html>` before paint. **Default is light** when nothing is stored. The `theme-toggle` component writes the chosen value back to `localStorage`.

## Environment

| Variable | Default | Notes |
|----------|---------|-------|
| `NEXT_PUBLIC_API_BASE` | `/api` | Browser-side base URL |
| `API_TARGET` | `http://aidemo-api:8000` | Server-side proxy upstream |
| `GRAFANA_URL` | _(empty)_ | If set, embedded as iframe in dashboards |

## Build & run locally

```powershell
# In-cluster API via port-forward
kubectl -n aks-ai-demo port-forward svc/aidemo-api 8000:8000

# Run web image locally (matches what's in the cluster)
./scripts/run-web-local.ps1 -Image aidemo/web:0.1.22 -GrafanaUrl http://52.157.251.61
# → http://localhost:3000
```
