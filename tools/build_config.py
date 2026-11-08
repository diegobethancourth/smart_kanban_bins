"""Build config/bins.json from config/bins.yaml (T2.1).

config/bins.yaml is the source of truth that people edit. This script adds the
computed values (daily demand, sigma, safety stock, ROP, scale, capacity) and
writes config/bins.json, which the simulator (Python) and Node-RED (JavaScript)
read without needing a YAML library.

Usage:
    python tools/build_config.py          # write config/bins.json
    python tools/build_config.py --check  # only check that bins.json is up to date
"""

import argparse
import csv
import json
import math
import sys
from datetime import date, timedelta
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
YAML_PATH = ROOT / "config" / "bins.yaml"
JSON_PATH = ROOT / "config" / "bins.json"
SERIES_DIR = ROOT / "data" / "series"

MAX_NET_G = 15000          # one bin must not carry more than 15 kg of product
SCALE_STEPS = [1, 2, 5, 10, 20, 50, 100]


def read_series(bin_cfg):
    """Return [(date, stock_units, flagged)] for one bin."""
    path = SERIES_DIR / f"{bin_cfg['bin']}_{bin_cfg['item']}.csv"
    rows = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            rows.append((date.fromisoformat(r["date"]), int(r["stock_units"]),
                         int(r["flagged_point_removed"])))
    return rows


def demand_from_series(rows, window_days=90):
    """Stock drops over the last `window_days`, per 30-day month (CSS method)."""
    last = rows[-1][0]
    start = last - timedelta(days=window_days)
    drops = sum(max(0, rows[i - 1][1] - rows[i][1])
                for i in range(1, len(rows)) if rows[i][0] > start)
    return drops / (window_days / 30)


def build(cfg):
    p = cfg["p240"]
    bins_out = []
    for b in cfg["bins"]:
        rows = read_series(b)
        max_stock = max(s for _, s, _ in rows)

        # Scale model: smallest k that keeps the full bin at or under 15 kg
        k = next(s for s in SCALE_STEPS if max_stock * b["unit_g"] / s <= MAX_NET_G)
        if k != b["scale_k"]:
            print(f"WARNING {b['bin']}: scale_k in YAML is {b['scale_k']}, computed {k}")

        d_day = b["d_month"] / 30
        # Daily sigma from the weekly CV: weekly sd = cv * 7 * d, daily sd = weekly sd / sqrt(7)
        sigma_d = b["cv_weekly"] * d_day * math.sqrt(7)
        z = p["z_vital"] if b["vital"] else p["z_other"]
        ss = z * sigma_d * math.sqrt(p["L_days"])
        rop = d_day * p["L_days"] + ss

        csv_d_month = demand_from_series(rows)
        if abs(csv_d_month - b["d_month"]) > 0.5:
            print(f"NOTE {b['bin']}: d_month {b['d_month']} (CSS method, raw data) "
                  f"vs {csv_d_month:.1f} recomputed from the cleaned CSV")

        out = {k_: v for k_, v in b.items() if k_ not in ("src",)}
        out.update({
            "scale_k": k,
            "capacity_scaled": math.ceil(1.2 * max_stock / k),
            "max_stock": max_stock,
            "d_day": round(d_day, 2),
            "sigma_d": round(sigma_d, 2),
            "z": z,
            "L_days": p["L_days"],
            "SS": round(ss, 1),
            "ROP": round(rop, 1),
            "ROP_scaled": round(rop / k, 1),
            "flagged": sum(f for _, _, f in rows),
            "src": b["src"],
        })
        bins_out.append(out)

    return {
        "_generated": "by tools/build_config.py from config/bins.yaml - do not edit by hand",
        "ue": cfg["ue"],
        "gw_id": cfg["gw_id"],
        "first_date": cfg["series"]["first_date"],
        "last_date": cfg["series"]["last_date"],
        "report_dates": cfg["series"]["report_dates"],
        "p240": p,
        "edge": cfg["edge"],
        "bins": bins_out,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="fail if bins.json is out of date")
    args = ap.parse_args()

    cfg = yaml.safe_load(YAML_PATH.read_text())
    text = json.dumps(build(cfg), indent=2, ensure_ascii=False) + "\n"

    if args.check:
        if JSON_PATH.read_text() != text:
            sys.exit("config/bins.json is out of date: run python tools/build_config.py")
        print("config/bins.json is up to date")
        return
    JSON_PATH.write_text(text)
    print(f"wrote {JSON_PATH.relative_to(ROOT)} ({len(cfg['bins'])} bins)")


if __name__ == "__main__":
    main()
