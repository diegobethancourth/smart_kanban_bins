# Simulated Smart Kanban Bins

MFG 598 Industrial Internet of Things · Arizona State University · Fall 2026
Group project: D. Bethancourth, D. Jaladi, F. Rumwaropen · Instructor: Dr. Farhad Ameri

A simulated IIoT chain for pharmaceutical replenishment at a health facility: load cells under Kanban bins (simulated with pymodbus) → Modbus TCP → Node-RED edge gateway applying the CSS P-240 reorder-point rule → MQTT 5.0 over TLS → EMQX Cloud (Serverless) and InfluxDB Cloud → dashboard.

**Work plan:** https://diegobethancourth.github.io/smart_kanban_bins/

## Rules for this repository

- The repository is public. Commit only aggregated, anonymised data (facility shown as UE-A); no names, endpoints or credentials.
- Credentials go in a local `.env` file, which is ignored by git. Share them privately, never in a commit, issue or pull request.
- Work on a branch and open a pull request; another member reviews before merging to `main`.

## Planned structure (task T1.1)

```
simulator/   pymodbus load-cell simulator and SALMI replay engine
edge/        Node-RED flows (Modbus polling, grams to units, deadband, P-240, store-and-forward)
cloud/       broker and database configuration
dashboard/   HMI dashboard
data/        anonymised stock series for the six shortlisted items
docs/        work plan (GitHub Pages), decisions, analysis
```

Reproduction steps will be added at code freeze (task T4.2).
