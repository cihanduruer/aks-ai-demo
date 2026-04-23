"""Chronos-2 forecasting worker.

Message schema (JSON):
{
  "dataset": "synthetic-sin",         # name; "synthetic-*" is generated locally
  "context": [..floats..],            # optional explicit context series
  "horizon": 24,                      # forecast horizon
  "num_samples": 20                   # ignored for Chronos-2 (quantile model)
}
"""
from __future__ import annotations

import os
import uuid
from typing import Any

import numpy as np
import torch

from common import db
from common.dispatcher import run
from common.logging_setup import get_logger
from common.metrics import FORECAST_MAPE, start_metrics_server

log = get_logger(__name__)

_PIPE = None
_PIPE_KIND: str = ""  # "chronos2" | "bolt"


def _load_pipeline():
    """Lazy-load Chronos-2 pipeline. Falls back to Chronos-Bolt if unavailable."""
    global _PIPE, _PIPE_KIND
    if _PIPE is not None:
        return _PIPE

    model_id = os.environ.get("CHRONOS_MODEL", "amazon/chronos-2")
    require_gpu = os.environ.get("REQUIRE_GPU", "1") == "1"
    if not torch.cuda.is_available():
        if require_gpu:
            raise RuntimeError(
                "CUDA not available — refusing to load Chronos on CPU. "
                "Set REQUIRE_GPU=0 to allow CPU inference."
            )
        device = "cpu"
    else:
        device = "cuda"
    dtype = torch.bfloat16 if device == "cuda" else torch.float32
    log.info(
        "loading chronos",
        extra={
            "model": model_id,
            "device": device,
            "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        },
    )

    # Try Chronos-2 first (encoder-only, supports cuda via device_map).
    try:
        from chronos import Chronos2Pipeline  # type: ignore

        _PIPE = Chronos2Pipeline.from_pretrained(model_id, device_map=device, torch_dtype=dtype)
        _PIPE_KIND = "chronos2"
        log.info("loaded chronos-2", extra={"model": model_id})
        return _PIPE
    except Exception:
        log.exception("Chronos-2 unavailable, falling back to chronos-bolt-small")

    from chronos import BaseChronosPipeline  # type: ignore

    _PIPE = BaseChronosPipeline.from_pretrained(
        "amazon/chronos-bolt-small", device_map=device, torch_dtype=dtype,
    )
    _PIPE_KIND = "bolt"
    return _PIPE


def _synthetic_series(name: str, n: int = 256) -> list[float]:
    rng = np.random.default_rng(abs(hash(name)) % (2**32))
    t = np.arange(n)
    if "sin" in name:
        return (10 + 5 * np.sin(t / 12.0) + rng.normal(0, 0.5, n)).tolist()
    if "trend" in name:
        return (0.05 * t + rng.normal(0, 1, n)).tolist()
    return (rng.normal(20, 2, n)).tolist()


def _mape(actual: list[float], predicted: list[float]) -> float | None:
    pairs = [(a, p) for a, p in zip(actual, predicted) if a != 0]
    if not pairs:
        return None
    return float(np.mean([abs((a - p) / a) for a, p in pairs]) * 100)


def _predict(pipe, ctx_t: torch.Tensor, horizon: int) -> list[float]:
    """Return the median forecast as a plain Python list, regardless of pipeline kind."""
    if _PIPE_KIND == "chronos2":
        # Chronos2Pipeline.predict_quantiles returns
        # (list[Tensor (n_variates, horizon, n_quantiles)], list[Tensor (n_variates, horizon)])
        quantiles, _mean = pipe.predict_quantiles(
            inputs=[ctx_t],
            prediction_length=horizon,
            quantile_levels=[0.1, 0.5, 0.9],
        )
        # univariate -> n_variates dim is 1
        return quantiles[0][0, :, 1].cpu().numpy().tolist()

    # chronos-bolt fallback
    quantiles, _mean = pipe.predict_quantiles(
        context=ctx_t,
        prediction_length=horizon,
        quantile_levels=[0.1, 0.5, 0.9],
    )
    return quantiles[0, :, 1].cpu().numpy().tolist()


def handle(job_id: uuid.UUID, payload: dict[str, Any]) -> None:
    dataset = str(payload.get("dataset", "synthetic-sin"))
    horizon = int(payload.get("horizon", 24))

    context = payload.get("context")
    if not context:
        full = _synthetic_series(dataset, n=256 + horizon)
        context, holdout = full[:-horizon], full[-horizon:]
    else:
        holdout = payload.get("holdout") or []

    pipe = _load_pipeline()
    ctx_t = torch.tensor(context, dtype=torch.float32)
    median = _predict(pipe, ctx_t, horizon)

    mape = _mape(holdout, median) if holdout else None
    if mape is not None:
        FORECAST_MAPE.labels(dataset).set(mape)
    db.save_forecast(job_id, dataset, horizon, median, mape)
    log.info(
        "forecast saved",
        extra={"job_id": str(job_id), "mape": mape, "dataset": dataset, "model": _PIPE_KIND},
    )


def main() -> None:
    start_metrics_server(int(os.environ.get("METRICS_PORT", "9090")))
    queue = os.environ.get("SERVICEBUS_QUEUE", "forecast-jobs")
    run("forecast", queue, handle)


if __name__ == "__main__":
    main()
