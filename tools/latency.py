"""Detection-latency analysis (T3.6) -> docs/latency.md and docs/img/latency.png.

Question: how much earlier does a sensed bin detect a P-240 reorder-point crossing
than the SALMI report would?

For each reorder event sensed at the edge:
  * sensed time  = the simulated time of the event (field sim_min, from the simulator clock)
  * report time  = the first SALMI report date, at or after the event, on which the
                   reported stock is at or below the same ROP
  * latency      = report time - sensed time, in days (positive = the sensor was earlier)

Input: the reorder events, either
  * a CSV exported from InfluxDB Data Explorer (measurement reorder, fields units, rop,
    sim_min, cycle; tags bin_id, item), or
  * a JSON-lines file of MQTT messages (one {"topic":..., "payload":...} per line).

Usage:  python tools/latency.py <events.csv | events.jsonl> [--cycle 0]
"""

import argparse
import csv
import json
import statistics
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
MAROON, GOLD = "#8C1D40", "#FFC627"


def load_events(path):
    """Return a list of dicts with bin_id, item, units, rop, sim_min, cycle."""
    text = Path(path).read_text()
    events = []
    if path.endswith(".csv"):
        # InfluxDB annotated CSV: skip '#' lines, pivot _field/_value rows per (_time, bin_id)
        rows = [r for r in csv.reader(line for line in text.splitlines() if line and not line.startswith("#"))]
        header, rows = rows[0], [r for r in rows[1:] if r != rows[0]]
        idx = {h: i for i, h in enumerate(header)}
        grouped = defaultdict(dict)
        for r in rows:
            if r[idx["_measurement"]] != "reorder":
                continue
            key = (r[idx["_time"]], r[idx["bin_id"]])
            grouped[key].update(bin_id=r[idx["bin_id"]], item=r[idx["item"]], ts=r[idx["_time"]])
            grouped[key][r[idx["_field"]]] = float(r[idx["_value"]])
        events = list(grouped.values())
    else:
        for line in text.splitlines():
            m = json.loads(line)
            if m.get("topic", "").endswith("/reorder"):
                events.append(json.loads(m["payload"]))
    return events


