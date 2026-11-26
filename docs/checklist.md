# Privacy and quality checklist (T4.3)

Run before the code freeze (T4.1) and again before submitting (T5.2).
Completed by Diego on 2026-11-15.

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

Second pass on 2026-11-15 (`main` at 85e704e, after the 3D twin, T4.7), files **and full history of all branches**:

- [x] Files: only placeholders (`<your-deployment>.emqxsl.com`, `<region>.cloud2.influxdata.com`, `${MQTT_PASS}`)
  and local-only test values (`local-only-token-change-me`, `local-only-password`); public links to sign-up pages.
- [x] History: the same placeholders and local-only values; no real broker address, user, password or token.
- [x] Real facility name: 0 matches in the files and 0 in the history (also searched with spaces and by word).
- [x] `.env` is ignored by git and was never committed; the twin's Cloud mode keeps its URL and password only in the browser.
- [x] Logos: ASU (course) and CSS (from the CSS dashboards repository) in `docs/twin/img`; tool logos on the slides from Simple Icons (CC0).
- [x] All tests pass (32 Python, 5 JavaScript); `bins.json` and `twin_data.json` up to date.
- [ ] Still to decide (Diego): `docs/index.html`, `data/README.md` and `tools/update_series.py` name the internal source
  folder `REPOSICION_UE_CSS` and the file type `series_saldos`. Not a secret and no facility name; keep or generalise.

If a secret is ever committed: change that password or token in the EMQX / InfluxDB console straight away. Removing it from the history is not enough.

## Code quality

- [x] Every module starts with a header comment saying what it does and which task it belongs to.
- [x] Non-obvious steps are commented (word order, scale factor, round vs floor, hysteresis, stuck rule, store-and-forward).
- [x] Versions are pinned: `pymodbus==3.16.1`, Node-RED `4.1.17`, `modbus-serial@8.0.25`, Grafana `12.0.2`, Mosquitto `2.0.21`, InfluxDB `2.7.11`.

## Sign-off

| Checked by | Date | Result |
|---|---|---|
| Diego | 2026-11-15 | [x] files and full history clean; all tests pass |

## README test (T4.2), 2026-11-15

- [x] Fresh `git clone` of `main` (58af080): `check_config.py` OK, `build_config.py --check` OK, 32 Python tests and 5 JavaScript tests pass.
- [x] On the demo laptop, `git pull` and `docker compose up -d --build` start all four services; dashboard on :3000, Node-RED on :1880 and the 3D twin on :1880/twin/ open as the README says.
