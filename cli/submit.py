"""Submit demo jobs to Service Bus.

Usage:
  python -m cli.submit forecast --count 5
  python -m cli.submit rl --count 5 --algo PPO --steps 30000
  python -m cli.submit both --count 5
"""
from __future__ import annotations

import argparse
import json
import os
import random
import uuid

from azure.identity import DefaultAzureCredential
from azure.servicebus import ServiceBusClient, ServiceBusMessage


def _client() -> ServiceBusClient:
    fqdn = os.environ["SERVICEBUS_FQDN"]
    return ServiceBusClient(fqdn, DefaultAzureCredential())


def _send(queue: str, payloads: list[dict]) -> None:
    with _client() as sb, sb.get_queue_sender(queue) as sender:
        msgs = [ServiceBusMessage(json.dumps(p), message_id=str(uuid.uuid4())) for p in payloads]
        sender.send_messages(msgs)
        print(f"sent {len(msgs)} messages to {queue}")


def _forecast_payloads(n: int) -> list[dict]:
    datasets = ["synthetic-sin", "synthetic-trend", "synthetic-noise"]
    return [
        {"dataset": random.choice(datasets), "horizon": random.choice([12, 24, 48]),
         "num_samples": 20}
        for _ in range(n)
    ]


def _rl_payloads(n: int, algo: str, steps: int) -> list[dict]:
    return [
        {"algo": algo, "total_steps": steps,
         "learning_rate": 3e-4, "seed": random.randint(1, 9999)}
        for _ in range(n)
    ]


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("kind", choices=["forecast", "rl", "both"])
    p.add_argument("--count", type=int, default=5)
    p.add_argument("--algo", default="PPO", choices=["PPO", "DQN"])
    p.add_argument("--steps", type=int, default=20_000)
    p.add_argument("--forecast-queue", default=os.environ.get("FORECAST_QUEUE", "forecast-jobs"))
    p.add_argument("--rl-queue", default=os.environ.get("RL_QUEUE", "rl-jobs"))
    args = p.parse_args()

    if args.kind in ("forecast", "both"):
        _send(args.forecast_queue, _forecast_payloads(args.count))
    if args.kind in ("rl", "both"):
        _send(args.rl_queue, _rl_payloads(args.count, args.algo, args.steps))


if __name__ == "__main__":
    main()
