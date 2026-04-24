"""Virtual HVAC device fleet simulator.

Continuously generates telemetry for N rooms and writes to Postgres so that
the forecast and RL workloads have realistic data.
"""
from __future__ import annotations

import math
import os
import random
import time
from dataclasses import dataclass, field

import numpy as np

from common import db
from common.logging_setup import get_logger
from common.metrics import start_metrics_server
from prometheus_client import Counter, Gauge

log = get_logger(__name__)

DEVICE_INDOOR = Gauge("aidemo_device_indoor_temp_c", "Indoor temperature", ["device_id"])
DEVICE_OUTDOOR = Gauge("aidemo_device_outdoor_temp_c", "Outdoor temperature", ["device_id"])
DEVICE_OCC = Gauge("aidemo_device_occupants", "Occupants", ["device_id"])
DEVICE_ENERGY = Gauge("aidemo_device_energy_w", "Instant energy draw", ["device_id"])
TELEMETRY_TOTAL = Counter("aidemo_device_telemetry_total", "Telemetry rows written", ["device_id"])

ROOMS = ["lobby", "office-1", "office-2", "lab", "server-room", "meeting"]

# Room-specific behaviour: typical capacity, base occupancy multiplier, idle baseline (W).
ROOM_PROFILES: dict[str, dict[str, float]] = {
    "lobby":       {"cap": 8,  "occ_scale": 0.4, "base_w": 80.0},
    "office-1":    {"cap": 6,  "occ_scale": 1.0, "base_w": 70.0},
    "office-2":    {"cap": 6,  "occ_scale": 1.0, "base_w": 70.0},
    "lab":         {"cap": 5,  "occ_scale": 0.6, "base_w": 250.0},
    "server-room": {"cap": 1,  "occ_scale": 0.05, "base_w": 1800.0},  # always hot, near-empty
    "meeting":     {"cap": 10, "occ_scale": 0.5, "base_w": 60.0},
}

# Outdoor weather is shared per simulator process so all rooms see the same sky.
@dataclass
class Weather:
    seasonal_mean_c: float = 14.0   # spring/autumn-ish
    daily_amplitude_c: float = 7.0  # peak-to-trough/2
    noise_c: float = 0.0            # slow drift accumulator
    humidity_base: float = 0.55

    def sample(self, t: float) -> tuple[float, float]:
        # Daily cycle: warmest ~15:00, coldest ~03:00.
        hour = (t % 86400) / 3600.0
        diurnal = self.daily_amplitude_c * math.sin((hour - 9.0) / 24.0 * 2.0 * math.pi)
        # Slow noise (Ornstein-Uhlenbeck style, mean-reverting).
        self.noise_c += float(np.random.normal(0.0, 0.05)) - 0.02 * self.noise_c
        self.noise_c = float(np.clip(self.noise_c, -4.0, 4.0))
        outdoor = self.seasonal_mean_c + diurnal + self.noise_c
        # Humidity higher when cooler, lower when hot; clamp 25–85%.
        rh = self.humidity_base - 0.012 * (outdoor - self.seasonal_mean_c)
        rh += float(np.random.normal(0.0, 0.01))
        rh = float(np.clip(rh, 0.25, 0.85))
        return float(outdoor), rh


