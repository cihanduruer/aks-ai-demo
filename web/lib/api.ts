"use client";
import useSWR from "swr";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/api";

const fetcher = (url: string) => fetch(`${API_BASE}${url}`).then((r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
});

export function useApi<T = unknown>(path: string | null, refreshMs = 5000) {
  return useSWR<T>(path, fetcher, { refreshInterval: refreshMs });
}

export async function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function patchJson<T = unknown>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
