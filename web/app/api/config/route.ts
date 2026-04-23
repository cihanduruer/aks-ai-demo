import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    grafanaUrl: process.env.GRAFANA_URL ?? "",
    prometheusUrl: process.env.PROMETHEUS_URL ?? "",
  });
}
