"""Prometheus metrics exposed on :9090/metrics."""
from prometheus_client import Counter, Gauge, Histogram, start_http_server

JOB_DURATION = Histogram(
    "aidemo_job_duration_seconds",
    "Wall-clock duration of a job",
    ["job_type"],
    buckets=(1, 5, 15, 30, 60, 120, 300, 600, 1200, 3600),
)
JOB_TOTAL = Counter(
    "aidemo_job_total",
    "Total jobs processed",
    ["job_type", "status"],
)
JOB_INFLIGHT = Gauge(
    "aidemo_job_inflight",
    "Currently running jobs in this pod",
    ["job_type"],
)
FORECAST_MAPE = Gauge(
    "aidemo_forecast_mape",
    "Last MAPE produced by a forecast job",
    ["dataset"],
)
RL_MEAN_REWARD = Gauge(
    "aidemo_rl_mean_reward",
    "Last mean reward produced by an RL job",
    ["algo"],
)


def start_metrics_server(port: int = 9090) -> None:
    start_http_server(port)
