"""Smart Kanban Bins - load-cell simulator for six bins (T1.2, T2.2, T2.3, T3.1).

Modbus TCP server on 0.0.0.0:5020. Each bin is its own Modbus device (unit ID 1-6,
from config/bins.json) with the same holding-register map (see docs/register_map.md):

  address 0-1 (40001-40002)  gross weight on the load cell in milligrams, uint32, high word first
  address 2   (40003)        status: 0 OK, 1 fault
  address 3-4 (40004-40005)  simulated time in minutes since the first report date, uint32
  address 5   (40006)        replay cycle (0 for the first run, +1 every time it loops)

The stock follows the SALMI series (replay engine in replay.py), with time compressed:
one simulated day lasts SIM_SECONDS_PER_DAY real seconds.

Environment variables (all optional):
  SIM_SECONDS_PER_DAY  real seconds per simulated day (default 10: 131 days = about 22 min)
  SIM_START_DAY        simulated day to start from (default 0)
  SIM_LOOP             1 = start the replay again after the last report date (default 1)
  SIM_SEED             random seed for the replay paths and the noise (default 42)
  SIM_FAULTS           fault overrides, e.g. "bin03.stuck_from_day=30,bin04.hard_fault_from_day=50"
  SIM_CONFIG           path of bins.json (default ../config/bins.json)
  SIM_DATA             folder with the series CSV files (default ../data/series)

Written for pymodbus 3.16.1 (SimData / SimDevice API).
"""

import asyncio
import json
import os
import time
from pathlib import Path

from pymodbus.server import StartAsyncTcpServer
from pymodbus.simulator import DataType, SimData, SimDevice

from replay import BinSensor, load_series

HERE = Path(__file__).resolve().parent
HOST = "0.0.0.0"
PORT = 5020

SECONDS_PER_DAY = float(os.getenv("SIM_SECONDS_PER_DAY", "10"))
START_DAY = float(os.getenv("SIM_START_DAY", "0"))
LOOP = os.getenv("SIM_LOOP", "1") == "1"
SEED = int(os.getenv("SIM_SEED", "42"))
CONFIG = Path(os.getenv("SIM_CONFIG", HERE.parent / "config" / "bins.json"))
DATA = Path(os.getenv("SIM_DATA", HERE.parent / "data" / "series"))
EXTRA_DAY = 1.0     # hold the last value for one simulated day before looping


def parse_fault_overrides(text):
    """'bin03.stuck_from_day=30,bin04.noise_g=1' -> {'bin03': {'stuck_from_day': 30.0}, ...}"""
    out = {}
    for item in filter(None, (s.strip() for s in (text or "").split(","))):
        key, value = item.split("=")
        bin_id, field = key.split(".")
        out.setdefault(bin_id, {})[field] = None if value.lower() == "null" else float(value)
    return out


def load_sensors():
    cfg = json.loads(CONFIG.read_text())
    overrides = parse_fault_overrides(os.getenv("SIM_FAULTS"))
    sensors = {}
    for i, b in enumerate(cfg["bins"]):
        b["faults"].update(overrides.get(b["bin"], {}))
        series = load_series(DATA / f"{b['bin']}_{b['item']}.csv")
        sensors[b["unit_id"]] = BinSensor(b, series, seed=SEED + i)
    return cfg, sensors


class Clock:
    """Real time -> (simulated day, cycle)."""

    def __init__(self, end_day):
        self.t0 = time.monotonic()
        self.length = end_day + EXTRA_DAY

    def now(self):
        day = START_DAY + (time.monotonic() - self.t0) / SECONDS_PER_DAY
        if not LOOP:
            return min(day, self.length), 0
        return day % self.length, int(day // self.length)


def split32(value):
    """uint32 -> [high word, low word]."""
    value = int(value) & 0xFFFFFFFF
    return [(value >> 16) & 0xFFFF, value & 0xFFFF]


def make_action(sensor, clock):
    """Build the function pymodbus calls on every request for this device."""
    async def on_request(function_code, start_address, address, count,
                         current_registers, set_values):
        day, cycle = clock.now()
        mg, status = sensor.read(day)
        current_registers[0:6] = split32(mg) + [status] + split32(day * 1440) + [cycle & 0xFFFF]
        return None
    return on_request


async def log_loop(sensors, clock):
    """Print one line per simulated day so the console shows the replay moving."""
    last_day = -1
    while True:
        day, cycle = clock.now()
        if int(day) != last_day:
            last_day = int(day)
            parts = [f"{s.cfg['bin']}={s.scaled_units(day) * s.cfg['scale_k']}" for s in sensors.values()]
            print(f"cycle {cycle} day {day:6.1f}  " + "  ".join(parts), flush=True)
        await asyncio.sleep(0.5)


async def main():
    cfg, sensors = load_sensors()
    clock = Clock(max(s.end_day for s in sensors.values()))
    devices = [
        SimDevice(
            id=unit_id,
            simdata=[SimData(address=0, count=6, values=0, datatype=DataType.REGISTERS)],
            action=make_action(sensor, clock),
        )
        for unit_id, sensor in sensors.items()
    ]
    asyncio.create_task(log_loop(sensors, clock))
    print(f"Modbus TCP simulator on {HOST}:{PORT}: {len(devices)} bins, unit IDs "
          f"{sorted(sensors)}, {SECONDS_PER_DAY:g} s per simulated day", flush=True)
    await StartAsyncTcpServer(context=devices, address=(HOST, PORT))


if __name__ == "__main__":
    asyncio.run(main())
