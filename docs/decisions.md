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
