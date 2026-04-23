"""RL training worker.

Message schema (JSON):
{
  "algo": "PPO" | "DQN",
  "total_steps": 50000,
  "learning_rate": 3e-4,
  "seed": 42
}
Stores final mean reward + reward curve, optional policy upload to blob.
"""
from __future__ import annotations

import io
import os
import uuid
from typing import Any

import numpy as np
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient
from stable_baselines3 import DQN, PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.env_util import make_vec_env

from common import db
from common.dispatcher import run
from common.logging_setup import get_logger
from common.metrics import RL_MEAN_REWARD, start_metrics_server
from rl.env import HvacRoomEnv

log = get_logger(__name__)


class RewardCurve(BaseCallback):
    def __init__(self, every: int = 1000):
        super().__init__()
        self.every = every
        self.curve: list[float] = []
        self._buf: list[float] = []

    def _on_step(self) -> bool:
        rewards = self.locals.get("rewards")
        if rewards is not None:
            self._buf.append(float(np.mean(rewards)))
        if self.num_timesteps % self.every == 0 and self._buf:
            self.curve.append(float(np.mean(self._buf)))
            self._buf.clear()
        return True


def _evaluate(model, n_episodes: int = 5) -> float:
    env = HvacRoomEnv(seed=123)
    rewards = []
    for _ in range(n_episodes):
        obs, _ = env.reset()
        done = False
        total = 0.0
        while not done:
            action, _ = model.predict(obs, deterministic=True)
            obs, r, term, trunc, _ = env.step(int(action))
            total += r
            done = term or trunc
        rewards.append(total)
    return float(np.mean(rewards))


def _maybe_upload(job_id: uuid.UUID, model) -> str | None:
    account = os.environ.get("BLOB_ACCOUNT_URL")
    container = os.environ.get("BLOB_CONTAINER", "artifacts")
    if not account:
        return None
    buf = io.BytesIO()
    model.save(buf)
    buf.seek(0)
    cred = DefaultAzureCredential()
    bsc = BlobServiceClient(account_url=account, credential=cred)
    blob_name = f"rl/{job_id}/policy.zip"
    bsc.get_container_client(container).upload_blob(
        name=blob_name, data=buf, overwrite=True,
    )
    return f"{account.rstrip('/')}/{container}/{blob_name}"


def handle(job_id: uuid.UUID, payload: dict[str, Any]) -> None:
    algo = str(payload.get("algo", "PPO")).upper()
    total_steps = int(payload.get("total_steps", 20_000))
    lr = float(payload.get("learning_rate", 3e-4))
    seed = int(payload.get("seed", 42))

    import torch
    n_envs = int(payload.get("n_envs", 8))
    env = make_vec_env(lambda: HvacRoomEnv(seed=seed), n_envs=n_envs, seed=seed)
    cls = {"PPO": PPO, "DQN": DQN}[algo]
    policy = "MlpPolicy"

    require_gpu = os.environ.get("REQUIRE_GPU", "1") == "1"
    if not torch.cuda.is_available():
        if require_gpu:
            raise RuntimeError(
                "CUDA not available — refusing to fall back to CPU. "
                "Set REQUIRE_GPU=0 to allow CPU training."
            )
        device = "cpu"
    else:
        device = "cuda"

    log.info(
        "rl device",
        extra={
            "device": device,
            "cuda": torch.cuda.is_available(),
            "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "n_envs": n_envs,
        },
    )
    model = cls(policy, env, learning_rate=lr, verbose=0, seed=seed, device=device)
    cb = RewardCurve(every=max(500, total_steps // 50))
    model.learn(total_timesteps=total_steps, callback=cb)

    mean_r = _evaluate(model)
    RL_MEAN_REWARD.labels(algo).set(mean_r)
    policy_uri = _maybe_upload(job_id, model)
    db.save_rl(job_id, algo, total_steps, mean_r, cb.curve, policy_uri)
    log.info("rl saved", extra={"job_id": str(job_id), "algo": algo,
                                "mean_reward": mean_r, "policy_uri": policy_uri})


def main() -> None:
    start_metrics_server(int(os.environ.get("METRICS_PORT", "9090")))
    queue = os.environ.get("SERVICEBUS_QUEUE", "rl-jobs")
    run("rl", queue, handle)


if __name__ == "__main__":
    main()
