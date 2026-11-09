# Decisions

One entry per decision: date, what was decided, and why.

## 2026-10-21 · MQTT broker: EMQX Cloud Serverless instead of HiveMQ Cloud

- **Decision:** use EMQX Cloud Serverless as the cloud MQTT broker, with the spending limit set to 0.
- **Why:** HiveMQ Cloud now offers only a paid Starter plan with a 15-day trial, which would expire during the project. EMQX Serverless has a free monthly quota (1 million session minutes, 1 GB of traffic) and needs no payment card.
- **What does not change:** MQTT 5.0 over TLS on port 8883, the topic structure, QoS and the last-will design. The proposal deck names HiveMQ Cloud; the architecture is the same, only the provider changes.
- **Fallback:** secure WebSockets on port 8084 if 8883 is blocked.

## 2026-10-21 · Simulation data: scale model (option A)

- **Decision:** each bin represents the facility stock at a fixed scale k (see `data/README.md`).
- **Why:** facility stock is often heavier than one bin can hold. Proportional scaling does not change the reorder crossings or the detection latency.

## 2026-11-07 · Modbus polling with modbus-serial instead of node-red-contrib-modbus

- **Decision:** the edge reads the six bins with the `modbus-serial` npm library inside one Function node ("Modbus poll"), installed in the edge Docker image.
- **Why:** current versions of `node-red-contrib-modbus` download one of their dependencies from a third-party server (Cloudsmith) instead of npm. That made the install fail in a restricted network, and it is a risk for the demo build. `modbus-serial` is on npm and is also what the contrib nodes use underneath.
- **What does not change:** Modbus TCP, function code 3, one unit ID per bin, polling every second.

## 2026-11-07 · Register map: milligrams, gross weight, simulated time

- **Decision:** registers 40001–40002 hold the **gross** weight in **milligrams**; 40004–40006 add the simulated time and the replay cycle (see `docs/register_map.md`).
- **Why:** folic acid tablets weigh 0.3 g, so whole grams cannot tell one tablet from the next. A real load cell reports the gross weight; the edge subtracts the tare (T2.4). The simulated time lets the latency analysis (T3.6) compare a sensed crossing with the report dates.

## 2026-11-07 · Units at the edge: round instead of floor

- **Decision:** `units = round((grams − tare) / unit_g) × k` instead of `floor(...)`.
- **Why:** with floor, a sensor noise of only −0.1 g drops a whole unit (a 250 g syrup bottle at exactly 42 bottles read as 41). Rounding is correct as long as the noise is under half a unit; for folic acid (0.3 g) the remaining ±1 tablet jitter is absorbed by the deadband (10 units).

## 2026-11-07 · Stuck-sensor rule

- **Decision:** a bin is flagged as stuck when the raw weight is identical for 20 polls in a row **and** the average demand d̄ says at least 2 units should have gone in that time (`config/bins.yaml`, section `edge`).
- **Why:** a working load cell always shows some noise (0.2 g in the simulator), so an exactly constant value means the sensor or its cable is stuck. The d̄ condition avoids flagging slow-moving items. While flagged, the bin publishes `status: 2` and sends no reorder (flag, don't order).

## 2026-11-07 · Database writes through an ingest service

- **Decision:** a small Python service (`cloud/ingest`) subscribes to the broker and writes to InfluxDB, instead of Node-RED writing to InfluxDB directly.
- **Why:** this follows the architecture in the deck (edge → broker → database). Store-and-forward then protects the whole path: if the network drops, the edge queues, the broker keeps the ingest's persistent session, and late messages are written at their edge timestamp. It also records the edge's last-will `offline` message, which Node-RED cannot write once it is stopped.

## 2026-11-07 · Dashboard tool: Grafana (T2.8)

- **Options compared:** Grafana (reads InfluxDB directly) and FlowFuse Dashboard (runs inside Node-RED).
- **Decision:** Grafana OSS, run in Docker next to the other services, so no extra cloud account is needed.
- **Why:** it draws the ROP as a dashed line over the stock line, shows a table straight from the `reorder` measurement, and shows the gateway status from the `gateway` measurement. The dashboard is a JSON file in the repository (`dashboard/grafana/dashboards/smart_kanban.json`), loaded automatically, so every member gets the same one. FlowFuse would show only what passes through the edge, so it could not show the gateway as offline when the edge is down.

## 2026-11-07 · Local fallback stack

- **Decision:** `docker compose --profile local` adds a local Mosquitto broker and a local InfluxDB, with `.env.local.example`.
- **Why:** if campus Wi-Fi blocks 8883 and 8084, or a cloud account fails on demo day, the same demo runs on the laptop with no internet. The flows and the dashboard are the same; only the URLs change.

## 2026-11-09 · Port 8883 test on campus Wi-Fi (T0.3)

- **Test:** `Test-NetConnection broker.emqx.io -Port 8883` and `-Port 8084` in PowerShell, on ASU campus Wi-Fi (Polytechnic campus, 9 Nov 2026, 16:20 MST). `broker.emqx.io` is EMQX's public broker on the same ports as our Serverless deployment, so it shows whether the campus network blocks them.
- **Result:** `TcpTestSucceeded : True` for **both 8883** (MQTT over TLS) **and 8084** (MQTT over secure WebSockets).
- **Decision:** keep `MQTT_URL=mqtts://<host>:8883` as the main path. `wss://<host>:8084/mqtt` is confirmed as a working fallback, and the local stack (`--profile local`) stays as the last resort.
- **To repeat** in the demo room before class with our own EMQX address (step 1 of `docs/demo_script.md`).
