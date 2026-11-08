# Edge gateway — Node-RED

One flow (`flows.json`, tab **Edge gateway**), opened at http://localhost:1880 when the stack runs.

```
every 1 s → Modbus poll (6 bins) → Units, deadband, heartbeat, faults → Store-and-forward → MQTT out (EMQX)
                                              └──────→ P-240 reorder (hysteresis) ──┘
                                                            └─ EPCIS ObjectEvent ───┘
```

| Node | Task | What it does |
|---|---|---|
| Modbus poll (6 bins) | T1.4, T2.3 | Reads registers 40001–40006 of unit IDs 1–6 with `modbus-serial` and decodes the 32-bit values |
| Units, deadband, heartbeat, faults | T2.4, T3.2 | `units = round((g − tare)/unit_g) × k`; publishes on a change ≥ `deadband_units`, a status change, or every 60 s; flags hard faults (status 1) and stuck sensors (status 2) |
| P-240 reorder (hysteresis) | T2.5, T2.6, T3.7 | `lib/p240.js`; one event per crossing, re-arm above ROP × 1.10; suppressed while the bin is flagged; also builds the EPCIS event (`lib/epcis.js`) |
| Store-and-forward | T3.3 | Passes messages while the broker is connected; otherwise queues them in the `file` context store (survives a restart) and sends them in order on reconnect |
| MQTT broker config | T1.5, T3.4 | `${MQTT_URL}` (MQTT 5; TLS on with server-certificate check for `mqtts://` and `wss://`), keep-alive 30 s; birth `online`, close and last will `offline` on `css/UE-A/edge/gw01/status`, retained |

Topics and payloads: [`docs/schema.md`](../docs/schema.md).

## Configuration

- `config/bins.json` is loaded once at start (`global.get('bins')`, set in `settings.js`). After editing `config/bins.yaml`, run `python tools/build_config.py` and restart the edge.
- Broker address and credentials come from `.env`: `MQTT_URL`, `MQTT_USER`, `MQTT_PASS`.
  `flows_cred.json` contains only the placeholders `${MQTT_USER}` / `${MQTT_PASS}`.
  **Do not type the real password in the editor**: it would be saved in plain text in that file.
- For the WebSocket fallback, set `MQTT_URL=wss://<host>:8084/mqtt`.

## Tests

```bash
node --test "edge/test/*.test.js"
```

## Editing the flow

Edit in the Node-RED editor and press **Deploy**: Node-RED writes `flows.json` back to this folder
through the Docker volume. Commit `flows.json` on a branch and open a pull request.

On Linux hosts the container runs as user 1000; if Node-RED cannot write to `/data`, run
`sudo chown -R 1000:1000 edge`.
