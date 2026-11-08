"""Tests for the replay engine (T2.2) and the sensor faults (T3.1).

Run from the repository root:  python -m pytest simulator/tests
"""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "simulator"))

from replay import BinSensor, build_path, load_series, stock_at  # noqa: E402

CFG = json.loads((ROOT / "config" / "bins.json").read_text())
BINS = CFG["bins"]


def series_of(b):
    return load_series(ROOT / "data" / "series" / f"{b['bin']}_{b['item']}.csv")


@pytest.mark.parametrize("b", BINS, ids=[b["bin"] for b in BINS])
@pytest.mark.parametrize("seed", [0, 1, 42])
def test_replay_equals_salmi_on_every_report_date(b, seed):
    series = series_of(b)
    path = build_path(series, seed=seed)
    for day, units in series:
        assert stock_at(path, day) == units, f"{b['bin']} day {day}"


@pytest.mark.parametrize("b", BINS, ids=[b["bin"] for b in BINS])
def test_stock_only_drops_between_reports(b):
    series = series_of(b)
    times, stock = build_path(series, seed=3)
    report_days = {d for d, _ in series}
    for i in range(1, len(stock)):
        if stock[i] > stock[i - 1]:
            assert times[i] in report_days, "rises only happen on report dates (receipts)"


def test_sensor_weight_without_faults():
    b = dict(BINS[0], faults={"noise_g": 0, "drift_g_per_day": 0,
                              "stuck_from_day": None, "hard_fault_from_day": None})
    s = BinSensor(b, series_of(b))
    mg, status = s.read(0)
    assert status == 0
    expected_units = round(series_of(b)[0][1] / b["scale_k"])
    assert mg == round((b["tare_g"] + expected_units * b["unit_g"]) * 1000)
    # the edge formula gives back the units exactly
    assert int((mg - b["tare_g"] * 1000) // round(b["unit_g"] * 1000)) == expected_units


def test_faults():
    b = dict(BINS[2], faults={"noise_g": 0, "drift_g_per_day": 5,
                              "stuck_from_day": 40, "hard_fault_from_day": 60})
    s = BinSensor(b, series_of(b))
    assert s.read(10)[0] == s.true_mg(10) + 50_000            # drift 5 g/day * 10 days
    frozen = s.read(40)[0]
    assert s.read(55)[0] == frozen and s.read(55)[1] == 0     # stuck: same value, status OK
    assert s.read(60)[1] == 1                                 # hard fault: status 1


def test_noise_changes_reading():
    b = dict(BINS[0], faults={"noise_g": 0.2, "drift_g_per_day": 0,
                              "stuck_from_day": None, "hard_fault_from_day": None})
    s = BinSensor(b, series_of(b))
    readings = {s.read(5)[0] for _ in range(20)}
    assert len(readings) > 1
