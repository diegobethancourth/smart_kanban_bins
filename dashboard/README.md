# Dashboard — Grafana

Open http://localhost:3000 when the stack is running (no login needed to view; admin password
in `.env` as `GRAFANA_ADMIN_PASSWORD`). The dashboard **Smart Kanban Bins - UE-A** opens as the
home page.

Everything is provisioned from this folder, so every member gets the same dashboard:

- `grafana/provisioning/datasources/influxdb.yaml` — InfluxDB (Flux), filled from `.env`
- `grafana/provisioning/dashboards/smart_kanban.yaml` — loads the dashboard files
- `grafana/dashboards/smart_kanban.json` — the dashboard

## Panels (T3.5)

| Panel | Source |
|---|---|
| Gateway gw01 — ONLINE / OFFLINE | `gateway` measurement (birth / last will, T3.4) |
| Seconds since last data | latest `level` point (heartbeat every 60 s) |
| Bins flagged (fault or stuck) | latest `status` per bin |
| Reorder events (P-240) | `reorder` measurement: time, bin, item, units, ROP, SS |
| All bins: stock as a multiple of the ROP | first draft from T2.8, six lines on one chart |
| One panel per bin | stock in units (maroon, sawtooth) with the ROP as a dashed gold line |

Colours follow the ASU palette: maroon `#8C1D40`, gold `#FFC627`.

## Changing the dashboard

Edit in Grafana, then **Share → Export → Save to file** and replace
`grafana/dashboards/smart_kanban.json` in a pull request. (Changes made only in the Grafana
UI are lost when the container is recreated.)

Choice of tool: see `docs/decisions.md` (Grafana vs FlowFuse Dashboard).
