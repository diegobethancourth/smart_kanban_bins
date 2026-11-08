# Data schema — MQTT topics and InfluxDB measurements (T1.5, T2.7)

## MQTT topics (EMQX Cloud, MQTT 5.0 over TLS)

| Topic | Published by | QoS | Retained | Payload |
|---|---|---|---|---|
| `css/UE-A/bins/{bin_id}/level` | edge | 1 | yes | level JSON (below) |
| `css/UE-A/bins/{bin_id}/reorder` | edge | 1 | no | reorder JSON (below) |
| `css/UE-A/bins/{bin_id}/epcis` | edge | 1 | no | GS1 EPCIS 2.0 document, one ObjectEvent (T3.7, example in `docs/epcis_example.json`) |
| `css/UE-A/edge/gw01/status` | edge (birth, close and last will) | 1 | yes | `online` or `offline` |

`bin_id` is `bin01` … `bin06`. Subscribe to `css/#` in MQTT Explorer to see everything.

### level

Published when the unit count moves by at least `deadband_units` (per bin, in `config/bins.yaml`),
when the status changes, or every 60 s as a heartbeat.

```json
{
  "ts": "2026-11-07T20:15:00.123Z",
  "bin_id": "bin01",
  "item": "101013101",
  "units": 2860,
  "grams": 1258.0,
  "status": 0,
  "flag": "ok",
  "rop": 2863.6,
  "sim_min": 34300,
  "cycle": 0,
  "heartbeat": false
}
```

| Field | Meaning |
|---|---|
| `ts` | Edge timestamp (ISO 8601, UTC) of the Modbus reading; also the InfluxDB time |
| `units` | Facility stock in dispensing units: `round((grams − tare) / unit_g) × k` |
| `grams` | Gross weight on the load cell |
| `status` | 0 OK, 1 fault reported by the sensor (register 40003), 2 stuck sensor detected at the edge |
| `flag` | `ok`, `hard_fault` or `stuck` (text version of `status`) |
| `rop` | P-240 reorder point of the item, in units |
| `sim_min`, `cycle` | Simulated time of the reading (minutes since 8 Jun 2026) and replay cycle |
| `heartbeat` | true when sent only because 60 s passed without a change |

### reorder

One event per crossing of the ROP (hysteresis: the bin re-arms only after the stock rises
above ROP × 1.10). A flagged bin (status ≠ 0) never sends a reorder.

```json
{
  "ts": "2026-11-07T20:15:00.123Z",
  "bin_id": "bin01",
  "item": "101013101",
  "units": 2860,
  "rop": 2863.6,
  "ss": 1130.3,
  "sim_min": 34300,
  "cycle": 0
}
```

## InfluxDB (bucket `smart_kanban`)

Written by `cloud/ingest/ingest.py`. The time of every point is the edge timestamp `ts`, so
messages sent late by the store-and-forward queue land at the right time. A message delivered
twice (QoS 1 is "at least once") overwrites the same point, because time and tags are equal.

| Measurement | Tags | Fields |
|---|---|---|
| `level` | `ue`, `bin_id`, `item` | `units` (int), `grams` (float), `status` (int), `rop` (float), `heartbeat` (bool), `sim_min` (int), `cycle` (int) |
| `reorder` | `ue`, `bin_id`, `item` | `units` (int), `rop` (float), `ss` (float), `sim_min` (int), `cycle` (int) |
| `gateway` | `ue`, `gw_id` | `online` (int: 1 online, 0 offline) — time of arrival |

Example Flux query, stock of one bin over the last hour:

```flux
from(bucket: "smart_kanban")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "level" and r.bin_id == "bin01" and r._field == "units")
```

To check that all six bins write to both measurements (T2.7 done check):

```flux
from(bucket: "smart_kanban")
  |> range(start: -1d)
  |> filter(fn: (r) => (r._measurement == "level" or r._measurement == "reorder") and r._field == "units")
  |> group(columns: ["_measurement", "bin_id"])
  |> count()
```

(Paracetamol, bin02, has no reorder points: its stock never falls below its ROP in the series.)
