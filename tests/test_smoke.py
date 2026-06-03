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


# ---------------------------------------------------------------------------
# API model validation
# ---------------------------------------------------------------------------

def test_rl_req_valid():
    from api.main import RlReq
    req = RlReq(algo="PPO", total_steps=20000, learning_rate=3e-4)
    assert req.algo == "PPO"


def test_rl_req_invalid_algo():
    from pydantic import ValidationError
    from api.main import RlReq
    with pytest.raises(ValidationError):
        RlReq(algo="A2C")


def test_rl_req_total_steps_too_low():
    from pydantic import ValidationError
    from api.main import RlReq
    with pytest.raises(ValidationError):
        RlReq(total_steps=0)
    with pytest.raises(ValidationError):
        RlReq(total_steps=999)


def test_rl_req_learning_rate_out_of_range():
    from pydantic import ValidationError
    from api.main import RlReq
    with pytest.raises(ValidationError):
        RlReq(learning_rate=2.0)
    with pytest.raises(ValidationError):
        RlReq(learning_rate=0.0)


def test_forecast_req_horizon_bounds():
    from pydantic import ValidationError
    from api.main import ForecastReq
    with pytest.raises(ValidationError):
        ForecastReq(device_id="dev-001", horizon=0)
    with pytest.raises(ValidationError):
        ForecastReq(device_id="dev-001", horizon=200)


def test_forecast_req_num_samples_bounds():
    from pydantic import ValidationError
    from api.main import ForecastReq
    with pytest.raises(ValidationError):
        ForecastReq(device_id="dev-001", num_samples=0)
    with pytest.raises(ValidationError):
        ForecastReq(device_id="dev-001", num_samples=101)


def test_forecast_req_defaults():
    from api.main import ForecastReq
    req = ForecastReq(device_id="dev-001")
    assert req.horizon == 24
    assert req.num_samples == 20
