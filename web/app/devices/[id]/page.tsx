"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useApi, postJson } from "@/lib/api";
import { LineChart } from "@/components/charts/line-chart";
import { Thermostat, type ThermoDevice } from "@/components/thermostat";

type Tele = {
  ts: string; occupants: number; outdoor_temp_c: number; outdoor_humidity: number;
  indoor_temp_c: number; setpoint_c: number; energy_w: number; action: string;
};

export default function DevicePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: telem } = useApi<Tele[]>(`/devices/${id}/telemetry?hours=24&limit=20000`, 5000);
  const { data: devices } = useApi<ThermoDevice[]>("/devices", 3000);
  const device = (devices ?? []).find((x) => x.id === id) ?? null;

  const [submitting, setSubmitting] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  const submitForecast = async () => {
    setSubmitting(true);
    try {
      const r = await postJson<{ message_id: string }>("/jobs/forecast", { device_id: id, horizon: 24 });
      setLast(`forecast queued: ${r.message_id}`);
    } catch (e) {
      setLast(`error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const rows = telem ?? [];
  const xLabels = rows.map((d) => new Date(d.ts).toLocaleTimeString());
  const indoor = rows.map((d) => d.indoor_temp_c);
  const outdoor = rows.map((d) => d.outdoor_temp_c);
  const setpoint = rows.map((d) => d.setpoint_c);
  const energy = rows.map((d) => d.energy_w);
  const occupants = rows.map((d) => d.occupants);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[420px,1fr]">
        <div>
          {device ? (
            <Thermostat d={device} size="lg" />
          ) : (
            <div className="rounded-3xl border border-dashed p-10 text-sm text-muted-foreground">
              Loading device…
            </div>
          )}
        </div>
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>{device?.name ?? id}</CardTitle>
                <CardDescription>
                  {device ? `${device.room} · setpoint ${device.setpoint_c.toFixed(1)}°C` : "—"}
                </CardDescription>
              </div>
              <Button onClick={submitForecast} disabled={submitting}>
                {submitting ? "Queueing…" : "Run forecast"}
              </Button>
            </div>
            {last && <p className="mt-2 text-xs text-muted-foreground">{last}</p>}
          </CardHeader>
          <CardContent className="flex-1">
            <LineChart
              height={320}
              xLabels={xLabels}
              showLegend
              series={[
                { key: "indoor", label: "indoor °C", color: "#3b82f6", data: indoor },
                { key: "outdoor", label: "outdoor °C", color: "#f97316", data: outdoor },
                { key: "setpoint", label: "setpoint °C", color: "#10b981", data: setpoint, dashed: true },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Energy & Occupants</CardTitle></CardHeader>
        <CardContent>
          <LineChart
            height={224}
            xLabels={xLabels}
            showLegend
            dualAxis
            series={[
              { key: "energy", label: "energy (W)", color: "#eab308", data: energy, axis: "left" },
              { key: "occupants", label: "occupants", color: "#a78bfa", data: occupants, axis: "right" },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
