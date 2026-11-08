# Simulator — six load cells over Modbus TCP

`server.py` runs a Modbus TCP server on port 5020 with one device per bin (unit IDs 1–6).
`replay.py` replays the SALMI stock series of UE-A and models the load cell (noise, drift, faults).
Register map: [`docs/register_map.md`](../docs/register_map.md).

## How the replay works (T2.2)

- On every report date the simulated stock equals the SALMI value (checked by `tests/test_replay.py`).
- A drop between two report dates is consumption, spread over the days in between with
  Poisson-like daily values rescaled to the exact drop, and split into 1–4 dispense events per day.
- A rise is a receipt: one step up on the report date.
- Time is compressed: one simulated day lasts `SIM_SECONDS_PER_DAY` seconds (default 10, so the
  131 days take about 22 minutes). After the last date the replay starts again (`cycle` + 1).

## Faults (T3.1)

Per bin in `config/bins.yaml` → `faults`, or for a demo without editing the file:

```
SIM_FAULTS=bin03.stuck_from_day=30,bin04.hard_fault_from_day=50
```

| Fault | Effect |
|---|---|
| `noise_g` | Gaussian noise on the weight (default 0.2 g, like a real load cell) |
| `drift_g_per_day` | Weight creeps up by this many grams per simulated day |
| `stuck_from_day` | Weight register freezes; status stays 0 (the edge must detect it, T3.2) |
| `hard_fault_from_day` | Status register 40003 = 1 |

`python tools/plot_faults.py` draws each fault: [`docs/img/faults.png`](../docs/img/faults.png).

## Run without Docker

```bash
pip install -r simulator/requirements.txt
cd simulator && python server.py
```

## Tests

```bash
python -m pytest simulator/tests
```
