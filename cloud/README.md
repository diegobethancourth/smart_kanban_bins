# Cloud — broker and database

| Part | Cloud (demo) | Local fallback (`--profile local`) |
|---|---|---|
| MQTT broker | EMQX Cloud Serverless, MQTT 5 over TLS on 8883 (WebSockets 8084 as fallback) | Mosquitto 2.0.21 (`mosquitto/mosquitto.conf`) |
| Database | InfluxDB Cloud, bucket `smart_kanban` | InfluxDB 2.7.11 OSS, created on first start |
| Ingest | `ingest/` (runs in Docker on the demo laptop in both cases) | same |

## ingest/

`ingest.py` subscribes to `css/+/bins/+/level`, `css/+/bins/+/reorder` and `css/+/edge/+/status`
and writes the measurements in [`docs/schema.md`](../docs/schema.md). Every point takes the edge
timestamp, and the MQTT session is persistent (clean start off, expiry 1 day), so nothing is lost
while the ingest or the network is down.

```bash
python -m pytest cloud/ingest     # mapping tests
```

## EMQX Cloud setup (from T0.2)

- Authentication: two users, one for the edge gateway and one for test tools / ingest. No anonymous access.
- Spending limit 0. Free quota: 1 million session minutes and 1 GB per month.
- The server certificate is signed by a public CA, so no CA file is needed. If a TLS error appears,
  download `emqxsl-ca.crt` from the console.

## InfluxDB Cloud setup

- Bucket `smart_kanban` (free plan keeps 30 days: run the final replay close to the demo).
- One API token with write and read access to that bucket only → `INFLUX_TOKEN` in `.env`.
