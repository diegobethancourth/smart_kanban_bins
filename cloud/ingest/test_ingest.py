"""Tests for the MQTT -> InfluxDB mapping (T2.7).  Run:  python -m pytest cloud/ingest"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import handle_message, to_point  # noqa: E402

LEVEL = {"ts": "2026-11-07T20:00:00.000Z", "bin_id": "bin01", "item": "101013101", "units": 2900,
         "grams": 1270.0, "status": 0, "flag": "ok", "rop": 2863.6, "sim_min": 34000, "cycle": 0,
         "heartbeat": False}
REORDER = {"ts": "2026-11-07T20:01:00.000Z", "bin_id": "bin01", "item": "101013101", "units": 2860,
           "rop": 2863.6, "ss": 1130.3, "sim_min": 34300, "cycle": 0}


def test_level_point():
    lp = to_point("css/UE-A/bins/bin01/level", json.dumps(LEVEL).encode()).to_line_protocol()
    assert lp.startswith("level,bin_id=bin01,item=101013101,ue=UE-A ")
    for field in ("units=2900i", "grams=1270", "status=0i", "rop=2863.6", "sim_min=34000i"):
        assert field in lp
    assert lp.endswith(" 1794081600000000000")           # edge timestamp 2026-11-07T20:00Z, in ns


def test_reorder_point():
    lp = to_point("css/UE-A/bins/bin01/reorder", json.dumps(REORDER).encode()).to_line_protocol()
    assert lp.startswith("reorder,bin_id=bin01,item=101013101,ue=UE-A ")
    assert "ss=1130.3" in lp and "units=2860i" in lp


def test_gateway_status():
    lp = to_point("css/UE-A/edge/gw01/status", b"offline").to_line_protocol()
    assert lp.startswith("gateway,gw_id=gw01,ue=UE-A online=0i")


def test_bad_payload_does_not_crash_the_service():
    written = []
    for junk in (b"42", b"not json", json.dumps(dict(LEVEL, units=None)).encode(), b"{}"):
        assert handle_message("css/UE-A/bins/bin01/level", junk, written.append) is False
    assert handle_message("css/UE-A/bins/bin01/level", json.dumps(LEVEL).encode(), written.append)
    assert len(written) == 1


def test_other_topics_ignored():
    assert to_point("css/UE-A/bins/bin01/epcis", b"{}") is None
    assert to_point("other/topic", b"x") is None
