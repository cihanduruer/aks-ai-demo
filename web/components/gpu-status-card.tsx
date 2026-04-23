"use client";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";

type GpuPod = {
  name: string;
  app: string;
  phase: string;
  node: string;
  created_at?: string | null;
  started_at: string | null;
  schedule_reason?: string;
  schedule_message?: string;
  containers: { name: string; ready: boolean; restarts: number; state: string; detail: string }[];
};

type GpuNode = {
  name: string;
  ready: boolean;
  created_at: string | null;
  instance_type: string;
  gpu_capacity: number;
  gpu_allocatable: number;
  kubelet_version: string;
};

type GpuStatus = {
  summary: {
    state: "offline" | "scaling" | "blocked" | "starting" | "ready";
    node_count: number;
    ready_node_count: number;
    gpu_capacity: number;
    running_pods: number;
    pending_pods: number;
  };
  nodes: GpuNode[];
  pods: GpuPod[];
};

const fetcher = async (u: string) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
};

const STATE_META: Record<
  GpuStatus["summary"]["state"],
  { label: string; dotClass: string; pulse: boolean; description: string }
> = {
  offline: {
    label: "Offline",
    dotClass: "bg-zinc-500",
    pulse: false,
    description: "GPU node pool is scaled to zero. The next job triggers KEDA + cluster autoscaler.",
  },
  scaling: {
    label: "Scaling up",
    dotClass: "bg-amber-500",
    pulse: true,
    description: "Cluster autoscaler is provisioning a new GPU VM. Worker pods are Pending.",
  },
  blocked: {
    label: "Blocked",
    dotClass: "bg-rose-500",
    pulse: false,
    description: "Pods are Unschedulable and the cluster autoscaler will not add a node. See pod reason below.",
  },
  starting: {
    label: "Starting",
    dotClass: "bg-sky-500",
    pulse: true,
    description: "Node is up and pulling the image / loading the model into GPU memory.",
  },
  ready: {
    label: "Working",
    dotClass: "bg-emerald-500",
    pulse: true,
    description: "GPU node ready and worker pods running on it.",
  },
};

export function GpuStatusCard() {
  const { data, error } = useSWR<GpuStatus>("/api/cluster/gpu", fetcher, { refreshInterval: 5000 });

  if (error) {
    return (
      <div className="rounded-md border bg-muted/30 p-4 text-sm">
        <div className="font-semibold">GPU pool status unavailable</div>
        <div className="text-xs text-muted-foreground mt-1">
          The API could not query the Kubernetes control plane. Make sure the cluster role
          binding is in place and the API was restarted after the upgrade.
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
        Querying GPU pool…
      </div>
    );
  }

  const meta = STATE_META[data.summary.state];

  return (
    <div className="rounded-md border bg-background p-4 text-sm">
      <div className="flex items-start gap-3">
        <span className="relative mt-1 flex h-3 w-3">
          {meta.pulse && (
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${meta.dotClass}`}
            />
          )}
          <span className={`relative inline-flex h-3 w-3 rounded-full ${meta.dotClass}`} />
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">GPU pool · {meta.label}</span>
            <Badge variant="secondary" className="font-mono text-[10px]">
              gpurecon · NC24ads_A100_v4
            </Badge>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{meta.description}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <Stat label="Nodes" value={`${data.summary.ready_node_count} / ${data.summary.node_count}`} sub="ready / total" />
        <Stat label="GPU slices" value={data.summary.gpu_capacity} sub="time-sliced 4×" />
        <Stat label="Running pods" value={data.summary.running_pods} sub="forecast + rl" />
        <Stat label="Pending pods" value={data.summary.pending_pods} sub="awaiting GPU" />
      </div>

      {data.nodes.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Node detail
          </div>
          {data.nodes.map((n) => (
            <div key={n.name} className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1 text-xs">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${n.ready ? "bg-emerald-500" : "bg-amber-500"}`} />
                <code className="break-all">{n.name}</code>
              </div>
              <div className="text-muted-foreground">
                {n.instance_type || "?"} · GPU {n.gpu_allocatable}/{n.gpu_capacity}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.pods.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Worker pods
          </div>
          {data.pods.map((p) => {
            const tone = p.phase === "Running"
              ? "bg-emerald-500"
              : p.phase === "Pending"
              ? (p.schedule_reason === "Unschedulable" ? "bg-rose-500" : "bg-amber-500")
              : p.phase === "Succeeded"
              ? "bg-sky-500"
              : "bg-rose-500";
            const detail = p.schedule_reason
              ? `${p.schedule_reason} · ${(p.schedule_message || "").slice(0, 120)}`
              : p.containers[0]?.detail || p.phase;
            return (
              <div key={p.name} className="flex items-start justify-between gap-3 rounded border bg-muted/30 px-2 py-1 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-2 w-2 rounded-full ${tone}`} />
                  <Badge variant="secondary" className="font-mono text-[10px]">{p.app}</Badge>
                  <code className="truncate">{p.name}</code>
                </div>
                <div className="text-right text-muted-foreground max-w-[60%] truncate" title={p.schedule_message || detail}>
                  {p.phase} · {detail}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded border bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
