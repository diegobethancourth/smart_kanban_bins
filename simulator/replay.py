"""Replay engine for one bin (T2.2) and the sensor model with faults (T3.1).

The SALMI series gives the stock only on report dates. Between two report dates
the engine invents a plausible path:

  * a drop in stock is consumption: it is spread over the days in between with
    Poisson-like daily values, rescaled so they add up exactly to the drop, and
    each day is split into a few dispense events at random times;
  * a rise in stock is a receipt: it appears as one step up on the report date.

So on every report date the simulated stock equals the SALMI value exactly.
Time is measured in simulated days from the first report date (day 0).
"""

import bisect
import csv
import math
import random
from datetime import date


def load_series(path):
    """Return [(day_index, stock_units)] from a data/series CSV file."""
    rows = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            rows.append((date.fromisoformat(r["date"]), int(r["stock_units"])))
    first = rows[0][0]
    return [((d - first).days, s) for d, s in rows]


def _poisson(rng, mean):
    """Poisson random number (Knuth for small means, normal approximation for large)."""
    if mean <= 0:
        return 0
    if mean > 50:
        return max(0, round(rng.gauss(mean, math.sqrt(mean))))
    limit, k, p = math.exp(-mean), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def _split_exact(rng, total, n):
    """Split an integer total into n Poisson-like integer parts that add up to total."""
    if n <= 0 or total <= 0:
        return [0] * max(n, 0)
    draws = [_poisson(rng, total / n) for _ in range(n)]
    if sum(draws) == 0:                    # small drops: put it all on one random day
        draws[rng.randrange(n)] = 1
    # Rescale, then fix the rounding with the largest remainders
    scaled = [d * total / sum(draws) for d in draws]
    parts = [math.floor(x) for x in scaled]
    order = sorted(range(n), key=lambda i: scaled[i] - parts[i], reverse=True)
    for i in order[: total - sum(parts)]:
        parts[i] += 1
    return parts


def build_path(series, seed=0, events_per_day=(1, 4)):
    """Return the stock path as sorted lists (times, stock_after_event).

    times are in simulated days; the first entry is (0, first stock).
    """
    rng = random.Random(seed)
    times, stock = [series[0][0]], [series[0][1]]
    current = series[0][1]
    for (t0, s0), (t1, s1) in zip(series, series[1:]):
        days = t1 - t0
        if s1 < s0:
            for j, units in enumerate(_split_exact(rng, s0 - s1, days)):
                if units == 0:
                    continue
                n_events = min(units, rng.randint(*events_per_day))
                for part, u in zip(_split_exact(rng, units, n_events),
                                   sorted(rng.random() for _ in range(n_events))):
                    if part:
                        current -= part
                        times.append(t0 + j + u)
                        stock.append(current)
        elif s1 > s0:
            current = s1                    # receipt: step up on the report date
            times.append(float(t1))
            stock.append(current)
        assert current == s1, "path must meet the report value"
    return times, stock


def stock_at(path, t):
    """Stock in units at simulated day t (events at exactly t are included)."""
    times, stock = path
    i = bisect.bisect_right(times, t) - 1
    return stock[max(i, 0)]


class BinSensor:
    """One simulated load cell: stock path -> gross weight in milligrams + status."""

    def __init__(self, cfg, series, seed=0):
        self.cfg = cfg
        self.series = series
        self.path = build_path(series, seed=seed)
        self.end_day = series[-1][0]
        self.rng = random.Random(seed + 1000)
        self.faults = dict(cfg.get("faults", {}))
        self._frozen_mg = None

    def scaled_units(self, t):
        """Units on the scale at day t (facility stock divided by the scale k)."""
        return round(stock_at(self.path, t) / self.cfg["scale_k"])

    def true_mg(self, t):
        """Gross weight without sensor error, in mg."""
        return round((self.cfg["tare_g"] + self.scaled_units(t) * self.cfg["unit_g"]) * 1000)

    def read(self, t):
        """Return (weight_mg, status) as the load cell would report it at day t."""
        f = self.faults
        mg = self.true_mg(t)
        if f.get("noise_g"):
            mg += self.rng.gauss(0, f["noise_g"] * 1000)
        if f.get("drift_g_per_day"):
            mg += f["drift_g_per_day"] * 1000 * t
        mg = max(0, round(mg))

        stuck = f.get("stuck_from_day")
        if stuck is not None and t >= stuck:
            if self._frozen_mg is None:
                self._frozen_mg = mg
            mg = self._frozen_mg            # value freezes, status stays 0 (T3.2 detects it)
        else:
            self._frozen_mg = None

        hard = f.get("hard_fault_from_day")
        status = 1 if hard is not None and t >= hard else 0
        return mg, status
