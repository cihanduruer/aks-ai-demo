"""Tiny gym env: a single-room AC controller.

State (Box, 5):
  occupant_count, outdoor_temp_c, outdoor_humidity, indoor_temp_c, setpoint_c
Action (Discrete, 5):
  0 idle, 1 cool-low, 2 cool-high, 3 heat-low, 4 heat-high
Reward = -|indoor - setpoint| - energy_cost - occupant_discomfort_penalty
"""
from __future__ import annotations

import math
import numpy as np
import gymnasium as gym
from gymnasium import spaces


class HvacRoomEnv(gym.Env):
    metadata = {"render_modes": []}

    ACTION_DELTA = {
        0: (0.0, 0.0),    # idle
        1: (-0.4, 0.05),  # cool-low
        2: (-0.9, 0.15),  # cool-high
        3: (0.4, 0.05),   # heat-low
        4: (0.9, 0.15),   # heat-high
    }

    def __init__(self, episode_steps: int = 96, seed: int | None = None):
        super().__init__()
        self.episode_steps = episode_steps
        self.action_space = spaces.Discrete(5)
        self.observation_space = spaces.Box(
            low=np.array([0.0, -10.0, 0.0, 5.0, 18.0], dtype=np.float32),
            high=np.array([20.0, 45.0, 1.0, 40.0, 26.0], dtype=np.float32),
        )
        self._rng = np.random.default_rng(seed)
        self._step = 0
        self._state = np.zeros(5, dtype=np.float32)

    def reset(self, *, seed: int | None = None, options=None):
        super().reset(seed=seed)
        if seed is not None:
            self._rng = np.random.default_rng(seed)
        self._step = 0
        self._state = np.array([
            float(self._rng.integers(0, 6)),
            float(self._rng.uniform(5.0, 35.0)),
            float(self._rng.uniform(0.2, 0.9)),
            float(self._rng.uniform(18.0, 28.0)),
            float(self._rng.uniform(20.0, 24.0)),
        ], dtype=np.float32)
        return self._state.copy(), {}

    def step(self, action: int):
        occ, out_t, out_h, in_t, sp = self._state
        d_indoor, energy = self.ACTION_DELTA[int(action)]

        # Outdoor pull toward indoor (insulation)
        in_t += 0.05 * (out_t - in_t)
        # Occupants warm the room
        in_t += 0.03 * occ
        # AC effect
        in_t += d_indoor

        # Drift outdoor weather slightly
        out_t += float(self._rng.normal(0, 0.3))
        out_h = float(np.clip(out_h + self._rng.normal(0, 0.02), 0.0, 1.0))
        if self._rng.random() < 0.05:
            occ = float(np.clip(occ + self._rng.choice([-1, 1]), 0, 20))

        comfort = -abs(in_t - sp)
        occupant_penalty = -0.3 * occ * max(0.0, abs(in_t - sp) - 1.0)
        reward = float(comfort - energy + occupant_penalty)

        self._state = np.array([occ, out_t, out_h, in_t, sp], dtype=np.float32)
        self._step += 1
        terminated = False
        truncated = self._step >= self.episode_steps
        return self._state.copy(), reward, terminated, truncated, {}
