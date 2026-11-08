# Demo script (T4.5) — target 6 minutes

**Draft — the team still needs to choose the presenter and rehearse it twice with a timer.**

## Before class (15 minutes early)

1. Connect to the room Wi-Fi. Check the broker port in PowerShell: `Test-NetConnection <EMQX host> -Port 8883`.
   If it fails, set `MQTT_URL=wss://<host>:8084/mqtt` in `.env`. If that fails too, use the local stack
   (`docker compose --profile local --env-file .env.local up --build`).
2. Start the stack: `docker compose up --build`. Set `SIM_START_DAY=10` in `.env` so a reorder comes
   soon (folic acid crosses its ROP around day 24, chlorphenamine around day 63).
3. Open four windows: Grafana (localhost:3000), Node-RED (localhost:1880), MQTT Explorer subscribed to `css/#`,
   and a terminal in the repository folder.
4. Have the backup video open, paused at 0:00.

## Script

| Time | Show | Say (key points) |
|---|---|---|
| 0:00–0:45 | Architecture figure (README) | Problem: CSS facilities report stock on fixed dates, so a reorder point can be crossed days before anyone sees it. Our chain: load cells → Modbus → edge with P-240 → MQTT 5 over TLS → InfluxDB → dashboard. Real SALMI series for six medicines at one facility (UE-A). |
| 0:45–1:30 | Terminal: simulator log; Node-RED flow | Six simulated bins, one Modbus unit ID each. The replay matches the SALMI stock on every report date; between dates it simulates the dispensing. The edge polls every second and converts grams to units. |
| 1:30–2:30 | MQTT Explorer, then Grafana stock panels | Retained level messages, QoS 1. Deadband and 60 s heartbeat keep the traffic low. The sawtooth is the stock; the dashed gold line is the P-240 ROP = d̄·L + z·σ·√L. |
| 2:30–3:30 | Wait for a reorder: Node-RED status turns yellow, row in the events table, message on `.../reorder` | One event per crossing (hysteresis). The same event is published as a GS1 EPCIS 2.0 ObjectEvent. |
| 3:30–4:30 | Stuck sensor on bin03 (set before class: `SIM_FAULTS=bin03.stuck_from_day=14` with `SIM_START_DAY=10`, so it freezes about 40 s after the start); "Bins flagged" = 1, bin03 level shows `flag: stuck` | A stuck sensor keeps a constant value but reports OK; the edge notices that the reading never moves while demand says it should, and flags the bin instead of ordering. |
| 4:30–5:30 | `docker compose stop edge` → gateway panel OFFLINE; `docker compose start edge` → ONLINE, no gap in the graph | Last will on the gateway status topic. Store-and-forward: messages wait on disk while the broker is unreachable and are written at their edge time. |
| 5:30–6:15 | `docs/latency.md` histogram | The detection-latency result and its limit: it is model-based, because the path between reports is simulated. |
| 6:15–6:30 | — | Thank you; questions. |

## Switch to the backup video if

- no data reaches Grafana within 2 minutes of starting, or
- the network drops and does not come back within 30 seconds.

Agreed signal: the presenter says "let me show you the recorded run", and the second member starts the video.
