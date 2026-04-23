"""Local smoke tests that don't need Azure."""
import numpy as np
import pytest


def test_hvac_env_runs():
    from rl.env import HvacRoomEnv
    env = HvacRoomEnv(seed=0)
    obs, _ = env.reset()
    assert obs.shape == (5,)
    total = 0.0
    for _ in range(96):
        obs, r, term, trunc, _ = env.step(env.action_space.sample())
        total += r
        if term or trunc:
            break
    assert isinstance(total, float)


def test_metrics_module_imports():
    from common import metrics
    assert metrics.JOB_TOTAL is not None


def test_logging_setup():
    from common.logging_setup import get_logger
    log = get_logger("test")
    log.info("hello", extra={"k": "v"})
