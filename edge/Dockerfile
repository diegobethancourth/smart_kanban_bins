# Node-RED edge gateway with the Modbus client library built in.
# The edge/ folder (flows, settings, lib/) is mounted on /data by docker-compose.yml.
FROM nodered/node-red:4.1.17-22

# modbus-serial: Modbus TCP client used by the "Modbus poll" function node (see docs/decisions.md)
RUN npm install --no-audit --no-fund --omit=dev modbus-serial@8.0.25
