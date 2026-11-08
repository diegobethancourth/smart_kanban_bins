/**
 * Unit tests for edge/lib/p240.js (T2.5).   Run:  node --test "edge/test/*.test.js"
 *
 * DASHBOARD holds the SS and ROP that the CSS replenishment dashboard
 * (reposicion_ue.html) showed for the six shortlisted items at UE-A, as
 * extracted with the series in T1.3. Our function must agree within rounding.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const p240 = require('../lib/p240.js');

const cfg = require(path.join(__dirname, '..', '..', 'config', 'bins.json'));

const DASHBOARD = {
  bin01: { ss: 1130.4, rop: 2863.8 },
  bin02: { ss: 2735.1, rop: 12457.5 },
  bin03: { ss: 26.9, rop: 79.9 },
  bin04: { ss: 43.1, rop: 132.0 },
  bin05: { ss: 4.5, rop: 16.1 },
  bin06: { ss: 20.2, rop: 70.6 },
};

test('ROP equals the CSS dashboard for every item, within rounding', () => {
  for (const bin of cfg.bins) {
    const r = p240.computeRop(bin, cfg.p240);
    const ref = DASHBOARD[bin.bin];
    // CV is stored with 3 decimals, so allow 0.2 % (bin02: 12453.9 vs 12457.5)
    assert.ok(Math.abs(r.rop - ref.rop) <= Math.max(0.15, 0.002 * ref.rop),
      `${bin.bin}: ROP ${r.rop.toFixed(1)} vs dashboard ${ref.rop}`);
    assert.ok(Math.abs(r.ss - ref.ss) <= Math.max(0.15, 0.002 * ref.ss),
      `${bin.bin}: SS ${r.ss.toFixed(1)} vs dashboard ${ref.ss}`);
  }
});

test('z is 1.65 for vital items and 1.28 for the rest', () => {
  assert.strictEqual(p240.computeRop({ d_month: 30, cv_weekly: 0.5, vital: true }).z, 1.65);
  assert.strictEqual(p240.computeRop({ d_month: 30, cv_weekly: 0.5, vital: false }).z, 1.28);
});

test('one event per crossing, even with noise around the ROP', () => {
  const rop = 100;
  let state = p240.newState();
  let events = 0;
  // falls through the ROP with +-2 units of noise, stays near it, then refills
  const series = [130, 120, 110, 102, 99, 101, 98, 100, 97, 103, 96, 90, 80, 200, 150, 120, 105, 95];
  for (const u of series) {
    const r = p240.check(state, u, rop, 0.10);
    state = r.state;
    if (r.fire) events += 1;
  }
  // first crossing at 99, re-arm after the refill to 200 (> 110), second crossing at 95
  assert.strictEqual(events, 2);
});

test('no re-arm until units rise above ROP plus the margin', () => {
  let state = p240.check(p240.newState(), 90, 100).state;   // fired, disarmed
  state = p240.check(state, 108, 100, 0.10).state;           // 108 < 110: still disarmed
  assert.strictEqual(p240.check(state, 95, 100, 0.10).fire, false);
  state = p240.check(state, 111, 100, 0.10).state;           // re-armed
  assert.strictEqual(p240.check(state, 99, 100, 0.10).fire, true);
});

test('event payload has the agreed fields', () => {
  const bin = cfg.bins[0];
  const e = p240.reorderEvent(bin, 2800, p240.computeRop(bin), '2026-11-07T00:00:00Z');
  assert.deepStrictEqual(Object.keys(e), ['ts', 'bin_id', 'item', 'units', 'rop', 'ss']);
  assert.strictEqual(e.bin_id, 'bin01');
});
