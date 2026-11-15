"""Update data/series from the CSS facility stock series (data refresh before a demo).

The CSS facility replenishment dashboard publishes, for each facility, a file
series_saldos_<facility>.json with the SALMI stock of every item on the dates it
changed. This script takes the six shortlisted items of UE-A from that file and
rewrites data/series/binNN_<item>.csv with the same rules as the original
extraction (T1.3):

  * a value holds until the next change, so it is repeated on every report date;
  * a one-day dip that recovers to the previous level on the next report date,
    with no delivery in between, is treated as a report error and removed
    (flagged_point_removed = 1).

The facility name never enters the repository: pass the source file as an argument
from wherever you keep it (for example a local clone of REPOSICION_UE_CSS).

Usage:
    python tools/update_series.py <path/to/series_saldos_<facility>.json> [--check]

--check only compares with the current CSV files (dates they share) and writes nothing.
Afterwards: python tools/build_config.py, then python -m pytest simulator/tests.
"""

import argparse
import csv
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SERIES = ROOT / "data" / "series"


def report_series(source, item):
    """Return [(date, stock, changed, flagged)] on every report date of the source file."""
    dates = source["fechas"]
    entry = next((x for x in source["f"] if x["c"] == item), None)
    if entry is None:
        sys.exit(f"item {item} not found in the source file")
    points = [(dates[i], v) for i, v in entry["v"]]          # change points, in date order
    # Report errors: a drop to zero that comes back afterwards without a delivery
    # (next value > 0 and not above the level before the drop). The zero is removed and
    # the previous level holds until the next real change. Smaller dips are kept: they
    # are real movements (partial returns or small receipts).
    flagged = set()
    for k in range(1, len(points) - 1):
        prev, cur, nxt = points[k - 1][1], points[k][1], points[k + 1][1]
        if cur == 0 and prev > 0 and 0 < nxt <= prev:
            flagged.add(points[k][0])
    changes = {d: v for d, v in points if d not in flagged}
    rows, last = [], None
    for d in dates:
        value = changes.get(d, last)
        changed = d in changes and value != last           # the first value counts as a change
        rows.append([d, value, int(changed), int(d in flagged)])
        last = value
    return [r for r in rows if r[1] is not None]


def read_csv(path):
    with open(path, newline="") as f:
        return {r["date"]: r for r in csv.DictReader(f)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="series_saldos_<facility>.json")
    ap.add_argument("--check", action="store_true", help="compare only, write nothing")
    args = ap.parse_args()

    source = json.loads(Path(args.source).read_text())
    cfg = yaml.safe_load((ROOT / "config" / "bins.yaml").read_text())
    total_diff = 0
    new = {}
    for b in cfg["bins"]:
        path = SERIES / f"{b['bin']}_{b['item']}.csv"
        rows = report_series(source, b["item"])
        old = read_csv(path)
        diff = [d for d, s, *_ in rows if d in old and int(old[d]["stock_units"]) != s]
        total_diff += len(diff)
        added = [d for d, *_ in rows if d not in old]
        print(f"{b['bin']}: {len(rows)} report dates ({rows[0][0]} to {rows[-1][0]}), "
              f"{len(added)} new, {len(diff)} differ from the current file"
              + (f" e.g. {diff[:3]}" if diff else ""))
        new[path] = rows

    if args.check:
        return
    for path, rows in new.items():
        with open(path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["date", "stock_units", "changed", "flagged_point_removed"])
            w.writerows(rows)
    first = min(r[0][0] for r in new.values())
    last = max(r[-1][0] for r in new.values())
    n = max(len(r) for r in new.values())
    text = (ROOT / "config" / "bins.yaml").read_text()
    s = cfg["series"]
    text = (text.replace(f'first_date: "{s["first_date"]}"', f'first_date: "{first}"')
                .replace(f'last_date: "{s["last_date"]}"', f'last_date: "{last}"')
                .replace(f'report_dates: {s["report_dates"]}', f"report_dates: {n}"))
    (ROOT / "config" / "bins.yaml").write_text(text)
    print(f"wrote {len(new)} files; series now {first} to {last}, {n} report dates."
          " Next: python tools/build_config.py && python -m pytest simulator/tests")


if __name__ == "__main__":
    main()
