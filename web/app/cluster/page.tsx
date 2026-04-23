"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Cfg = { grafanaUrl: string; prometheusUrl: string };

const fetcher = (u: string) => fetch(u).then((r) => r.json());

function useGrafanaTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
    read();
    const obs = new MutationObserver(read);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

export default function ClusterPage() {
  const { data: cfg } = useSWR<Cfg>("/api/config", fetcher);
  const grafana = cfg?.grafanaUrl?.replace(/\/$/, "") ?? "";
  const theme = useGrafanaTheme();

  if (!cfg) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  if (!grafana) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>GPU & Cluster Overview</CardTitle>
          <CardDescription>Grafana URL not configured.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Set the <code>GRAFANA_URL</code> environment variable on the web
            container to enable embedded dashboards.
          </p>
          <p className="text-muted-foreground">
            Install the monitoring stack with{" "}
            <code>./scripts/install-monitoring.ps1</code>, then re-run{" "}
            <code>./scripts/run-web-local.ps1</code>.
          </p>
        </CardContent>
      </Card>
    );
  }

  const q = `orgId=1&refresh=10s&kiosk&theme=${theme}`;
  const tabs: Array<{ id: string; label: string; src: string }> = [
    {
      id: "gpu",
      label: "GPU (DCGM)",
      src: `${grafana}/d/dcgm-exporter/nvidia-dcgm-exporter?${q}`,
    },
    {
      id: "cluster",
      label: "Cluster",
      src: `${grafana}/d/efa86fd1d0c121a26444b636a3f509a8/kubernetes-compute-resources-cluster?${q}`,
    },
    {
      id: "nodes",
      label: "Nodes",
      src: `${grafana}/d/7d57716318ee0dddbac5a7f451fb7753/node-exporter-nodes?${q}`,
    },
    {
      id: "pods",
      label: "Pods",
      src: `${grafana}/d/85a562078cdf77779eaa1add43ccec1e/kubernetes-compute-resources-namespace-pods?var-namespace=aks-ai-demo&${q}`,
    },
  ];

  return (
    <div className="w-full">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">GPU &amp; Cluster Overview</h1>
          <p className="text-sm text-muted-foreground">
            Live AKS metrics via Prometheus + Grafana.
          </p>
        </div>
        <a
          href={grafana}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          open Grafana ↗
        </a>
      </div>

      <Tabs defaultValue="gpu" className="w-full">
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((t) => (
          <TabsContent key={t.id} value={t.id} className="mt-3">
            <iframe
              key={`${t.id}-${theme}`}
              src={t.src}
              className="block w-full rounded-md border bg-background"
              style={{ height: "calc(100vh - 11rem)" }}
              loading="lazy"
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
