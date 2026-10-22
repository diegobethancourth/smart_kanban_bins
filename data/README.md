# Simulation data (UE-A)

Stock series that drive the simulated load cells. One facility, six medicines, 92 report dates from 8 Jun to 17 Oct 2026.

## Source

- Stock per report date from the SALMI warehouse management system, as used by the CSS facility replenishment dashboard (procedure P-240). The data is read-only; nothing in the CSS systems is changed.
- The facility is anonymised as **UE-A**. No facility names, people, suppliers or prices are included.

## Files

`series/binNN_<item>.csv`, one per bin:

| Column | Meaning |
|---|---|
| `date` | Report date (ISO) |
| `stock_units` | Stock at the facility on that date, in dispensing units (tablets, vials, ampoules, bottles) |
| `changed` | 1 if the stock changed on that date, 0 if it held from the previous report |
| `flagged_point_removed` | 1 if the original value on that date was a one-day dip that recovered without a delivery (a likely report error) and was removed |

The source stores only the dates on which the stock changed. Each value holds until the next change, so the files repeat it on every report date.

`../config/bins.json` contains the parameters of each bin. See the next section.

## Bin parameters

| Field | Meaning | Source |
|---|---|---|
| `unit_g`, `units_per_box` | Weight of one unit, units per box | Shortlist workbook; values marked doubtful there are simulation parameters |
| `tare_g` | Weight of the empty bin | Simulation parameter |
| `scale_k` | Scale model: one unit on the scale represents k units of facility stock | Smallest of 1, 2, 5, 10… that keeps the net load at or under 15 kg |
| `capacity_scaled` | Bin capacity in scaled units (120% of the highest stock) | Computed |
| `d_month`, `d_day` | Observed demand per month and per day | Stock drops over the last 90 days, same method as the CSS dashboard |
| `cv_weekly`, `sigma_d` | Week-to-week variation and daily standard deviation | Same method as the CSS dashboard (default CV 0.5 when fewer than 4 weeks) |
| `z`, `L_days`, `SS`, `ROP` | P-240 rule: SS = z·σ_d·√L, ROP = d·L + SS, L = 20 days, z = 1.65 vital, 1.28 other | CSS P-240 |
| `ROP_scaled` | ROP divided by k, for comparing with the scale reading | Computed |

The dashboard can also take demand from consumption reports or from requisitions (F8). Here it uses only the demand observed in the stock series, so the simulation can be reproduced from these files alone. The ROP values may therefore differ slightly from the live dashboard.

## Scale model (option A)

The real stock of a facility is often heavier than one bin can hold (up to about 39 kg of paracetamol at UE-A). Each bin therefore represents the facility stock at a fixed scale:

```
scaled_units = round(stock_units / k)
weight_g     = tare_g + scaled_units × unit_g + sensor error
```

The edge converts back before applying P-240: `stock_units = k × floor((weight_g − tare_g) / unit_g)`.
Proportional scaling does not change when the stock crosses the ROP, so the reorder events and the detection-latency analysis are unaffected. The resolution becomes k units (5 for paracetamol, 2 for chlorphenamine, 1 for the rest).

## What is real and what is simulated

- **Real:** the stock on every report date, the deliveries (steps up), and the demand and variation used for the ROP.
- **Simulated:** the path of the stock between report dates, and the sensor signal (grams, noise, drift, faults).
- **Check:** on every report date, the simulated stock must equal `stock_units` in these files.
