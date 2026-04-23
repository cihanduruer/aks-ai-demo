"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  Snowflake,
  Flame,
  Power,
  Wifi,
  Droplets,
  Users,
  Zap,
  ExternalLink,
  Fan,
} from "lucide-react";
import { useSWRConfig } from "swr";
import { patchJson } from "@/lib/api";

export type ThermoLatest = {
  ts: string;
  occupants: number;
  outdoor_temp_c: number;
  outdoor_humidity: number;
  indoor_temp_c: number;
  energy_w: number;
  action: string;
};

export type ThermoDevice = {
  id: string;
  name: string;
  room: string;
  setpoint_c: number;
  latest: ThermoLatest | null;
};

const STEP = 0.5;
const MIN_SP = 16;
const MAX_SP = 28;

function formatTemp(v: number | undefined | null): string {
  if (v === undefined || v === null || Number.isNaN(v)) return "--.-";
  return v.toFixed(1);
}

/**
 * Renders a single physical-looking thermostat unit. `size` controls the
 * overall scale: "md" for grid cards, "lg" for the device detail hero.
 */
export function Thermostat({
  d,
  size = "md",
  href,
}: {
  d: ThermoDevice;
  size?: "md" | "lg";
  href?: string;
}) {
  const { mutate } = useSWRConfig();
  const [pendingSp, setPendingSp] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const targetSp = pendingSp ?? d.setpoint_c;
  const indoor = d.latest?.indoor_temp_c ?? null;
  const outdoor = d.latest?.outdoor_temp_c;
  const action = d.latest?.action ?? "idle";
  const occ = d.latest?.occupants ?? 0;
  const hum = d.latest ? Math.round(d.latest.outdoor_humidity * 100) : null;
  const energy = d.latest?.energy_w;

  // Once a server confirmation comes back equal to pendingSp, drop the local override.
  useEffect(() => {
    if (pendingSp !== null && Math.abs(d.setpoint_c - pendingSp) < 1e-3) {
      setPendingSp(null);
    }
  }, [d.setpoint_c, pendingSp]);

  const submit = (sp: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setBusy(true);
      setErr(null);
      try {
        await patchJson(`/devices/${d.id}`, { setpoint_c: sp });
        // Force an immediate refresh of /devices.
        mutate("/devices");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "update failed");
      } finally {
        setBusy(false);
      }
    }, 350);
  };

  const adjust = (delta: number) => {
    const next = Math.min(MAX_SP, Math.max(MIN_SP, +(targetSp + delta).toFixed(1)));
    if (next === targetSp) return;
    setPendingSp(next);
    submit(next);
  };

  const ActionIcon = action === "cool" ? Snowflake : action === "heat" ? Flame : Power;
  const actionColor =
    action === "cool"
      ? "text-sky-400"
      : action === "heat"
      ? "text-orange-400"
      : "text-zinc-500";

  const lcdBigCls =
    size === "lg" ? "text-[6.5rem] leading-none" : "text-[4rem] leading-none";
  const lcdUnitCls = size === "lg" ? "text-3xl" : "text-xl";

  const TitleWrap: any = href ? Link : "div";
  const titleProps: any = href ? { href } : {};

  return (
    <div
      className={
        "group relative overflow-hidden rounded-3xl border border-zinc-300 " +
        "bg-gradient-to-br from-zinc-100 via-zinc-200 to-zinc-300 " +
        "p-4 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.7)] " +
        "dark:border-zinc-700 dark:from-zinc-700 dark:via-zinc-800 dark:to-zinc-900 " +
        "dark:shadow-[0_10px_30px_-10px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.05)]"
      }
    >
      {/* Top label strip */}
      <div className="mb-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
        <TitleWrap
          {...titleProps}
          className={
            "flex items-center gap-2 " +
            (href ? "hover:text-zinc-900 dark:hover:text-zinc-100" : "")
          }
        >
          <span className="font-mono text-zinc-700 dark:text-zinc-200">{d.name}</span>
          {href && <ExternalLink className="h-3 w-3 opacity-60" />}
        </TitleWrap>
        <div className="flex items-center gap-2">
          <Wifi className="h-3 w-3 text-emerald-500" />
          <span>{d.room}</span>
        </div>
      </div>

      {/* LCD screen */}
      <div
        className={
          "relative rounded-xl border border-emerald-900/40 " +
          "bg-gradient-to-b from-[#b8d39a] to-[#7da55b] " +
          "p-4 font-mono text-emerald-950 " +
          "shadow-[inset_0_2px_6px_rgba(0,0,0,0.35),inset_0_-1px_0_rgba(255,255,255,0.25)]"
        }
      >
        {/* Subtle scanline texture */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl opacity-20"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0 1px, transparent 1px 3px)",
          }}
        />

        <div className="relative flex items-start justify-between">
          <div>
            <div className="flex items-baseline gap-1">
              <span className={`font-bold tabular-nums ${lcdBigCls}`}>
                {formatTemp(indoor)}
              </span>
              <span className={`font-semibold ${lcdUnitCls}`}>°C</span>
            </div>
            <div className="mt-1 text-xs uppercase tracking-widest opacity-80">
              Indoor
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-1 rounded-full bg-emerald-950/20 px-2 py-1 text-[10px] font-bold uppercase tracking-widest">
              <ActionIcon className={`h-3 w-3 ${actionColor}`} />
              <span>{action}</span>
              {action !== "idle" && <Fan className="ml-1 h-3 w-3 animate-spin-slow opacity-70" />}
            </div>
            <div className="text-right text-[11px] leading-tight">
              <div className="font-bold tabular-nums">
                SET {formatTemp(targetSp)}°
              </div>
              <div className="opacity-80">
                OUT {formatTemp(outdoor)}°
              </div>
            </div>
          </div>
        </div>

        {/* Bottom info row inside LCD */}
        <div className="relative mt-3 grid grid-cols-3 gap-2 border-t border-emerald-950/30 pt-2 text-[10px] uppercase tracking-widest">
          <div className="flex items-center gap-1">
            <Droplets className="h-3 w-3" />
            <span className="tabular-nums">{hum ?? "--"}%</span>
          </div>
          <div className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            <span className="tabular-nums">{occ}</span>
          </div>
          <div className="flex items-center gap-1 justify-self-end">
            <Zap className="h-3 w-3" />
            <span className="tabular-nums">
              {energy === undefined ? "--" : Math.round(energy)} W
            </span>
          </div>
        </div>
      </div>

      {/* Physical buttons row */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
          Setpoint
        </div>
        <div className="flex items-center gap-2">
          <PhysButton
            ariaLabel="decrease setpoint"
            onClick={() => adjust(-STEP)}
            disabled={busy || targetSp <= MIN_SP}
          >
            <ChevronDown className="h-5 w-5" />
          </PhysButton>
          <div className="min-w-[3.5rem] rounded-md bg-zinc-900/80 px-3 py-1 text-center font-mono text-lg font-bold text-emerald-300 shadow-inner dark:bg-black/60">
            {formatTemp(targetSp)}
          </div>
          <PhysButton
            ariaLabel="increase setpoint"
            onClick={() => adjust(STEP)}
            disabled={busy || targetSp >= MAX_SP}
          >
            <ChevronUp className="h-5 w-5" />
          </PhysButton>
        </div>
      </div>

      {(err || pendingSp !== null) && (
        <div className="mt-2 text-right text-[10px]">
          {err ? (
            <span className="text-red-500">{err}</span>
          ) : (
            <span className="text-zinc-500 dark:text-zinc-400">syncing…</span>
          )}
        </div>
      )}
    </div>
  );
}

function PhysButton({
  children,
  onClick,
  disabled,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={
        "flex h-9 w-9 items-center justify-center rounded-full " +
        "border border-zinc-400/70 bg-gradient-to-b from-zinc-50 to-zinc-300 text-zinc-800 " +
        "shadow-[0_2px_0_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.9)] " +
        "transition active:translate-y-[1px] active:shadow-[0_1px_0_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.6)] " +
        "disabled:opacity-50 disabled:active:translate-y-0 " +
        "dark:border-zinc-600 dark:from-zinc-500 dark:to-zinc-700 dark:text-zinc-100 " +
        "dark:shadow-[0_2px_0_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.15)]"
      }
    >
      {children}
    </button>
  );
}
