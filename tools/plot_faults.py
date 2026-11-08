"""Plot each simulator fault for one bin (T3.1) -> docs/img/faults.png.

Usage:  python tools/plot_faults.py [bin_id]     (default bin03)
"""

import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "simulator"))
from replay import BinSensor, load_series  # noqa: E402

MAROON, GOLD, GREY = "#8C1D40", "#FFC627", "#747474"


def run(b, faults, days):
    cfg = dict(b, faults=faults)
    s = BinSensor(cfg, load_series(ROOT / "data" / "series" / f"{b['bin']}_{b['item']}.csv"))
    reads = [s.read(t) for t in days]
    return [mg / 1000 for mg, _ in reads], [st for _, st in reads], [s.true_mg(t) / 1000 for t in days]


def main():
    bin_id = sys.argv[1] if len(sys.argv) > 1 else "bin03"
    b = next(x for x in json.loads((ROOT / "config" / "bins.json").read_text())["bins"] if x["bin"] == bin_id)
    days = [i / 20 for i in range(0, 20 * 80)]
    off = {"noise_g": 0, "drift_g_per_day": 0, "stuck_from_day": None, "hard_fault_from_day": None}
    cases = [
        ("Noise (sd 5 g)", dict(off, noise_g=5)),
        ("Drift (+3 g per day)", dict(off, drift_g_per_day=3)),
        ("Stuck from day 30 (status stays 0)", dict(off, stuck_from_day=30)),
        ("Hard fault from day 50 (status 40003 = 1)", dict(off, hard_fault_from_day=50)),
    ]
    fig, axes = plt.subplots(len(cases), 1, figsize=(10, 9), sharex=True)
    for ax, (title, faults) in zip(axes, cases):
        grams, status, true_g = run(b, faults, days)
        ax.plot(days, true_g, color=GREY, lw=1, label="true weight")
        ax.plot(days, grams, color=MAROON, lw=1, label="register value")
        if any(status):
            ax2 = ax.twinx()
            ax2.fill_between(days, status, step="post", color=GOLD, alpha=0.4, label="status")
            ax2.set_ylim(0, 1.2)
            ax2.set_yticks([0, 1])
            ax2.set_ylabel("status")
        ax.set_title(title, fontsize=10, loc="left")
        ax.set_ylabel("grams")
        ax.legend(loc="upper right", fontsize=8)
    axes[-1].set_xlabel("simulated day")
    fig.suptitle(f"Simulator faults - {b['bin']} ({b['name'][:40]})", fontsize=11)
    fig.tight_layout()
    out = ROOT / "docs" / "img" / "faults.png"
    out.parent.mkdir(exist_ok=True)
    fig.savefig(out, dpi=110)
    print(f"saved {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
