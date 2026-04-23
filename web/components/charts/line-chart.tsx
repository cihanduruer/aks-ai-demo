"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

export type Series = {
  key: string;
  label?: string;
  color: string;
  data: number[];
  axis?: "left" | "right";
  dashed?: boolean;
};

export type LineChartProps = {
  series: Series[];
  height?: number;
  xLabels?: string[];
  showLegend?: boolean;
  dualAxis?: boolean;
  className?: string;
};

const margin = { top: 8, right: 40, bottom: 20, left: 44 };

export function LineChart({
  series,
  height = 220,
  xLabels,
  showLegend = false,
  dualAxis = false,
  className,
}: LineChartProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ x: number; i: number } | null>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.floor(e.contentRect.width));
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const maxLen = useMemo(
    () => series.reduce((m, s) => Math.max(m, s.data.length), 0),
    [series]
  );

  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  const x = useMemo(
    () => d3.scaleLinear().domain([0, Math.max(1, maxLen - 1)]).range([0, innerW]),
    [maxLen, innerW]
  );

  const leftSeries = dualAxis ? series.filter((s) => (s.axis ?? "left") === "left") : series;
  const rightSeries = dualAxis ? series.filter((s) => s.axis === "right") : [];

  const yLeft = useMemo(() => {
    const vals = leftSeries.flatMap((s) => s.data).filter((v) => Number.isFinite(v));
    const [lo, hi] = vals.length ? (d3.extent(vals) as [number, number]) : [0, 1];
    const pad = (hi - lo) * 0.08 || 1;
    return d3.scaleLinear().domain([lo - pad, hi + pad]).nice().range([innerH, 0]);
  }, [leftSeries, innerH]);

  const yRight = useMemo(() => {
    if (!dualAxis) return null;
    const vals = rightSeries.flatMap((s) => s.data).filter((v) => Number.isFinite(v));
    const [lo, hi] = vals.length ? (d3.extent(vals) as [number, number]) : [0, 1];
    const pad = (hi - lo) * 0.08 || 1;
    return d3.scaleLinear().domain([lo - pad, hi + pad]).nice().range([innerH, 0]);
  }, [rightSeries, innerH, dualAxis]);

  // Draw axes via d3 imperatively
  useEffect(() => {
    if (!svgRef.current || !width) return;
    const svg = d3.select(svgRef.current);
    const axisColor = "currentColor";

    const gx = svg.select<SVGGElement>("g.axis-x");
    gx.attr("transform", `translate(${margin.left},${margin.top + innerH})`)
      .call(d3.axisBottom(x).ticks(0).tickSize(0))
      .call((g) => g.select(".domain").attr("stroke", axisColor).attr("stroke-opacity", 0.3));

    const gyL = svg.select<SVGGElement>("g.axis-y-left");
    gyL.attr("transform", `translate(${margin.left},${margin.top})`)
      .call(d3.axisLeft(yLeft).ticks(4).tickSize(-innerW))
      .call((g) => g.select(".domain").remove())
      .call((g) =>
        g
          .selectAll(".tick line")
          .attr("stroke", axisColor)
          .attr("stroke-opacity", 0.1)
      )
      .call((g) =>
        g.selectAll(".tick text").attr("fill", axisColor).attr("opacity", 0.6)
      );

    const gyR = svg.select<SVGGElement>("g.axis-y-right");
    if (yRight) {
      gyR
        .attr("transform", `translate(${margin.left + innerW},${margin.top})`)
        .call(d3.axisRight(yRight).ticks(4).tickSize(0))
        .call((g) => g.select(".domain").remove())
        .call((g) =>
          g.selectAll(".tick text").attr("fill", axisColor).attr("opacity", 0.6)
        );
    } else {
      gyR.selectAll("*").remove();
    }
  }, [width, innerH, innerW, x, yLeft, yRight]);

  const lineGen = (s: Series) => {
    const yScale = s.axis === "right" && yRight ? yRight : yLeft;
    const gen = d3
      .line<number>()
      .defined((v) => Number.isFinite(v))
      .x((_, i) => x(i))
      .y((v) => yScale(v))
      .curve(d3.curveMonotoneX);
    return gen(s.data) ?? "";
  };

  const onMove = (ev: React.MouseEvent<SVGRectElement>) => {
    const rect = (ev.target as SVGRectElement).getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const i = Math.round(x.invert(px));
    if (i < 0 || i > maxLen - 1) return setHover(null);
    setHover({ x: x(i), i });
  };

  return (
    <div ref={wrapRef} className={className} style={{ width: "100%", height }}>
      {width > 0 && (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="text-foreground"
          style={{ overflow: "visible" }}
        >
          <g className="axis-y-left" />
          <g className="axis-y-right" />
          <g className="axis-x" />
          <g transform={`translate(${margin.left},${margin.top})`}>
            {series.map((s) => (
              <path
                key={s.key}
                d={lineGen(s)}
                fill="none"
                stroke={s.color}
                strokeWidth={1.75}
                strokeDasharray={s.dashed ? "4 2" : undefined}
              />
            ))}
            {hover && (
              <g>
                <line
                  x1={hover.x}
                  x2={hover.x}
                  y1={0}
                  y2={innerH}
                  stroke="currentColor"
                  strokeOpacity={0.3}
                  strokeDasharray="2 2"
                />
                {series.map((s) => {
                  const v = s.data[hover.i];
                  if (!Number.isFinite(v)) return null;
                  const yScale = s.axis === "right" && yRight ? yRight : yLeft;
                  return (
                    <circle
                      key={s.key}
                      cx={hover.x}
                      cy={yScale(v)}
                      r={3}
                      fill={s.color}
                    />
                  );
                })}
              </g>
            )}
            <rect
              x={0}
              y={0}
              width={innerW}
              height={innerH}
              fill="transparent"
              onMouseMove={onMove}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        </svg>
      )}

      {hover && (
        <div className="pointer-events-none -mt-2 text-xs text-muted-foreground">
          {xLabels?.[hover.i] ? <span className="mr-2">{xLabels[hover.i]}</span> : null}
          {series.map((s) => {
            const v = s.data[hover.i];
            if (!Number.isFinite(v)) return null;
            return (
              <span key={s.key} className="mr-3" style={{ color: s.color }}>
                {(s.label ?? s.key)}: {v.toFixed(2)}
              </span>
            );
          })}
        </div>
      )}

      {showLegend && (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4"
                style={{
                  background: s.color,
                  borderTop: s.dashed ? `2px dashed ${s.color}` : undefined,
                }}
              />
              {s.label ?? s.key}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
