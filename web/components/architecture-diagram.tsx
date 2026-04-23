"use client";
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

type LaneId = "client" | "edge" | "api" | "async" | "compute" | "data" | "obs";
type NodeKind = "browser" | "web" | "api" | "queue" | "scaler" | "worker" | "store" | "obs";

type Node = {
  id: string;
  label: string;
  sub?: string;
  lane: LaneId;
  /** column inside the lane (0-based) */
  col: number;
  kind: NodeKind;
};

type EdgeKind = "data" | "ctrl" | "scrape" | "embed";

type Edge = {
  from: string;
  to: string;
  label?: string;
  /** "data" = solid + animated token, "ctrl" = dashed purple, "scrape" = dashed grey, "embed" = dashed teal */
  kind?: EdgeKind;
};

const LANES: { id: LaneId; label: string; sub?: string }[] = [
  { id: "client",  label: "1 · Client",         sub: "user enters here" },
  { id: "edge",    label: "2 · Edge / UI",      sub: "Next.js standalone" },
  { id: "api",     label: "3 · API",            sub: "FastAPI · Workload Identity" },
  { id: "async",   label: "4 · Async dispatch", sub: "Service Bus + KEDA" },
  { id: "compute", label: "5 · Compute (AKS GPU pool)", sub: "scale-from-zero workers" },
  { id: "data",    label: "6 · Data plane",     sub: "Postgres · Blob · ACR" },
  { id: "obs",     label: "7 · Observability",  sub: "Prometheus · Grafana" },
];

// Top-to-bottom swim-lane layout: lanes are stacked rows; each lane has a few columns.
const BOX_W = 220;
const BOX_H = 64;
const COL_GAP = 60;
const LANE_PAD_LEFT = 200; // room for lane title
const LANE_HEIGHT = 150;
const LANE_PAD_TOP = 24;

const NODES: Node[] = [
  { id: "browser", lane: "client",  col: 0, kind: "browser", label: "Browser",          sub: "React 18 · SWR" },

  { id: "web",     lane: "edge",    col: 0, kind: "web",     label: "aidemo-web",       sub: "Next.js 14 · /api/* proxy" },

  { id: "api",     lane: "api",     col: 0, kind: "api",     label: "aidemo-api",       sub: "FastAPI · uvicorn" },

  { id: "sb-f",    lane: "async",   col: 0, kind: "queue",   label: "forecast-jobs",    sub: "Service Bus queue" },
  { id: "sb-r",    lane: "async",   col: 1, kind: "queue",   label: "rl-jobs",          sub: "Service Bus queue" },
  { id: "keda",    lane: "async",   col: 2, kind: "scaler",  label: "KEDA",             sub: "scaler · 0 → N pods" },

  { id: "fw",      lane: "compute", col: 0, kind: "worker",  label: "forecast-worker",  sub: "Chronos-Bolt · torch" },
  { id: "rw",      lane: "compute", col: 1, kind: "worker",  label: "rl-worker",        sub: "PPO · SB3 · gymnasium" },
  { id: "sim",     lane: "compute", col: 2, kind: "worker",  label: "device-simulator", sub: "Weather + room profiles" },

  { id: "pg",      lane: "data",    col: 0, kind: "store",   label: "Postgres",         sub: "telemetry · jobs · results" },
  { id: "blob",    lane: "data",    col: 1, kind: "store",   label: "Blob",             sub: "artifacts/rl/<job>/policy.zip" },
  { id: "acr",     lane: "data",    col: 2, kind: "store",   label: "ACR",              sub: "container images" },

  { id: "prom",    lane: "obs",     col: 0, kind: "obs",     label: "Prometheus",       sub: "kube-prom-stack 65.5" },
  { id: "dcgm",    lane: "obs",     col: 1, kind: "obs",     label: "DCGM exporter",    sub: "GPU metrics" },
  { id: "graf",    lane: "obs",     col: 2, kind: "obs",     label: "Grafana",          sub: "iframe embed" },
];

