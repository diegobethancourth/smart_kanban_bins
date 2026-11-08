"""Check config/bins.yaml (T2.1): fail if any field is empty or has no source.

Usage:  python tools/check_config.py
"""

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = ["bin", "unit_id", "item", "name", "vital", "unit_g", "units_per_box",
            "tare_g", "scale_k", "d_month", "cv_weekly", "deadband_units", "faults"]
SOURCES = {"salmi_series", "css_method", "item_dict", "shortlist", "p240",
           "computed", "sim_param"}
FAULT_KEYS = ["noise_g", "drift_g_per_day", "stuck_from_day", "hard_fault_from_day"]


def check(cfg):
    errors = []
    unit_ids = set()
    for b in cfg.get("bins", []):
        name = b.get("bin", "?")
        for key in REQUIRED:
            if key not in b or b[key] is None or b[key] == "":
                errors.append(f"{name}: '{key}' is empty")
            elif key not in ("bin", "unit_id") and key not in b.get("src", {}):
                errors.append(f"{name}: '{key}' has no source in src")
        for key, src in b.get("src", {}).items():
            if src not in SOURCES:
                errors.append(f"{name}: unknown source '{src}' for '{key}'")
        for key in FAULT_KEYS:
            if key not in b.get("faults", {}):
                errors.append(f"{name}: faults.{key} missing (use null to switch it off)")
        if b.get("unit_id") in unit_ids:
            errors.append(f"{name}: unit_id {b.get('unit_id')} is used twice")
        unit_ids.add(b.get("unit_id"))
        series = ROOT / "data" / "series" / f"{name}_{b.get('item')}.csv"
        if not series.exists():
            errors.append(f"{name}: series file {series.name} not found")
    if len(cfg.get("bins", [])) != 6:
        errors.append(f"expected 6 bins, found {len(cfg.get('bins', []))}")
    return errors


def main():
    cfg = yaml.safe_load((ROOT / "config" / "bins.yaml").read_text())
    errors = check(cfg)
    for e in errors:
        print("ERROR", e)
    if errors:
        sys.exit(1)
    print("config/bins.yaml OK: every field filled and sourced")


if __name__ == "__main__":
    main()
