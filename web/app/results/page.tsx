"use client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart } from "@/components/charts/line-chart";
import { useApi } from "@/lib/api";

type Forecast = { job_id: string; dataset: string; horizon: number; mape: number | null; forecast: number[]; created_at: string };
type RL = { job_id: string; algo: string; total_steps: number; mean_reward: number; reward_curve: number[]; policy_uri: string | null; created_at: string };

export default function ResultsPage() {
  const fc = useApi<Forecast[]>("/results/forecast?limit=20", 5000);
  const rl = useApi<RL[]>("/results/rl?limit=20", 5000);

  return (
    <Tabs defaultValue="forecast" className="space-y-4">
      <TabsList>
        <TabsTrigger value="forecast">Forecast</TabsTrigger>
        <TabsTrigger value="rl">Reinforcement Learning</TabsTrigger>
      </TabsList>

      <TabsContent value="forecast" className="flex flex-col gap-3">
        {(fc.data ?? []).map((r) => (
          <Card key={r.job_id}>
            <CardHeader>
              <CardTitle className="text-base">{r.dataset}</CardTitle>
              <CardDescription>
                horizon {r.horizon} · MAPE {r.mape == null ? "n/a" : `${Number(r.mape).toFixed(2)}%`} ·{" "}
                {new Date(r.created_at).toLocaleString()}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LineChart
                height={176}
                series={[{ key: "v", label: "forecast", color: "#3b82f6", data: r.forecast }]}
              />
            </CardContent>
          </Card>
        ))}
      </TabsContent>

      <TabsContent value="rl" className="flex flex-col gap-3">
        {(rl.data ?? []).map((r) => (
          <Card key={r.job_id}>
            <CardHeader>
              <CardTitle className="text-base">{r.algo} · {r.total_steps.toLocaleString()} steps</CardTitle>
              <CardDescription>
                mean reward {Number(r.mean_reward).toFixed(2)} · {new Date(r.created_at).toLocaleString()}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LineChart
                height={176}
                series={[{ key: "v", label: "reward", color: "#10b981", data: r.reward_curve ?? [] }]}
              />
            </CardContent>
          </Card>
        ))}
      </TabsContent>
    </Tabs>
  );
}