const EDGES: Edge[] = [
  // happy-path data flow (top → bottom)
  { from: "browser", to: "web",  label: "HTTPS",               kind: "data" },
  { from: "web",     to: "api",  label: "JSON / REST",         kind: "data" },
  { from: "api",     to: "sb-f", label: "POST /jobs/forecast", kind: "data" },
  { from: "api",     to: "sb-r", label: "POST /jobs/rl",       kind: "data" },

  // KEDA (control)
  { from: "sb-f",    to: "keda", kind: "ctrl" },
  { from: "sb-r",    to: "keda", kind: "ctrl" },
  { from: "keda",    to: "fw",   label: "scale 0 → N", kind: "ctrl" },
  { from: "keda",    to: "rw",   label: "scale 0 → N", kind: "ctrl" },

  // workers ↔ data plane
  { from: "fw",      to: "pg",   label: "context · result",  kind: "data" },
  { from: "rw",      to: "pg",   label: "result row",        kind: "data" },
  { from: "rw",      to: "blob", label: "policy.zip",        kind: "data" },
  { from: "sim",     to: "pg",   label: "telemetry insert",  kind: "data" },
  { from: "api",     to: "pg",   label: "read / write",      kind: "data" },
  { from: "acr",     to: "fw",   label: "image pull", kind: "ctrl" },

  // observability (all dashed)
  { from: "fw",      to: "prom", kind: "scrape" },
  { from: "rw",      to: "prom", kind: "scrape" },
  { from: "sim",     to: "prom", kind: "scrape" },
  { from: "dcgm",    to: "prom", kind: "scrape" },
  { from: "prom",    to: "graf", kind: "scrape" },
  { from: "graf",    to: "web",  label: "iframe", kind: "embed" },
];

const KIND_STYLE: Record<NodeKind, { fill: string; stroke: string; text: string }> = {
  browser: { fill: "#0ea5e9", stroke: "#0369a1", text: "#fff" },
  web:     { fill: "#6366f1", stroke: "#3730a3", text: "#fff" },
  api:     { fill: "#22c55e", stroke: "#15803d", text: "#fff" },
  queue:   { fill: "#f59e0b", stroke: "#b45309", text: "#1f2937" },
  scaler:  { fill: "#a855f7", stroke: "#6b21a8", text: "#fff" },
  worker:  { fill: "#ef4444", stroke: "#991b1b", text: "#fff" },
  store:   { fill: "#0d9488", stroke: "#115e59", text: "#fff" },
  obs:     { fill: "#8b5cf6", stroke: "#5b21b6", text: "#fff" },
};

type FilterState = Record<EdgeKind, boolean>;

const FILTER_META: { id: EdgeKind; label: string; color: string; dashed: boolean }[] = [
  { id: "data",   label: "Data flow",         color: "#0ea5e9", dashed: false },
  { id: "ctrl",   label: "Control / scaling", color: "#a855f7", dashed: true  },
  { id: "scrape", label: "Metrics scrape",    color: "#9ca3af", dashed: true  },
  { id: "embed",  label: "Embed (iframe)",    color: "#14b8a6", dashed: true  },
];