@dataclass
class Device:
    id: str
    name: str
    room: str
    setpoint_c: float
    indoor_c: float
    outdoor_c: float
    humidity: float
    occupants: int
    # Smoothed/internal state.
    energy_w: float = 50.0
    action: str = "idle"
    occ_target: float = 0.0
    rng: random.Random = field(default_factory=random.Random)

    def _occupancy_target(self, t: float) -> float:
        """Time-of-day driven occupancy expectation."""
        prof = ROOM_PROFILES[self.room]
        cap = prof["cap"]
        scale = prof["occ_scale"]
        # Local hour (UTC for simplicity); week vs weekend.
        tm = time.gmtime(t)
        hour = tm.tm_hour + tm.tm_min / 60.0
        weekend = tm.tm_wday >= 5
        # Bell around 10:00 and 14:00 for offices/lab/meeting; lobby flatter.
        if self.room == "server-room":
            base = 0.05 + 0.05 * math.exp(-((hour - 11.0) ** 2) / 8.0)
        elif self.room == "lobby":
            base = 0.15 + 0.6 * math.exp(-((hour - 12.0) ** 2) / 30.0)
        else:
            morning = math.exp(-((hour - 10.0) ** 2) / 4.0)
            afternoon = math.exp(-((hour - 14.5) ** 2) / 5.0)
            base = 0.85 * max(morning, afternoon)
        if weekend:
            base *= 0.2
        return cap * scale * base

    def step(self, dt_min: float, t: float, outdoor_c: float, humidity: float) -> tuple[str, float]:
        self.outdoor_c = outdoor_c
        self.humidity = humidity

        # Occupancy: smooth target + Poisson-ish jitter.
        self.occ_target = self._occupancy_target(t)
        # Move integer count toward target with small probability per minute.
        drift = self.occ_target - self.occupants
        if self.rng.random() < min(0.6, 0.15 * dt_min + 0.2 * abs(drift)):
            step = 1 if drift > 0 else -1 if drift < 0 else 0
            self.occupants = int(np.clip(self.occupants + step, 0, int(ROOM_PROFILES[self.room]["cap"])))

        # AC control: hysteresis around setpoint so action doesn't flip every tick.
        diff = self.indoor_c - self.setpoint_c
        if self.action == "cool":
            if diff < 0.2:
                self.action = "idle"
        elif self.action == "heat":
            if diff > -0.2:
                self.action = "idle"
        else:  # idle
            if diff > 0.6:
                self.action = "cool"
            elif diff < -0.6:
                self.action = "heat"

        # Energy targets (W) — server room always draws baseline + AC for thermal load.
        base_w = ROOM_PROFILES[self.room]["base_w"]
        if self.action == "cool":
            target_w = base_w + 700.0 + 60.0 * max(0.0, self.outdoor_c - 22.0)
        elif self.action == "heat":
            target_w = base_w + 900.0 + 80.0 * max(0.0, 18.0 - self.outdoor_c)
        else:
            target_w = base_w + 30.0 * self.occupants
        # Smooth ramp + small noise.
        alpha = min(1.0, 0.4 * dt_min)
        self.energy_w += alpha * (target_w - self.energy_w)
        self.energy_w += float(np.random.normal(0.0, 8.0))
        self.energy_w = float(max(20.0, self.energy_w))

        # Indoor thermal model (slow first-order):
        # outdoor coupling, occupants heat (~80W ≈ 0.05 °C/min in a small room),
        # AC effect proportional to elapsed time.
        d_outdoor = 0.015 * (self.outdoor_c - self.indoor_c)
        d_occ = 0.012 * self.occupants
        if self.action == "cool":
            d_ac = -0.18
        elif self.action == "heat":
            d_ac = 0.20
        else:
            d_ac = 0.0
        # Server room runs hot from gear regardless of AC.
        d_gear = 0.06 if self.room == "server-room" else 0.0
        self.indoor_c += (d_outdoor + d_occ + d_ac + d_gear) * dt_min
        self.indoor_c += float(np.random.normal(0.0, 0.02))
        self.indoor_c = float(np.clip(self.indoor_c, 5.0, 40.0))

        return self.action, self.energy_w


def _make_fleet(n: int) -> list[Device]:
    rng = random.Random(42)
    weather = Weather()
    # Seed initial outdoor with current weather sample so devices start coherent.
    outdoor0, rh0 = weather.sample(time.time())
    fleet = []
    for i in range(n):
        room = ROOMS[i % len(ROOMS)]
        sp = 22.0 if room != "server-room" else 20.0
        sp = rng.choice([sp - 1.0, sp, sp + 1.0])
        fleet.append(Device(
            id=f"dev-{i:03d}",
            name=f"HVAC-{i:03d}",
            room=room,
            setpoint_c=sp,
            indoor_c=sp + rng.uniform(-1.0, 1.0),
            outdoor_c=outdoor0,
            humidity=rh0,
            occupants=0,
            rng=random.Random(1000 + i),
        ))
    return fleet


def main() -> None:
    start_metrics_server(int(os.environ.get("METRICS_PORT", "9090")))
    db.ensure_schema()
    n = int(os.environ.get("DEVICE_COUNT", "8"))
    interval = float(os.environ.get("TICK_SECONDS", "5"))
    # SIM_SPEED multiplies wall-clock dt so charts fill faster (default 1 = realtime).
    sim_speed = float(os.environ.get("SIM_SPEED", "1"))
    fleet = _make_fleet(n)
    weather = Weather()
    for d in fleet:
        db.upsert_device(d.id, d.name, d.room, d.setpoint_c)
    log.info("simulator started", extra={"devices": n, "tick_s": interval, "sim_speed": sim_speed})

    last = time.time()
    sim_t = time.time()
    setpoint_refresh_every = 1  # ticks (~5s) — pick up UI changes fast
    tick = 0
    while True:
        now = time.time()
        dt_real = max(0.001, now - last)
        last = now
        sim_t += dt_real * sim_speed
        dt_min = (dt_real * sim_speed) / 60.0
        outdoor_c, humidity = weather.sample(sim_t)
        if tick % setpoint_refresh_every == 0:
            try:
                latest_sp = db.fetch_setpoints()
                for d in fleet:
                    new_sp = latest_sp.get(d.id)
                    if new_sp is not None and abs(new_sp - d.setpoint_c) > 1e-6:
                        d.setpoint_c = new_sp
            except Exception as exc:  # pragma: no cover - defensive
                log.warning("setpoint refresh failed", extra={"err": str(exc)})
        tick += 1
        for d in fleet:
            action, energy = d.step(dt_min, sim_t, outdoor_c, humidity)
            db.insert_telemetry(
                d.id, d.occupants, d.outdoor_c, d.humidity, d.indoor_c,
                d.setpoint_c, energy, action,
            )
            DEVICE_INDOOR.labels(d.id).set(d.indoor_c)
            DEVICE_OUTDOOR.labels(d.id).set(d.outdoor_c)
            DEVICE_OCC.labels(d.id).set(d.occupants)
            DEVICE_ENERGY.labels(d.id).set(energy)
            TELEMETRY_TOTAL.labels(d.id).inc()
        time.sleep(interval)


if __name__ == "__main__":
    main()

