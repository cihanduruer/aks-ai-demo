"use client";
import { Thermostat, type ThermoDevice } from "@/components/thermostat";
import { useApi } from "@/lib/api";

export default function DevicesPage() {
  const { data } = useApi<ThermoDevice[]>("/devices", 3000);
  const devices = data ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Devices</h1>
        <p className="text-muted-foreground">
          Each tile is a virtual HVAC thermostat. Press ▲/▼ to change the setpoint —
          the simulator will reach for the new target.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {devices.map((d) => (
          <Thermostat key={d.id} d={d} href={`/devices/${d.id}`} />
        ))}
        {devices.length === 0 && (
          <div className="text-sm text-muted-foreground">Loading devices…</div>
        )}
      </div>
    </div>
  );
}

