"""MQTT -> InfluxDB ingest (T1.6, T2.7).

Subscribes to the broker and writes every message to InfluxDB with the schema in
docs/schema.md. The time of each point is the edge timestamp (payload "ts"), not
the arrival time, so messages sent late by the store-and-forward queue land at the
right time.

It uses a persistent MQTT session (clean start off, 1 day expiry), so the broker
keeps QoS 1 messages for it while it is offline.

Environment (from .env):
  MQTT_URL     mqtts://<host>:8883 (EMQX Cloud), wss://<host>:8084/mqtt, or mqtt://mosquitto:1883
  MQTT_USER, MQTT_PASS          broker credentials (INGEST_MQTT_USER / _PASS override them)
  INFLUX_URL, INFLUX_ORG, INFLUX_BUCKET, INFLUX_TOKEN
"""

import json
import logging
import os
import signal
import ssl
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

import paho.mqtt.client as mqtt
from influxdb_client import InfluxDBClient, Point, WriteOptions
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.properties import Properties

log = logging.getLogger("ingest")

TOPICS = ["css/+/bins/+/level", "css/+/bins/+/reorder", "css/+/edge/+/status"]


def to_point(topic, payload, now=None):
    """Turn one MQTT message into an InfluxDB Point (None if it is not ours)."""
    parts = topic.split("/")
    if len(parts) != 5 or parts[0] != "css":
        return None
    _, ue, kind, ident, leaf = parts

    if kind == "edge" and leaf == "status":                 # birth / last will (T3.4)
        state = payload.decode().strip().lower()
        return (Point("gateway").tag("ue", ue).tag("gw_id", ident)
                .field("online", 1 if state == "online" else 0)
                .time(now or datetime.now(timezone.utc)))

    data = json.loads(payload)
    if kind != "bins" or leaf not in ("level", "reorder"):
        return None
    p = (Point(leaf).tag("ue", ue).tag("bin_id", data["bin_id"]).tag("item", data["item"])
         .time(data["ts"]))
    p.field("units", int(data["units"]))
    if leaf == "level":
        p.field("grams", float(data["grams"]))
        p.field("status", int(data["status"]))
        p.field("rop", float(data["rop"]))
        p.field("heartbeat", bool(data.get("heartbeat", False)))
    else:
        p.field("rop", float(data["rop"]))
        p.field("ss", float(data["ss"]))
    for key in ("sim_min", "cycle"):                       # simulated time, for T3.6
        if key in data:
            p.field(key, int(data[key]))
    return p


def handle_message(topic, payload, write):
    """Convert and write one message; never raises (a bad retained message must not crash us)."""
    try:
        point = to_point(topic, payload)
    except Exception as err:  # noqa: BLE001
        log.warning("skipped %s: %s: %s", topic, type(err).__name__, err)
        return False
    if point is None:
        return False
    write(point)
    return True


def mqtt_client(url, user, password, client_id):
    """paho client for mqtt://, mqtts:// or wss:// URLs, MQTT 5, persistent session."""
    u = urlparse(url)
    transport = "websockets" if u.scheme in ("ws", "wss") else "tcp"
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id,
                    protocol=mqtt.MQTTv5, transport=transport)
    if u.scheme in ("mqtts", "wss"):
        c.tls_set(cert_reqs=ssl.CERT_REQUIRED)             # EMQX Cloud uses a public CA
    if transport == "websockets":
        c.ws_set_options(path=u.path or "/mqtt")
    if user:
        c.username_pw_set(user, password)
    c.reconnect_delay_set(1, 30)
    default_port = {"mqtt": 1883, "mqtts": 8883, "ws": 8083, "wss": 8084}[u.scheme]
    return c, u.hostname, u.port or default_port


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    env = os.environ
    influx = InfluxDBClient(url=env["INFLUX_URL"], token=env["INFLUX_TOKEN"], org=env["INFLUX_ORG"])
    writer = influx.write_api(write_options=WriteOptions(batch_size=200, flush_interval=1000,
                                                         retry_interval=5000, max_retries=10))
    bucket = env.get("INFLUX_BUCKET", "smart_kanban")
    count = {"n": 0}

    def on_connect(client, userdata, flags, reason, properties=None):
        log.info("connected to broker (%s), session present=%s", reason, flags.session_present)
        client.subscribe([(t, 1) for t in TOPICS])

    def on_message(client, userdata, msg):
        if handle_message(msg.topic, msg.payload, lambda p: writer.write(bucket=bucket, record=p)):
            count["n"] += 1
            if count["n"] % 100 == 1:
                log.info("%d points written (last: %s)", count["n"], msg.topic)

    user = env.get("INGEST_MQTT_USER") or env.get("MQTT_USER")
    password = env.get("INGEST_MQTT_PASS") or env.get("MQTT_PASS")
    client, host, port = mqtt_client(env["MQTT_URL"], user, password,
                                     env.get("INGEST_CLIENT_ID", "ingest-ue-a"))
    client.on_connect = on_connect
    client.on_message = on_message
    props = Properties(PacketTypes.CONNECT)
    props.SessionExpiryInterval = 86400
    # docker compose stop sends SIGTERM: disconnect cleanly so the write buffer is flushed below
    signal.signal(signal.SIGTERM, lambda *_: client.disconnect())
    log.info("connecting to %s:%s, writing to bucket %s", host, port, bucket)
    client.connect(host, port, keepalive=30, clean_start=False, properties=props)
    try:
        client.loop_forever()
    finally:
        writer.close()             # flushes the points still in the batch
        influx.close()
        log.info("stopped after %d points", count["n"])


if __name__ == "__main__":
    sys.exit(main())