def report_series(b):
    with open(ROOT / "data" / "series" / f"{b['bin']}_{b['item']}.csv", newline="") as f:
        return [(date.fromisoformat(r["date"]), int(r["stock_units"])) for r in csv.DictReader(f)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("events")
    ap.add_argument("--cycle", type=int, default=0, help="replay cycle to analyse")
    args = ap.parse_args()

    cfg = json.loads((ROOT / "config" / "bins.json").read_text())
    bins = {b["bin"]: b for b in cfg["bins"]}
    first = date.fromisoformat(cfg["first_date"])
    events = [e for e in load_events(args.events) if int(e.get("cycle", 0)) == args.cycle]
    if not events:
        sys.exit("no reorder events found for that cycle")

    rows = []
    for e in sorted(events, key=lambda e: (e["bin_id"], e["sim_min"])):
        b = bins[e["bin_id"]]
        sensed_day = e["sim_min"] / 1440
        sensed_date = first + timedelta(days=sensed_day)
        series = report_series(b)
        before = [(d, s) for d, s in series if (d - first).days <= sensed_day]
        if before and before[-1][1] <= e["rop"]:
            # the last report before the event already showed the stock at or below the ROP
            # (e.g. the bin starts the series below it): not a crossing the sensor saw first
            rows.append((b, e, sensed_date, before[-1][0], before[-1][1], "already"))
            continue
        match = next(((d, s) for d, s in series
                      if (d - first).days >= sensed_day and s <= e["rop"]), None)
        if match is None:
            rows.append((b, e, sensed_date, None, None, None))
            continue
        latency = (match[0] - first).days - sensed_day
        rows.append((b, e, sensed_date, match[0], match[1], latency))

    lat_by_bin = defaultdict(list)
    for b, e, *_, lat in rows:
        if isinstance(lat, float):
            lat_by_bin[b["bin"]].append(lat)
    all_lat = [x for v in lat_by_bin.values() for x in v]

    # ---- figure: histogram per item ----
    used = [b for b in bins if lat_by_bin[b]]
    fig, axes = plt.subplots(1, len(used) + 1, figsize=(3.2 * (len(used) + 1), 3), sharey=False)
    for ax, bin_id in zip(axes, used):
        ax.hist(lat_by_bin[bin_id], bins=[i * 0.5 for i in range(0, 15)], color=MAROON, edgecolor="white")
        ax.set_title(f"{bin_id}\n{bins[bin_id]['name'][:22]}", fontsize=8)
        ax.set_xlabel("days earlier than report", fontsize=8)
    axes[-1].hist(all_lat, bins=[i * 0.5 for i in range(0, 15)], color=GOLD, edgecolor=MAROON)
    axes[-1].set_title("all items", fontsize=8)
    axes[-1].set_xlabel("days earlier than report", fontsize=8)
    axes[0].set_ylabel("events")
    fig.tight_layout()
    (ROOT / "docs" / "img").mkdir(exist_ok=True)
    fig.savefig(ROOT / "docs" / "img" / "latency.png", dpi=110)

    # ---- markdown ----
    md = ["# Detection-latency analysis (T3.6)", "",
          "How much earlier does a sensed bin detect a P-240 reorder-point (ROP) crossing than "
          "the SALMI stock report would?", "",
          "## Method", "",
          "1. A full replay of the 92 UE-A report dates (8 Jun - 17 Oct 2026) runs through the whole "
          "chain: simulator -> Modbus -> Node-RED edge (units, deadband, P-240 with hysteresis) -> MQTT -> ingest.",
          "2. For each reorder event published by the edge, the **sensed time** is the simulated time "
          "of the reading that crossed the ROP (`sim_min`, read from the simulator registers 40004-40005).",
          "3. The **report time** is the first SALMI report date, at or after the sensed time, on which the "
          "reported stock is at or below the same ROP.",
          "4. **Latency = report time - sensed time**, in days. Positive means the sensor saw the crossing earlier.",
          "5. Events where the last report *before* the event already showed the stock at or below the ROP "
          "are excluded: there the report, not the sensor, saw it first (this happens when a bin starts "
          "the series already below its ROP).",
          "",
          f"Input: `{Path(args.events).name}`, replay cycle {args.cycle}, "
          f"{len(events)} reorder events. Generated by `python tools/latency.py`.", "",
          "## Result per event", "",
          "| Bin | Item | Sensed (simulated date) | Units | ROP | First report <= ROP | Reported stock | Latency (days) |",
          "|---|---|---|---|---|---|---|---|"]
    for b, e, sd, rd, rs, lat in rows:
        if lat == "already":
            lat_text = f"excluded: report of {rd} already showed {rs}"
        elif lat is None:
            lat_text = "no report at or below ROP"
        else:
            lat_text = f"{lat:.2f}"
        md.append(f"| {b['bin']} | {b['name'].split(',')[0]} | {sd.isoformat()} {int((e['sim_min'] % 1440) // 60):02d}h | "
                  f"{int(e['units'])} | {e['rop']:.1f} | {rd or 'none in series'} | {rs if rs is not None else '-'} | "
                  f"{lat_text} |")
    md += ["", "## Summary per item", "",
           "| Bin | Item | Events | Mean latency (days) | Min | Max |", "|---|---|---|---|---|---|"]
    for bin_id in bins:
        v = lat_by_bin[bin_id]
        if v:
            md.append(f"| {bin_id} | {bins[bin_id]['name'].split(',')[0]} | {len(v)} | "
                      f"{statistics.mean(v):.2f} | {min(v):.2f} | {max(v):.2f} |")
        else:
            md.append(f"| {bin_id} | {bins[bin_id]['name'].split(',')[0]} | 0 | - | - | - |")
    if all_lat:
        md += ["", f"**All items:** {len(all_lat)} events, mean {statistics.mean(all_lat):.2f} days, "
               f"median {statistics.median(all_lat):.2f} days, max {max(all_lat):.2f} days earlier than the report.", ""]
    dates = [d for d, _ in report_series(next(iter(bins.values())))]
    gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
    md += [f"For context: UE-A reported on {len(dates)} dates in {(dates[-1] - dates[0]).days} days "
           f"(gap between reports: median {statistics.median(gaps):.0f} day, max {max(gaps)} days). "
           "The gain from sensing grows with that gap: a facility that reports weekly would see "
           "crossings up to about a week later than the bins do.", ""]
    md += ["![Latency histograms](img/latency.png)", "",
           "## Limits", "",
           "- **The result is model-based.** Between two report dates the stock path is simulated "
           "(Poisson-like daily consumption, rescaled to the observed drop). The real path is unknown, "
           "so the sensed time is what a bin *would* have seen under that model, not a measurement.",
           "- The latency can never be negative here: the replay equals the SALMI value on every report "
           "date, and stock only falls between reports, so the crossing is always sensed on or before "
           "the report that shows it. The size of the gain depends mostly on the gap between report dates.",
           "- Receipts are placed exactly on report dates; a delivery between reports in reality could hide "
           "a crossing that the reports never show.",
           "- The edge polls every second and one simulated day lasts `SIM_SECONDS_PER_DAY` seconds "
           "(10 in this run), so the sensed time has a resolution of about 0.1 day.",
           "- Paracetamol (bin02) never falls below its ROP in this period, so it has no events.",
           "- One facility (UE-A), six items and one period: the numbers illustrate the method, they do not "
           "generalise to the CSS network.", ""]
    (ROOT / "docs" / "latency.md").write_text("\n".join(md))
    print(f"wrote docs/latency.md and docs/img/latency.png ({len(rows)} events)")


if __name__ == "__main__":
    main()
