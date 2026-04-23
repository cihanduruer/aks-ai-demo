"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
import { useApi } from "@/lib/api";
import { LineChart } from "@/components/charts/line-chart";
import type { DashboardDevice } from "@/components/device-row";

type Job = { id: string; type: string; status: string; created_at: string };

type Tele = {
  ts: string;
  occupants: number;
  outdoor_temp_c: number;
  outdoor_humidity: number;
  indoor_temp_c: number;
  setpoint_c: number;
  energy_w: number;
  action: string;
};

export default function Dashboard() {
  const devices = useApi<DashboardDevice[]>("/devices", 3000);
  const jobs = useApi<Job[]>("/jobs", 3000);

  const list = devices.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && list.length > 0) setSelectedId(list[0].id);
  }, [list, selectedId]);

  const counts = (jobs.data ?? []).reduce<Record<string, number>>((acc, j) => {
    const k = `${j.type}:${j.status}`;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Fleet Dashboard</h1>
        <p className="text-muted-foreground">
          Live HVAC telemetry and AI workload status.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard title="Devices" value={devices.data?.length ?? "—"} />
        <StatCard
          title="Forecast jobs (succeeded)"
          value={counts["forecast:succeeded"] ?? 0}
        />
        <StatCard title="RL jobs (succeeded)" value={counts["rl:succeeded"] ?? 0} />
        <StatCard
          title="Failures"
          value={(counts["forecast:failed"] ?? 0) + (counts["rl:failed"] ?? 0)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px,1fr]">
        <div className="flex flex-col gap-2">
          {list.map((d) => (
            <DeviceListItem
              key={d.id}
              d={d}
              active={d.id === selectedId}
              onSelect={() => setSelectedId(d.id)}
            />
          ))}
          {list.length === 0 && (
            <div className="text-sm text-muted-foreground">Loading devices…</div>
          )}
        </div>
        <DeviceCharts deviceId={selectedId} />
      </div>
    </div>
  );
}

function DeviceListItem({
  d,
  active,
  onSelect,
}: {
  d: DashboardDevice;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition " +
        (active ? "border-primary bg-accent shadow-sm" : "hover:bg-accent/40")
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{d.name}</span>
          <Badge
            variant={
              d.latest?.action === "cool"
                ? "secondary"
                : d.latest?.action === "heat"
                ? "warning"
                : "outline"
            }
          >
            {d.latest?.action ?? "n/a"}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {d.room} · sp {d.setpoint_c.toFixed(1)}°C ·{" "}
          {d.latest ? `${d.latest.indoor_temp_c.toFixed(1)}°C` : "—"} ·{" "}
          {d.latest?.occupants ?? 0} occ ·{" "}
          {d.latest ? `${Math.round(d.latest.energy_w)} W` : "—"}
        </div>
      </div>
    </button>
  );
}

function DeviceCharts({ deviceId }: { deviceId: string | null }) {
  const history = useApi<Tele[]>(
    deviceId ? `/devices/${deviceId}/telemetry?hours=24&limit=20000` : null,
    30000,
  );

  if (!deviceId) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          Select a device to view its history.
        </CardContent>
      </Card>
    );
  }

  const rows = history.data ?? [];
  const xLabels = rows.map((r) => new Date(r.ts).toLocaleString());
  const indoor = rows.map((r) => r.indoor_temp_c);
  const outdoor = rows.map((r) => r.outdoor_temp_c);
  const setpoint = rows.map((r) => r.setpoint_c);
  const energy = rows.map((r) => r.energy_w);
  const humidity = rows.map((r) => r.outdoor_humidity * 100);
  const occupants = rows.map((r) => r.occupants);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle>{deviceId}</CardTitle>
            <Link
              href={`/devices/${deviceId}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              open device <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <CardDescription>
            Last 24 hours · {rows.length.toLocaleString()} samples
          </CardDescription>
        </CardHeader>
      </Card>

      {!history.data && (
        <Card>
          <CardContent className="p-6 text-xs text-muted-foreground">
            Loading history…
          </CardContent>
        </Card>
      )}
      {history.data && rows.length === 0 && (
        <Card>
          <CardContent className="p-6 text-xs text-muted-foreground">
            No telemetry yet for this device.
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <>
          <ChartCard title="Temperatures">
            <LineChart
              height={240}
              xLabels={xLabels}
              showLegend
              series={[
                { key: "indoor", label: "indoor °C", color: "#3b82f6", data: indoor },
                { key: "outdoor", label: "outdoor °C", color: "#f97316", data: outdoor },
                { key: "setpoint", label: "setpoint °C", color: "#10b981", data: setpoint, dashed: true },
              ]}
            />
          </ChartCard>

          <ChartCard title="Energy & Occupants">
            <LineChart
              height={220}
              xLabels={xLabels}
              showLegend
              dualAxis
              series={[
                { key: "energy", label: "energy (W)", color: "#eab308", data: energy, axis: "left" },
                { key: "occupants", label: "occupants", color: "#a78bfa", data: occupants, axis: "right" },
              ]}
            />
          </ChartCard>

          <ChartCard title="Outdoor humidity">
            <LineChart
              height={200}
              xLabels={xLabels}
              series={[{ key: "humidity", label: "humidity %", color: "#06b6d4", data: humidity }]}
            />
          </ChartCard>
        </>
      )}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function StatCard({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
