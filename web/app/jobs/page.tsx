"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useApi, postJson } from "@/lib/api";
import { GpuStatusCard } from "@/components/gpu-status-card";

type Job = {
  id: string;
  type: string;
  status: string;
  message_id: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};

const statusVariant = (s: string) =>
  s === "succeeded"
    ? "success"
    : s === "failed"
    ? "destructive"
    : s === "running"
    ? "warning"
    : s === "queued"
    ? "outline"
    : "secondary";

function durationMs(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/** Live-updating elapsed time for running jobs. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const cfgFetcher = (u: string) => fetch(u).then((r) => r.json());

export default function JobsPage() {
  const { data, mutate } = useApi<Job[]>("/jobs?limit=100", 2000);
  const { data: cfg } = useSWR<{ grafanaUrl: string }>("/api/config", cfgFetcher);
  const { data: devices } = useApi<Array<{ id: string; name: string }>>("/devices", 30000);
  const [busy, setBusy] = useState(false);
  const [busyForecast, setBusyForecast] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [forecastDevice, setForecastDevice] = useState<string>("");
  const [forecastHorizon, setForecastHorizon] = useState<number>(24);

  const jobs = data ?? [];
  const hasRunning = jobs.some((j) => j.status === "running" || j.status === "queued");
  const now = useNow(hasRunning);
  const grafana = (cfg?.grafanaUrl ?? "").replace(/\/$/, "");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
    read();
    const obs = new MutationObserver(read);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const stats = useMemo(() => {
    const acc = { total: jobs.length, forecast: 0, rl: 0, succeeded: 0, failed: 0, running: 0 };
    for (const j of jobs) {
      if (j.type === "forecast") acc.forecast++;
      else if (j.type === "rl") acc.rl++;
      if (j.status === "succeeded") acc.succeeded++;
      else if (j.status === "failed") acc.failed++;
      else if (j.status === "running") acc.running++;
    }
    return acc;
  }, [jobs]);

  const submitRl = async () => {
    setBusy(true);
    try {
      await postJson("/jobs/rl", { algo: "PPO", total_steps: 20000 });
      await mutate();
    } finally {
      setBusy(false);
    }
  };

  const submitForecast = async () => {
    const dev = forecastDevice || devices?.[0]?.id;
    if (!dev) return;
    setBusyForecast(true);
    try {
      await postJson("/jobs/forecast", { device_id: dev, horizon: forecastHorizon });
      await mutate();
    } finally {
      setBusyForecast(false);
    }
  };

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Jobs</h1>
          <p className="text-sm text-muted-foreground">
            Service Bus → KEDA → AKS pods. Click a row to inspect technical details.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Device</label>
            <select
              value={forecastDevice}
              onChange={(e) => setForecastDevice(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">{devices?.[0]?.id ? `${devices[0].id} (default)` : "loading…"}</option>
              {(devices ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.id} · {d.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Horizon</label>
            <input
              type="number"
              min={1}
              max={168}
              value={forecastHorizon}
              onChange={(e) => setForecastHorizon(Math.max(1, Math.min(168, Number(e.target.value) || 24)))}
              className="h-9 w-20 rounded-md border bg-background px-2 text-sm"
            />
          </div>
          <Button variant="secondary" onClick={submitForecast} disabled={busyForecast || !devices?.length}>
            {busyForecast ? "Queueing…" : "Submit Forecast job"}
          </Button>
          <Button onClick={submitRl} disabled={busy}>
            {busy ? "Queueing…" : "Submit RL job"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">How a job flows</CardTitle>
          <CardDescription>
            End-to-end pipeline for both forecast and RL workloads.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              UI <code>POST /api/jobs/{`{type}`}</code> → API proxy → FastAPI
              <code> /jobs/{`{type}`}</code>.
            </li>
            <li>
              API enqueues a JSON message to Azure Service Bus queue (
              <code>forecast-jobs</code> / <code>rl-jobs</code>) using
              <code> azure-servicebus 7.12</code> + Workload Identity.
            </li>
            <li>
              <strong>KEDA</strong> watches the queue length via the
              <code> azure-servicebus</code> scaler and scales the matching
              Deployment from 0 → N pods.
            </li>
            <li>
              Worker pulls the message, the dispatcher writes a row to Postgres
              <code> jobs(status=running)</code>, then runs the handler.
            </li>
            <li>
              On success: artifacts saved (forecast median + MAPE, RL reward
              curve / policy zip in Blob), row updated to{" "}
              <code>succeeded</code>. On exception: traceback stored in{" "}
              <code>jobs.error</code>.
            </li>
            <li>
              When the queue empties, KEDA cooldown scales workers back to 0 —
              GPU node de-provisions automatically.
            </li>
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-5">
        <SmallStat label="Total" value={stats.total} />
        <SmallStat label="Forecast" value={stats.forecast} />
        <SmallStat label="RL" value={stats.rl} />
        <SmallStat label="Succeeded" value={stats.succeeded} />
        <SmallStat label="Failed" value={stats.failed} />
      </div>

      <GpuStatusCard />

      {grafana && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Live worker telemetry</CardTitle>
            <CardDescription>
              GPU utilisation (DCGM) and pod activity for the
              <code> aks-ai-demo</code> namespace, refreshed every 10s. Embedded
              from Grafana.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-2">
            <iframe
              key={`gpu-${theme}`}
              title="GPU"
              src={`${grafana}/d-solo/dcgm-exporter/nvidia-dcgm-exporter?orgId=1&refresh=10s&panelId=2&theme=${theme}`}
              className="h-72 w-full rounded-md border bg-background"
              loading="lazy"
            />
            <iframe
              key={`pods-${theme}`}
              title="Pods"
              src={`${grafana}/d-solo/85a562078cdf77779eaa1add43ccec1e/kubernetes-compute-resources-namespace-pods?var-namespace=aks-ai-demo&orgId=1&refresh=10s&panelId=1&theme=${theme}`}
              className="h-72 w-full rounded-md border bg-background"
              loading="lazy"
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent</CardTitle>
          <CardDescription>Most recent 100 jobs across both queues.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6"></TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Finished</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Job ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((j) => {
                const open = openIds.has(j.id);
                const running = j.status === "running" && j.started_at;
                const queued = j.status === "queued";
                const dur = running
                  ? now - new Date(j.started_at!).getTime()
                  : queued
                  ? now - new Date(j.created_at).getTime()
                  : durationMs(j.started_at, j.finished_at);
                return (
                  <Fragment key={j.id}>
                    <TableRow className="cursor-pointer" onClick={() => toggle(j.id)}>
                      <TableCell>
                        {open ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{j.type}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(j.status) as any}>{j.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {new Date(j.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">
                        {j.started_at ? new Date(j.started_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {j.finished_at ? new Date(j.finished_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{fmtDuration(dur)}</TableCell>
                      <TableCell className="font-mono text-xs">{j.id.slice(0, 8)}</TableCell>
                    </TableRow>
                    {open && (
                      <TableRow key={j.id + ":d"}>
                        <TableCell colSpan={8} className="bg-muted/30">
                          <JobDetails j={j} dur={dur} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wider">{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function JobDetails({ j, dur }: { j: Job; dur: number | null }) {
  const queue = j.type === "forecast" ? "forecast-jobs" : "rl-jobs";
  const deployment = j.type === "forecast" ? "forecast-worker" : "rl-worker";
  return (
    <div className="grid gap-4 p-3 text-xs md:grid-cols-2">
      <div className="space-y-2">
        <Section title="Identifiers">
          <KV k="Job UUID" v={<code className="break-all">{j.id}</code>} />
          <KV k="Service Bus message ID" v={<code className="break-all">{j.message_id}</code>} />
          <KV k="Queue" v={<code>{queue}</code>} />
          <KV k="Deployment" v={<code>{deployment}</code>} />
        </Section>
        <Section title="Timing">
          <KV k="Created" v={new Date(j.created_at).toISOString()} />
          <KV k="Started" v={j.started_at ? new Date(j.started_at).toISOString() : "—"} />
          <KV k="Finished" v={j.finished_at ? new Date(j.finished_at).toISOString() : "—"} />
          <KV k="Run duration" v={fmtDuration(dur)} />
        </Section>
      </div>
      <div className="space-y-2">
        <Section title="Pipeline">
          {j.type === "forecast" ? (
            <ul className="list-disc space-y-1 pl-4">
              <li>API loads last 256 indoor samples from Postgres for the device.</li>
              <li>
                Worker lazy-loads <code>amazon/chronos-2</code> (encoder-only
                foundation model, ~120M params) from Hugging Face, warmed once per pod.
              </li>
              <li>
                Calls <code>predict_quantiles(inputs=[ctx], prediction_length, [0.1, 0.5, 0.9])</code> —
                stores the median + MAPE vs holdout in <code>forecast_results</code>.
              </li>
              <li>
                Runs on the A100 GPU pool in <code>bf16</code> with one logical
                slice (time-sliced 4×) requested via <code>nvidia.com/gpu: 1</code>.
              </li>
            </ul>
          ) : (
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Worker builds 8 vectorised{" "}
                <code>HvacRoomEnv</code> instances (Gymnasium 1.0).
              </li>
              <li>
                Trains Stable-Baselines3 PPO on GPU for{" "}
                <code>total_steps</code>; reward curve sampled every ~1k steps.
              </li>
              <li>
                Evaluates 5 deterministic episodes; mean reward exposed as
                Prometheus gauge <code>aidemo_rl_mean_reward</code>.
              </li>
              <li>
                Policy zip optionally uploaded to Azure Blob (
                <code>artifacts/rl/&lt;job&gt;/policy.zip</code>).
              </li>
            </ul>
          )}
        </Section>
        {j.error && (
          <Section title="Error">
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[11px] text-red-600 dark:text-red-400">
              {j.error}
            </pre>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-background/60 p-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px,1fr] gap-2 py-0.5">
      <div className="text-muted-foreground">{k}</div>
      <div>{v}</div>
    </div>
  );
}
