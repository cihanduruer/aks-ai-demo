"use client";
import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LineChart } from "@/components/charts/line-chart";
import { useApi } from "@/lib/api";

export type DashboardDevice = {
  id: string;
  name: string;
  room: string;
  setpoint_c: number;
  latest: null | {
    ts: string;
    occupants: number;
    outdoor_temp_c: number;
    outdoor_humidity: number;
    indoor_temp_c: number;
    energy_w: number;
    action: string;
  };
};

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

export function DeviceRow({ d }: { d: DashboardDevice }) {
  const [open, setOpen] = useState(false);
  // Only fetch when expanded; pull last 24 hours.
  const history = useApi<Tele[]>(open ? `/devices/${d.id}/telemetry?hours=24&limit=20000` : null, 30000);

  const rows = history.data ?? [];
  const xLabels = rows.map((r) => new Date(r.ts).toLocaleString());
  const indoor = rows.map((r) => r.indoor_temp_c);
  const outdoor = rows.map((r) => r.outdoor_temp_c);
  const setpoint = rows.map((r) => r.setpoint_c);
  const energy = rows.map((r) => r.energy_w);
  const humidity = rows.map((r) => r.outdoor_humidity * 100);
  const occupants = rows.map((r) => r.occupants);

  return (
    <Card className="transition">
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full flex-wrap items-center gap-x-6 gap-y-3 p-4 text-left hover:bg-accent/40"
        >
          <span className="text-muted-foreground">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
          <div className="min-w-[160px] flex-shrink-0">
            <div className="font-semibold">{d.name}</div>
            <div className="text-xs text-muted-foreground">
              {d.room} · setpoint {d.setpoint_c.toFixed(1)}°C
            </div>
          </div>
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
          <div className="ml-auto grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
            <Metric label="Indoor" value={d.latest ? `${d.latest.indoor_temp_c.toFixed(1)}°` : "—"} />
            <Metric label="Outdoor" value={d.latest ? `${d.latest.outdoor_temp_c.toFixed(1)}°` : "—"} />
            <Metric label="Occupants" value={d.latest?.occupants ?? "—"} />
            <Metric label="Humidity" value={d.latest ? `${(d.latest.outdoor_humidity * 100).toFixed(0)}%` : "—"} />
            <Metric label="Energy" value={d.latest ? `${d.latest.energy_w.toFixed(0)} W` : "—"} />
          </div>
          <Link
            href={`/devices/${d.id}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            open <ExternalLink className="h-3 w-3" />
          </Link>
        </button>

        {open && (
          <div className="space-y-4 border-t p-4">
            {!history.data && (
              <div className="text-xs text-muted-foreground">Loading history…</div>
            )}
            {history.data && rows.length === 0 && (
              <div className="text-xs text-muted-foreground">No telemetry yet.</div>
            )}
            {rows.length > 0 && (
              <>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    Temperatures · last {rows.length} samples
                  </div>
                  <LineChart
                    height={200}
                    xLabels={xLabels}
                    showLegend
                    series={[
                      { key: "indoor", label: "indoor °C", color: "#3b82f6", data: indoor },
                      { key: "outdoor", label: "outdoor °C", color: "#f97316", data: outdoor },
                      { key: "setpoint", label: "setpoint °C", color: "#10b981", data: setpoint, dashed: true },
                    ]}
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">Energy & Occupants</div>
                    <LineChart
                      height={180}
                      xLabels={xLabels}
                      showLegend
                      dualAxis
                      series={[
                        { key: "energy", label: "energy (W)", color: "#eab308", data: energy, axis: "left" },
                        { key: "occupants", label: "occupants", color: "#a78bfa", data: occupants, axis: "right" },
                      ]}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">Humidity</div>
                    <LineChart
                      height={180}
                      xLabels={xLabels}
                      series={[
                        { key: "humidity", label: "humidity %", color: "#06b6d4", data: humidity },
                      ]}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
