"use client";
import { Fragment } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArchitectureDiagram } from "@/components/architecture-diagram";

export default function TechnicalPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Technical Details</h1>
        <p className="text-muted-foreground">
          Reference for live demos: architecture, model components, infrastructure,
          and the libraries / versions that power each piece.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>End-to-end architecture</CardTitle>
          <CardDescription>
            Stateless web → FastAPI → Service Bus → KEDA-scaled workers → Postgres /
            Blob — all on AKS with managed identity and Prometheus monitoring. Animated
            tokens trace live request / message paths; dashed lines are scrape /
            control flows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ArchitectureDiagram />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Forecasting workload</CardTitle>
            <CardDescription>
              Zero-shot time-series forecasting on the A100 with Amazon Chronos-2.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Section title="Model">
              <List
                items={[
                  ["Family", "Chronos-2 — encoder-only time-series foundation model (T5-encoder + group attention)"],
                  ["Active model", <code>amazon/chronos-2</code>],
                  ["Backbone", "~120M params · bf16 on CUDA, fp32 on CPU"],
                  ["Capabilities", "univariate, multivariate, past + known-future covariates, cross-learning across items"],
                  ["Max context / horizon", "8 192 / 1 024 (model defaults)"],
                  ["Inference", <code>predict_quantiles(inputs=[ctx], prediction_length, [0.1, 0.5, 0.9])</code>],
                  ["Context window used", "256 most recent indoor-temp samples per device"],
                  ["Horizon used", "default 24 steps (configurable in /jobs/forecast)"],
                  ["Throughput", "~300+ series/sec on a single A10G; faster on A100"],
                  ["Metric", "MAPE vs hold-out tail; published as Prometheus gauge aidemo_forecast_mape"],
                  ["Fallback", "amazon/chronos-bolt-small (T5-small encoder–decoder) if Chronos-2 fails to load"],
                ]}
              />
            </Section>
            <Section title="Runtime libraries">
              <Badges
                items={[
                  "chronos-forecasting >= 2.0",
                  "transformers (resolved by chronos-forecasting)",
                  "torch 2.5.1 + cuda 12.1",
                  "einops",
                  "Hugging Face Hub model cache /models",
                  "azure-identity 1.19.0",
                  "azure-servicebus 7.12.3",
                  "psycopg 3.2.3",
                  "prometheus-client 0.21.1",
                ]}
              />
            </Section>
            <Section title="Why Chronos-2?">
              <p className="text-muted-foreground">
                Chronos-2 is Amazon Science's universal time-series foundation
                model (Oct 2025). Unlike the older Chronos / Chronos-Bolt
                line-up, it is encoder-only with a group-attention mechanism that
                lets it do in-context learning across related series and
                covariates in a single forward pass — so we can forecast all our
                rooms together and exploit shared patterns. Compared to
                Chronos-Bolt it ships with a longer context (8 192) and longer
                horizon (1 024), bf16 GPU inference, and is roughly an order of
                magnitude faster per series on the same hardware.
              </p>
            </Section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reinforcement Learning workload</CardTitle>
            <CardDescription>
              On-policy PPO trained on a custom Gymnasium HVAC environment.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Section title="Algorithm">
              <List
                items={[
                  ["Algorithm", "Proximal Policy Optimization (PPO) — Stable-Baselines3 default actor-critic"],
                  ["Policy", "MlpPolicy (2× 64-unit tanh layers)"],
                  ["Vectorisation", "8 parallel envs via SB3 make_vec_env"],
                  ["Total steps", "default 20 000 (CLI: cli/submit rl)"],
                  ["Learning rate", "3e-4"],
                  ["Evaluation", "5 deterministic episodes after training"],
                  ["Artifacts", "policy.zip → Azure Blob (artifacts/rl/<job>/policy.zip)"],
                  ["Metric", "aidemo_rl_mean_reward Prometheus gauge labelled by algo"],
                ]}
              />
            </Section>
            <Section title="Environment (HvacRoomEnv)">
              <List
                items={[
                  ["State", "Box(5): occupants, outdoor °C, outdoor RH, indoor °C, setpoint °C"],
                  ["Action", "Discrete(5): idle, cool-low, cool-high, heat-low, heat-high"],
                  ["Reward", "−|indoor−setpoint| − energy_cost − 0.3·occupants·max(0,|err|−1)"],
                  ["Episode", "96 steps (~24h at 15-min ticks)"],
                  ["Dynamics", "outdoor pull (0.05·Δ), occupant heat (0.03·N), AC delta per action"],
                ]}
              />
            </Section>
            <Section title="Runtime libraries">
              <Badges
                items={[
                  "stable-baselines3 2.4.0",
                  "gymnasium 1.0.0",
                  "torch 2.5.1 + cuda 12.1",
                  "azure-storage-blob 12.23",
                  "azure-servicebus 7.12.3",
                ]}
              />
            </Section>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Infrastructure</CardTitle>
          <CardDescription>
            What lives where in Azure and how the pieces talk to each other.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Section title="AKS">
            <List
              items={[
                ["Cluster", "splatix-prod-aks (rg splatix.nl-prod)"],
                ["System pool", "Standard_D2s_v5 ×2"],
                ["GPU pool", "Standard_NC24ads_A100_v4 (autoscale 0..1, label workload=gpu-recon, taint nvidia.com/gpu=present:NoSchedule)"],
                ["GPU sharing", "nvidia-device-plugin time-slicing 4 logical GPUs"],
                ["Add-ons", "OIDC issuer, Workload Identity, KEDA, image cleaner"],
              ]}
            />
          </Section>
          <Section title="Data plane">
            <List
              items={[
                ["Container Registry", "aidemoacrm23gd3 (Premium, anonymous pull off)"],
                ["Service Bus", "aidemo-sb-m23gd3 — queues forecast-jobs, rl-jobs (Std tier)"],
                ["Postgres", "aidemo-pg-m23gd3 (Flexible Server, db aidemo, AAD auth)"],
                ["Blob Storage", "aidemoartm23gd3 / artifacts container"],
                ["Identity", "User-assigned aidemo-workload-id, federated to KSAs aidemo-api & aidemo-worker"],
              ]}
            />
          </Section>
          <Section title="Observability">
            <List
              items={[
                ["Stack", "kube-prometheus-stack 65.5.1 (Grafana + Prometheus + Alertmanager + Operator)"],
                ["Node-level", "node-exporter DaemonSet"],
                ["GPU-level", "nvidia/dcgm-exporter — DCGM 4.x dashboard ConfigMap auto-discovered"],
                ["Service discovery", "PodMonitor / ServiceMonitor on every aidemo workload"],
                ["Custom metrics", "aidemo_forecast_mape, aidemo_rl_mean_reward, aidemo_device_*"],
                ["Embed", "Grafana iframes via /api/config (anonymous viewer + allow_embedding)"],
              ]}
            />
          </Section>
          <Section title="Scaling & lifecycle">
            <List
              items={[
                ["Worker scale-from-zero", "KEDA azure-servicebus scaler watches queue length (1 msg = 1 pod)"],
                ["Forecast worker", "min 0 / max 2 replicas, requests nvidia.com/gpu=1"],
                ["RL worker", "min 0 / max 4 replicas (1 GPU slice each → A100 saturates at 4)"],
                ["GPU node", "cluster-autoscaler triggers vmss scale 0→1 when KEDA places GPU pod"],
                ["Cooldown", "queue empty + KEDA cooldown ⇒ pods → 0 ⇒ node de-provisions"],
              ]}
            />
          </Section>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Application stack</CardTitle>
          <CardDescription>UI, API, and shared libraries.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Section title="Web (aidemo/web)">
            <List
              items={[
                ["Framework", "Next.js 14.2 (standalone output) + React 18"],
                ["Styling", "Tailwind 3.4 + shadcn-style components + lucide-react"],
                ["Charts", "Custom D3.js v7 LineChart (no recharts)"],
                ["Data", "SWR with periodic refresh (3s lists, 30s history)"],
                ["API proxy", "/api/[...path]/route.ts streams to FastAPI, supports PATCH/POST/GET"],
              ]}
            />
          </Section>
          <Section title="API (aidemo/api)">
            <List
              items={[
                ["Framework", "FastAPI + uvicorn"],
                ["Auth to Azure", "DefaultAzureCredential → Workload Identity"],
                ["Endpoints", "/devices, /devices/{id}, /devices/{id}/telemetry, /jobs, /results/*, /jobs/forecast, /jobs/rl"],
                ["Schema mgmt", "ensure_schema() on boot creates devices, device_telemetry, jobs, *_results"],
              ]}
            />
          </Section>
          <Section title="Simulator (aidemo/simulator)">
            <List
              items={[
                ["Loop", "Single process, 5s tick, SIM_SPEED multiplier (1=realtime)"],
                ["Weather", "Shared diurnal sine + Ornstein-Uhlenbeck slow noise + RH anti-correlation"],
                ["Occupancy", "Time-of-day bell curves (10:00, 14:30) with weekend dampening per room profile"],
                ["Thermal", "First-order: outdoor coupling + occupant heat + AC delta + server-room gear heat"],
                ["Setpoints", "Re-read from Postgres every ~30s so UI button presses propagate to simulation"],
              ]}
            />
          </Section>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Demo cheat sheet</CardTitle>
          <CardDescription>Useful URLs and commands during a walkthrough.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <List
            items={[
              ["UI (local)", <code>http://localhost:3000</code>],
              ["API LB", "http://&lt;aks-api-lb&gt;:8000"],
              ["Grafana", "http://52.157.251.61 (anonymous viewer)"],
              ["Submit forecast", <code>POST /api/jobs/forecast</code>],
              ["Submit RL", <code>POST /api/jobs/rl</code>],
              ["Watch pods", <code>kubectl get pods -n aks-ai-demo -w</code>],
              ["Watch GPU node", <code>kubectl get nodes -l workload=gpu-recon</code>],
              ["Tail forecast logs", <code>kubectl logs -n aks-ai-demo -l app=forecast-worker -f</code>],
              ["KEDA state", <code>kubectl get scaledobject -n aks-ai-demo</code>],
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <div className="rounded-md border bg-background/50 p-3">{children}</div>
    </div>
  );
}

function List({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[170px,1fr] gap-x-3 gap-y-1 text-sm">
      {items.map(([k, v], i) => (
        <Fragment key={i}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd>{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Badges({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <Badge key={s} variant="secondary" className="font-mono text-[11px]">
          {s}
        </Badge>
      ))}
    </div>
  );
}