export function ArchitectureDiagram() {
  const ref = useRef<SVGSVGElement | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [filters, setFilters] = useState<FilterState>({ data: true, ctrl: true, scrape: true, embed: true });

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
    read();
    const obs = new MutationObserver(read);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!ref.current) return;

    const laneIndex: Record<LaneId, number> = {} as any;
    LANES.forEach((l, i) => (laneIndex[l.id] = i));

    const cols = Math.max(...NODES.map((n) => n.col)) + 1;
    const W = LANE_PAD_LEFT + cols * BOX_W + (cols - 1) * COL_GAP + 40;
    const H = LANE_PAD_TOP + LANES.length * LANE_HEIGHT + 60;

    const positioned = NODES.map((n) => {
      const laneY = LANE_PAD_TOP + laneIndex[n.lane] * LANE_HEIGHT;
      const x = LANE_PAD_LEFT + n.col * (BOX_W + COL_GAP);
      const y = laneY + (LANE_HEIGHT - BOX_H) / 2;
      return { ...n, x, y, w: BOX_W, h: BOX_H };
    });
    const byId = new Map(positioned.map((n) => [n.id, n]));

    const isDark = theme === "dark";
    const labelBg = isDark ? "#0a0a0a" : "#ffffff";
    const subColor = isDark ? "#9ca3af" : "#4b5563";
    const laneFill = isDark ? "#ffffff" : "#000000";

    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    const defs = svg.append("defs");
    const colors = {
      data: "#0ea5e9",
      ctrl: "#a855f7",
      scrape: isDark ? "#6b7280" : "#9ca3af",
      embed: "#14b8a6",
    } as const;
    (Object.keys(colors) as Array<keyof typeof colors>).forEach((k) => {
      defs
        .append("marker")
        .attr("id", `arrow-${k}`)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 9)
        .attr("refY", 0)
        .attr("markerWidth", 7)
        .attr("markerHeight", 7)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", colors[k]);
    });

    // ---- lane rows ----
    const laneG = svg.append("g").attr("class", "lanes");
    LANES.forEach((lane, i) => {
      const y = LANE_PAD_TOP + i * LANE_HEIGHT;
      laneG
        .append("rect")
        .attr("x", 20)
        .attr("y", y)
        .attr("width", W - 40)
        .attr("height", LANE_HEIGHT - 10)
        .attr("rx", 10)
        .attr("fill", laneFill)
        .attr("opacity", i % 2 === 0 ? 0.04 : 0.07);
      laneG
        .append("text")
        .attr("x", 36)
        .attr("y", y + 28)
        .attr("font-size", 13)
        .attr("font-weight", 700)
        .attr("fill", "currentColor")
        .text(lane.label);
      if (lane.sub) {
        laneG
          .append("text")
          .attr("x", 36)
          .attr("y", y + 46)
          .attr("font-size", 11)
          .attr("fill", subColor)
          .text(lane.sub);
      }
      laneG
        .append("line")
        .attr("x1", LANE_PAD_LEFT - 20)
        .attr("x2", LANE_PAD_LEFT - 20)
        .attr("y1", y + 10)
        .attr("y2", y + LANE_HEIGHT - 20)
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.15);
    });

    // ---- edges ----
    const edgeG = svg.append("g").attr("class", "edges");

    function endpoints(a: typeof positioned[number], b: typeof positioned[number]) {
      const sameLane = a.lane === b.lane;
      if (sameLane) {
        if (b.x >= a.x) return { sx: a.x + a.w, sy: a.y + a.h / 2, tx: b.x, ty: b.y + b.h / 2, h: true };
        return                { sx: a.x,        sy: a.y + a.h / 2, tx: b.x + b.w, ty: b.y + b.h / 2, h: true };
      }
      // vertical between lanes — slight horizontal offset per source col so multiple
      // arrows out of the same node don't overlap.
      const sxOffset = (b.col - a.col) * 14;
      const txOffset = (a.col - b.col) * 14;
      if (b.y >= a.y) return { sx: a.x + a.w / 2 + sxOffset, sy: a.y + a.h, tx: b.x + b.w / 2 + txOffset, ty: b.y, h: false };
      return                  { sx: a.x + a.w / 2 + sxOffset, sy: a.y,       tx: b.x + b.w / 2 + txOffset, ty: b.y + b.h, h: false };
    }

    function pathFor(e: Edge): string {
      const a = byId.get(e.from)!;
      const b = byId.get(e.to)!;
      const { sx, sy, tx, ty, h } = endpoints(a, b);
      if (h) {
        const mx = (sx + tx) / 2;
        return `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
      }
      const my = (sy + ty) / 2;
      return `M ${sx} ${sy} C ${sx} ${my}, ${tx} ${my}, ${tx} ${ty}`;
    }

    EDGES.forEach((e) => {
      const k = e.kind ?? "data";
      if (!filters[k]) return;
      const color = colors[k];
      const d = pathFor(e);
      const path = edgeG
        .append("path")
        .attr("d", d)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-opacity", k === "scrape" ? 0.45 : 0.75)
        .attr("stroke-width", k === "scrape" ? 1.2 : 1.6)
        .attr("marker-end", `url(#arrow-${k})`);
      if (k !== "data") path.attr("stroke-dasharray", "5 4");

      if (e.label) {
        const node = path.node() as SVGPathElement;
        const m = node.getPointAtLength(node.getTotalLength() / 2);
        const g = edgeG.append("g").attr("transform", `translate(${m.x},${m.y - 6})`);
        const text = g
          .append("text")
          .attr("text-anchor", "middle")
          .attr("font-size", 10)
          .attr("fill", "currentColor")
          .attr("opacity", 0.9)
          .text(e.label);
        const bb = (text.node() as SVGTextElement).getBBox();
        g.insert("rect", "text")
          .attr("x", bb.x - 4)
          .attr("y", bb.y - 1)
          .attr("width", bb.width + 8)
          .attr("height", bb.height + 2)
          .attr("rx", 3)
          .attr("fill", labelBg)
          .attr("opacity", 0.95)
          .attr("stroke", "currentColor")
          .attr("stroke-opacity", 0.1);
      }

      if (k === "data") {
        const node = path.node() as SVGPathElement;
        const total = node.getTotalLength();
        const token = svg.append("circle").attr("r", 3).attr("fill", "#22d3ee").attr("opacity", 0.95);
        const dur = 2400 + Math.random() * 1600;
        const animate = () => {
          token
            .transition()
            .duration(dur)
            .ease(d3.easeCubicInOut)
            .attrTween("transform", () => (t) => {
              const p = node.getPointAtLength(t * total);
              return `translate(${p.x},${p.y})`;
            })
            .on("end", animate);
        };
        animate();
      }
    });

    // ---- nodes ----
    const nodeG = svg.append("g").attr("class", "nodes");
    const groups = nodeG
      .selectAll("g.node")
      .data(positioned)
      .enter()
      .append("g")
      .attr("class", "node")
      .attr("transform", (d) => `translate(${d.x},${d.y})`);

    groups
      .append("rect")
      .attr("width", (d) => d.w)
      .attr("height", (d) => d.h)
      .attr("rx", 8)
      .attr("fill", (d) => KIND_STYLE[d.kind].fill)
      .attr("stroke", (d) => KIND_STYLE[d.kind].stroke)
      .attr("stroke-width", 1.5);

    groups
      .append("text")
      .attr("x", 14)
      .attr("y", 25)
      .attr("font-size", 13)
      .attr("font-weight", 700)
      .attr("fill", (d) => KIND_STYLE[d.kind].text)
      .text((d) => d.label);

    groups
      .append("text")
      .attr("x", 14)
      .attr("y", 44)
      .attr("font-size", 10.5)
      .attr("fill", (d) => KIND_STYLE[d.kind].text)
      .attr("opacity", 0.85)
      .text((d) => d.sub ?? "");

    // ---- legend ----
    const legend = svg.append("g").attr("transform", `translate(${LANE_PAD_LEFT}, ${H - 28})`);
    FILTER_META.forEach((it, i) => {
      const g = legend.append("g").attr("transform", `translate(${i * 180},0)`);
      g.append("line")
        .attr("x1", 0).attr("x2", 28).attr("y1", 6).attr("y2", 6)
        .attr("stroke", it.color).attr("stroke-width", 2)
        .attr("stroke-opacity", filters[it.id] ? 1 : 0.25)
        .attr("stroke-dasharray", it.dashed ? "5 4" : null);
      g.append("text")
        .attr("x", 36).attr("y", 10)
        .attr("font-size", 11).attr("fill", "currentColor")
        .attr("opacity", filters[it.id] ? 1 : 0.4)
        .text(it.label);
    });
  }, [theme, filters]);

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex flex-wrap gap-2 mb-3">
        {FILTER_META.map((it) => {
          const on = filters[it.id];
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, [it.id]: !f[it.id] }))}
              aria-pressed={on}
              className={
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition " +
                (on
                  ? "border-foreground/30 bg-foreground/5 text-foreground"
                  : "border-foreground/10 bg-transparent text-foreground/40 line-through")
              }
              title={on ? `Hide ${it.label}` : `Show ${it.label}`}
            >
              <span
                className="inline-block h-2 w-4 rounded-sm"
                style={{
                  background: it.dashed
                    ? `repeating-linear-gradient(90deg, ${it.color} 0 4px, transparent 4px 7px)`
                    : it.color,
                  opacity: on ? 1 : 0.35,
                }}
              />
              {it.label}
            </button>
          );
        })}
      </div>
      <svg
        ref={ref}
        className="w-full text-foreground"
        style={{ minWidth: 980, height: "auto" }}
      />
    </div>
  );
}
