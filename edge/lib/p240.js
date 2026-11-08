/**
 * CSS procedure P-240 reorder-point rule (T2.5).
 *
 *   SS  = z * sigma_d * sqrt(L)
 *   ROP = d_day * L + SS
 *   L = 20 days, z = 1.65 for vital items and 1.28 for the rest
 *
 * d_day and sigma_d use the same window and method as the CSS replenishment
 * dashboard (reposicion_ue.html): demand = stock drops over the last 90 days
 * (d_month / 30), and sigma_d from the week-to-week CV: sigma_d = CV * d_day * sqrt(7).
 *
 * Plain JavaScript with no dependencies, so the same file runs in Node-RED
 * (loaded through functionGlobalContext in settings.js) and in the unit tests.
 */
'use strict';

const DEFAULTS = { L_days: 20, z_vital: 1.65, z_other: 1.28, rearm_margin: 0.10 };

/** Return {d_day, sigma_d, z, ss, rop} for one bin entry of config/bins.json. */
function computeRop(bin, params = DEFAULTS) {
  const p = Object.assign({}, DEFAULTS, params);
  const dDay = bin.d_month / 30;
  const sigmaD = bin.cv_weekly * dDay * Math.sqrt(7);
  const z = bin.vital ? p.z_vital : p.z_other;
  const ss = z * sigmaD * Math.sqrt(p.L_days);
  const rop = dDay * p.L_days + ss;
  return { d_day: dDay, sigma_d: sigmaD, z, ss, rop };
}

/** New hysteresis state for one bin: armed until the first crossing. */
function newState() {
  return { armed: true };
}

/**
 * Check one new unit count against the ROP, with hysteresis.
 *
 * Fires when units fall to or below the ROP while the bin is armed; it then
 * disarms and only re-arms once units rise above ROP * (1 + margin), which
 * normally means a refill. So a noisy reading near the ROP gives one event,
 * not many.
 *
 * Returns {fire, state}; the caller keeps `state` (Node-RED node context).
 */
function check(state, units, rop, margin = DEFAULTS.rearm_margin) {
  const s = Object.assign({}, state || newState());
  let fire = false;
  if (s.armed && units <= rop) {
    fire = true;
    s.armed = false;
  } else if (!s.armed && units > rop * (1 + margin)) {
    s.armed = true;
  }
  return { fire, state: s };
}

/** Event payload published on css/{ue}/bins/{bin_id}/reorder. */
function reorderEvent(bin, units, r, ts) {
  return {
    ts: ts || new Date().toISOString(),
    bin_id: bin.bin,
    item: bin.item,
    units,
    rop: Math.round(r.rop * 10) / 10,
    ss: Math.round(r.ss * 10) / 10,
  };
}

module.exports = { computeRop, newState, check, reorderEvent, DEFAULTS };
