# Privacy and quality checklist (T4.3)

Run before the code freeze (T4.1) and again before submitting (T5.2).
Each member ticks the boxes after checking for themselves.

## Automatic checks

```bash
# 1. secrets in the files
git grep -n -i -E "password|token|secret|emqxsl|influxdata"
# 2. secrets in the history
git log -p | grep -i -E "^\+.*(password|token|secret)\s*[:=]\s*['\"]?[A-Za-z0-9_-]{8,}"
# 3. tests
python -m pytest simulator/tests cloud/ingest
node --test "edge/test/*.test.js"
python tools/check_config.py && python tools/build_config.py --check
```

Result of the pass on 2026-11-07 (branch `feat/complete-pipeline`):

- [x] No real password, token or broker address in any file: only placeholders (`${MQTT_USER}`, `<your-deployment>`) and variable names.
- [x] No secret in the history. The only match is the commented-out example `//credentialSecret: "a-secret-key"` from the default Node-RED settings file.
- [x] `edge/flows_cred.json` holds only `${MQTT_USER}` / `${MQTT_PASS}`. **Never type the real password in the Node-RED editor**: `credentialSecret: false` would save it in plain text in that file.
- [x] No facility name: the facility is `UE-A` everywhere; no people, suppliers or prices in `data/`.
- [x] All tests pass (32 Python, 5 JavaScript).
- [ ] To decide: `docs/index.html` (work plan, T1.3) names the internal source folder `REPOSICION_UE_CSS` and the file type `series_saldos`. Not a secret, but it is an internal CSS path name.

If a secret is ever committed: change that password or token in the EMQX / InfluxDB console straight away. Removing it from the history is not enough.

## Code quality

- [x] Every module starts with a header comment saying what it does and which task it belongs to.
- [x] Non-obvious steps are commented (word order, scale factor, round vs floor, hysteresis, stuck rule, store-and-forward).
- [x] Versions are pinned: `pymodbus==3.16.1`, Node-RED `4.1.17`, `modbus-serial@8.0.25`, Grafana `12.0.2`, Mosquitto `2.0.21`, InfluxDB `2.7.11`.

## Sign-off

| Member | Date | Signed |
|---|---|---|
| Diego | | [ ] |
| Dhansukh | | [ ] |
| Febylina | | [ ] |
