// T4.7 - 3D digital twin of the Smart Kanban shelf at UE-A.
//
// One scene, three data sources that all end up as the same three message types:
//   reading      {bin_id, units, status, sim_min, cycle}   one reading of one load cell
//   sent         {topic, payload}                          a message that left the gateway
//   node_status  {node, fill, text}                        broker link / store-and-forward queue
//
//   Replay       in the browser, from twin_data.json (same series and P-240 values as the
//                simulator and the edge); faults and a network cut can be switched on.
//   Edge (local) the Node-RED websocket ws://<edge>:1880/ws/twin (flow node "3D twin feed").
//   Cloud (MQTT) EMQX Cloud over secure WebSocket: retained levels, reorders, gateway status.
//
// Libraries are vendored in ./vendor (three 0.186.1, mqtt 5.16.1) so the page works offline.

import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from './vendor/CSS2DRenderer.js';

const DATA = await (await fetch('./twin_data.json')).json();
const UE = DATA.ue;
const FIRST = new Date(DATA.first_date + 'T00:00:00');
const LAST_DAY = Math.round((new Date(DATA.last_date + 'T00:00:00') - FIRST) / 864e5);
const params = new URLSearchParams(location.search);
if (params.get('panel') === '0') document.body.classList.add('nopanel');

const COLORS = {
  maroon: 0x8C1D40, gold: 0xFFC627,
  ok: 0xBFE3CA, low: 0xFFE08A, flag: 0xF2AAAA, idle: 0xDDDAD5,
  metal: 0xB9BEC6, metalDark: 0x3A3F47, floor: 0xEDEAE5,
  reading: 0x6F9FD8, level: 0x8C1D40, reorder: 0xFFC627, epcis: 0x5FAF7A, status: 0x9C7BD1,
};
const ITEM_TINT = [0xFFF4D6, 0xFFFFFF, 0xE6F0FB, 0xF3E8FA, 0xFDE6D8, 0xE3F4E8];

// ---------------------------------------------------------------- renderer, scene, camera
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.prepend(renderer.domElement);

const labelRenderer = new CSS2DRenderer({ element: document.getElementById('labels') });

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xF4F2EF);
scene.fog = new THREE.Fog(0xF4F2EF, 6, 14);

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
camera.position.set(1.05, 1.45, 3.25);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0.38, 0.82, -0.1);
controls.enableDamping = true;
controls.minDistance = 1.2; controls.maxDistance = 6;
controls.maxPolarAngle = Math.PI * 0.49;

scene.add(new THREE.HemisphereLight(0xffffff, 0xD9D2C8, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(2.2, 3.5, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -2, right: 2.5, top: 2.5, bottom: -1, near: 0.5, far: 10 });
sun.shadow.bias = -0.0005;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xFFF1E0, 0.6);
fill.position.set(-2.5, 1.5, 1.5);
scene.add(fill);

const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 64),
  new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

// ---------------------------------------------------------------- the shelf
const BW = 0.42, BD = 0.50, BH = 0.30, WALL = 0.008, PLATE = 0.02;
const DECKS = [0.06, 0.60, 1.14];                 // top surface of each shelf deck
const COLS = [-0.5, 0, 0.5];
const metal = new THREE.MeshStandardMaterial({ color: COLORS.metal, metalness: 0.55, roughness: 0.4 });
const dark = new THREE.MeshStandardMaterial({ color: COLORS.metalDark, metalness: 0.4, roughness: 0.5 });

function box(w, h, d, mat, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}
for (const x of [-0.81, 0.81]) for (const z of [-0.29, 0.29]) box(0.035, 1.22, 0.035, metal, x, 0.61, z);
for (const y of DECKS) {
  box(1.66, 0.025, 0.62, metal, 0, y - 0.0125, 0);
  box(1.66, 0.045, 0.02, metal, 0, y - 0.03, 0.30);            // front lip
}

// bins: top row bin01-03, bottom row bin04-06 (same order as the Modbus unit IDs)
function kindOf(name) {
  if (/tablet/i.test(name)) return 'box';
  if (/injection/i.test(name)) return 'vial';
  return 'bottle';
}
const SLOT = {           // item size and grid inside a bin
  box:    { nx: 4, nz: 4, layers: 5, w: 0.085, h: 0.05, d: 0.105 },
  vial:   { nx: 7, nz: 8, layers: 3, w: 0.048, h: 0.075, d: 0.048 },
  bottle: { nx: 4, nz: 5, layers: 2, w: 0.075, h: 0.125, d: 0.075 },
};

const bins = new Map();
const pickables = [];
DATA.bins.forEach((cfg, i) => {
  const col = i % 3, row = i < 3 ? 1 : 0;
  const x = COLS[col], base = DECKS[row];
  const g = new THREE.Group();
  g.position.set(x, base, 0);
  scene.add(g);

  // load-cell plate with the sensor puck and a status LED
  box(BW - 0.02, PLATE, BD - 0.02, dark, 0, PLATE / 2, 0, g);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x2ecc71, emissiveIntensity: 1.5 }));
  led.position.set(BW / 2 - 0.035, PLATE / 2, BD / 2 - 0.008);
  g.add(led);

  // translucent plastic bin, open at the top
  const binMat = new THREE.MeshStandardMaterial({ color: COLORS.ok, transparent: true, opacity: 0.42,
    roughness: 0.35, depthWrite: false, side: THREE.DoubleSide, emissive: COLORS.gold, emissiveIntensity: 0 });
  const y0 = PLATE;
  const walls = [
    box(BW, WALL, BD, binMat, 0, y0 + WALL / 2, 0, g),
    box(BW, BH, WALL, binMat, 0, y0 + BH / 2, -BD / 2, g),
    box(BW, BH * 0.72, WALL, binMat, 0, y0 + BH * 0.36, BD / 2, g),          // lower front (Kanban bin lip)
    box(WALL, BH, BD, binMat, -BW / 2, y0 + BH / 2, 0, g),
    box(WALL, BH, BD, binMat, BW / 2, y0 + BH / 2, 0, g),
  ];
  walls.forEach(w => { w.castShadow = false; w.renderOrder = 2; });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BW, BH, BD)),
    new THREE.LineBasicMaterial({ color: 0x6b7280, transparent: true, opacity: 0.35 }));
  edges.position.set(0, y0 + BH / 2, 0);
  g.add(edges);

  // contents: one instance per slot, shown from the bottom layer up
  const kind = kindOf(cfg.name), s = SLOT[kind];
  const geo = kind === 'box' ? new THREE.BoxGeometry(s.w * 0.92, s.h * 0.92, s.d * 0.92)
    : new THREE.CylinderGeometry(s.w * 0.42, s.w * 0.42, s.h * 0.9, 18);
  const itemMat = new THREE.MeshStandardMaterial({ color: ITEM_TINT[i % ITEM_TINT.length], roughness: 0.55 });
  const slots = s.nx * s.nz * s.layers;
  const inst = new THREE.InstancedMesh(geo, itemMat, slots);
  inst.castShadow = true; inst.receiveShadow = true;
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  const tint = new THREE.Color(ITEM_TINT[i % ITEM_TINT.length]);
  const gx = (BW - 0.03) / s.nx, gz = (BD - 0.03) / s.nz;
  let k = 0;
  for (let L = 0; L < s.layers; L++) for (let iz = 0; iz < s.nz; iz++) for (let ix = 0; ix < s.nx; ix++) {
    m4.makeTranslation(-BW / 2 + 0.015 + gx * (ix + 0.5), y0 + WALL + s.h * (L + 0.5), -BD / 2 + 0.015 + gz * (iz + 0.5));
    inst.setMatrixAt(k, m4);
    c.copy(tint).multiplyScalar(0.9 + 0.1 * (((ix + iz + L) % 3) / 2));
    inst.setColorAt(k, c);
    k++;
  }
  inst.count = 0;
  inst.frustumCulled = false;            // the count changes all the time; skip the bounding-sphere cull
  g.add(inst);
  let caps = null;
  if (kind === 'bottle') {                    // coloured caps make the syrup bottles read as bottles
    caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(s.w * 0.2, s.w * 0.2, 0.025, 12),
      new THREE.MeshStandardMaterial({ color: COLORS.maroon, roughness: 0.4 }), slots);
    const p = new THREE.Vector3();
    for (let j = 0; j < slots; j++) {
      inst.getMatrixAt(j, m4); p.setFromMatrixPosition(m4);
      m4.makeTranslation(p.x, p.y + s.h * 0.45 + 0.012, p.z);
      caps.setMatrixAt(j, m4);
    }
    caps.count = 0;
    caps.frustumCulled = false;
    g.add(caps);
  }

  // capacity shown: a full bin is a little above the highest stock in the series
  const capacity = cfg.max_stock * 1.15;
  const perLayer = s.nx * s.nz;
  const ropH = Math.min(BH - 0.01, (cfg.ROP / capacity) * slots / perLayer * s.h);

  // gold ring at the reorder point (thin strips, so it reads at any zoom)
  const ringMat = new THREE.MeshStandardMaterial({ color: COLORS.gold, emissive: COLORS.gold, emissiveIntensity: 0.55 });
  const ring = new THREE.Group();
  const t = 0.007, ry = y0 + WALL + ropH;
  box(BW + 0.012, t, t, ringMat, 0, ry, BD / 2 + 0.005, ring);
  box(BW + 0.012, t, t, ringMat, 0, ry, -BD / 2 - 0.005, ring);
  box(t, t, BD + 0.012, ringMat, -BW / 2 - 0.005, ry, 0, ring);
  box(t, t, BD + 0.012, ringMat, BW / 2 + 0.005, ry, 0, ring);
  ring.children.forEach(m => { m.castShadow = false; });
  g.add(ring);

  // label above the bin
  const el = document.createElement('div');
  el.className = 'tag';
  el.innerHTML = `<div class="t1">${cfg.bin} · ${shortName(cfg.name)}</div>
    <div class="t2"><b class="u">—</b> <span>units · ROP ${fmt(cfg.ROP)}</span></div>
    <div class="t3 s">waiting for data</div>`;
  el.style.pointerEvents = 'auto';
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => select(cfg.bin));
  const tag = new CSS2DObject(el);
  tag.position.set(0, y0 + BH + 0.03, BD / 2 - 0.05);
  tag.center.set(0.5, 1);
  g.add(tag);

  // invisible box used for clicking
  const hit = new THREE.Mesh(new THREE.BoxGeometry(BW, BH + PLATE, BD), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(0, (BH + PLATE) / 2, 0);
  hit.userData.bin = cfg.bin;
  g.add(hit);
  pickables.push(hit);

  bins.set(cfg.bin, {
    cfg, g, inst, caps, slots, capacity, binMat, ringMat, led, el,
    portWorld: new THREE.Vector3(x + BW / 2 - 0.035, base + PLATE / 2, BD / 2 - 0.01),
    shown: null, target: null, status: null, low: false, flashUntil: 0, lastReading: 0,
  });
});

// ---------------------------------------------------------------- gateway, cables and the cloud
const GW = new THREE.Vector3(0.97, 0.92, 0.02);
const gw = new THREE.Group();
gw.position.copy(GW);
scene.add(gw);
box(0.22, 0.15, 0.08, dark, 0.04, 0, 0, gw);
box(0.006, 0.12, 0.006, dark, 0.13, 0.13, -0.02, gw);                       // antenna
const gwLed = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0x999999, emissive: 0x999999, emissiveIntensity: 1.2 }));
gwLed.position.set(0.11, 0.045, 0.042);
gw.add(gwLed);
const screenMat = new THREE.MeshBasicMaterial({ color: 0x1b2430 });
box(0.12, 0.06, 0.002, screenMat, 0.0, 0.01, 0.041, gw).castShadow = false;
const gwEl = document.createElement('div');
gwEl.className = 'ptag';
gwEl.innerHTML = '<b>gw01</b> · Node-RED edge<br><span class="q">Modbus TCP → P-240 → MQTT 5</span>';
const gwTag = new CSS2DObject(gwEl);
gwTag.position.set(0.04, 0.1, 0); gwTag.center.set(0.5, 1);
gw.add(gwTag);
const GW_PORT = GW.clone().add(new THREE.Vector3(-0.07, -0.05, 0.04));
const GW_UP = GW.clone().add(new THREE.Vector3(0.13, 0.19, -0.02));

const cableMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.7 });
for (const b of bins.values()) {
  const p = b.portWorld, y = p.y - 0.003;
  b.cable = new THREE.CatmullRomCurve3([
    p.clone(), new THREE.Vector3(p.x + 0.02, y, 0.27), new THREE.Vector3(0.74, y, 0.27),
    new THREE.Vector3(0.83, (y + GW_PORT.y) / 2, 0.2), GW_PORT.clone(),
  ]);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(b.cable, 64, 0.0035, 6, false), cableMat);
  tube.castShadow = true;
  scene.add(tube);
}

const CLOUD = new THREE.Vector3(1.45, 1.72, -0.55);
const cloud = new THREE.Group();
cloud.position.copy(CLOUD);
const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0.15 });
[[0, 0, 0, 0.2], [0.2, -0.03, 0.02, 0.15], [-0.2, -0.04, 0, 0.14], [0.08, 0.12, 0, 0.14], [-0.08, 0.07, 0.05, 0.13]]
  .forEach(([x, y, z, r]) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), cloudMat); s.position.set(x, y, z); cloud.add(s); });
scene.add(cloud);
const cloudEl = document.createElement('div');
cloudEl.className = 'ptag';
cloudEl.innerHTML = '<b>EMQX Cloud</b> · MQTT 5 / TLS<br>→ InfluxDB Cloud → Grafana';
const cloudTag = new CSS2DObject(cloudEl);
cloudTag.position.set(0, -0.2, 0.1); cloudTag.center.set(0.5, 0);
cloud.add(cloudTag);

const upCurve = new THREE.CatmullRomCurve3([GW_UP, new THREE.Vector3(1.22, 1.38, -0.15), CLOUD.clone().add(new THREE.Vector3(-0.12, -0.12, 0.05))]);
const upMat = new THREE.LineDashedMaterial({ color: COLORS.maroon, dashSize: 0.04, gapSize: 0.03, transparent: true, opacity: 0.6 });
const upLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(upCurve.getPoints(80)), upMat);
upLine.computeLineDistances();
scene.add(upLine);

// ---------------------------------------------------------------- packets
const packets = [];
const PACKET_GEO = new THREE.SphereGeometry(1, 16, 12);
function packet(curve, color, r, dur, onDone) {
  if (packets.length > 400) return;                          // keep the scene light during a backlog burst
  const m = new THREE.Mesh(PACKET_GEO, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9 }));
  m.scale.setScalar(r);
  scene.add(m);
  packets.push({ m, curve, t0: performance.now(), dur: dur * 1000, onDone });
}
function stepPackets(now) {
  for (let i = packets.length - 1; i >= 0; i--) {
    const p = packets[i], u = Math.max(0, (now - p.t0) / p.dur);
    if (u >= 1) {
      scene.remove(p.m); p.m.material.dispose(); packets.splice(i, 1);
      if (p.onDone) p.onDone();
      continue;
    }
    p.m.position.copy(p.curve.getPointAt(u));
  }
}

// ---------------------------------------------------------------- state and UI
const ui = {
  date: document.getElementById('date'), day: document.getElementById('day'),
  gw: document.getElementById('c-gw'), broker: document.getElementById('c-broker'), msgs: document.getElementById('c-msgs'),
  bins: document.getElementById('bins'), log: document.getElementById('log'), note: document.getElementById('srcnote'),
  banner: document.getElementById('banner'),
};
const state = { simMin: null, cycle: 0, sent: 0, broker: null, queue: 0, gateway: null, lastMsg: 0, selected: null };

for (const b of bins.values()) {
  const row = document.createElement('div');
  row.className = 'bin';
  row.innerHTML = `<div class="nm">${b.cfg.bin} · ${shortName(b.cfg.name)}</div><div class="u">—</div>
    <div class="sub">ROP ${fmt(b.cfg.ROP)} · SS ${fmt(b.cfg.SS)}${b.cfg.vital ? ' · vital' : ''}</div><div class="st">—</div>
    <div class="bar"><i></i></div>
    <div class="detail"><table>
      <tr><td>Item (SALMI code)</td><td>${b.cfg.item}</td></tr>
      <tr><td>Average demand d̄</td><td>${fmt(b.cfg.d_day, 1)} units/day</td></tr>
      <tr><td>Lead time L</td><td>${DATA.p240.L_days} days</td></tr>
      <tr><td>Service factor z</td><td>${b.cfg.vital ? DATA.p240.z_vital : DATA.p240.z_other}</td></tr>
      <tr><td>Safety stock z·σd·√L</td><td>${fmt(b.cfg.SS)} units</td></tr>
      <tr><td>ROP d̄·L + SS</td><td>${fmt(b.cfg.ROP)} units</td></tr>
      <tr><td>Unit weight · tare</td><td>${b.cfg.unit_g} g · ${b.cfg.tare_g} g</td></tr>
    </table></div>`;
  row.addEventListener('click', () => select(state.selected === b.cfg.bin ? null : b.cfg.bin));
  ui.bins.appendChild(row);
  b.row = row;
}

function select(binId) {
  state.selected = binId;
  for (const b of bins.values()) {
    const on = b.cfg.bin === binId;
    b.row.classList.toggle('sel', on);
    b.el.classList.toggle('sel', on);
  }
  if (binId) bins.get(binId).row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObjects(pickables)[0];
  select(hit ? hit.object.userData.bin : null);
});

function log(text, cls = '') {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = `<span class="when">${state.simMin != null ? simDate(state.simMin, true) : '—'}</span>${text}`;
  ui.log.prepend(d);
  while (ui.log.children.length > 60) ui.log.lastChild.remove();
}

function setChip(el, cls, text) { el.className = 'chip ' + cls; el.textContent = text; }

function refreshChips() {
  const stale = state.lastMsg && performance.now() - state.lastMsg > 6000;
  if (!state.lastMsg) setChip(ui.gw, '', 'gateway: waiting');
  else if (state.gateway === 'offline') setChip(ui.gw, 'flag', 'gateway offline (last will)');
  else if (stale) setChip(ui.gw, 'flag', 'no data for ' + Math.round((performance.now() - state.lastMsg) / 1000) + ' s');
  else setChip(ui.gw, 'ok', 'gateway online');
  if (state.broker === true && state.queue > 0) setChip(ui.broker, 'low', `sending backlog: ${state.queue}`);
  else if (state.broker === true) setChip(ui.broker, 'ok', 'broker connected');
  else if (state.broker === false) setChip(ui.broker, 'flag', `broker down: ${state.queue} queued`);
  else setChip(ui.broker, '', 'broker —');
  setChip(ui.msgs, 'info', `${state.sent.toLocaleString('en-US')} messages sent`);
  const down = state.broker === false || state.gateway === 'offline';
  ui.banner.style.display = down ? 'block' : 'none';
  ui.banner.textContent = state.gateway === 'offline' ? 'Gateway offline: last will received'
    : `Network down: the gateway keeps ${state.queue} message${state.queue === 1 ? '' : 's'} on disk and sends them when the broker is back`;
  const c = state.gateway === 'offline' || stale ? 0xd64545 : state.broker === false ? 0xd64545
    : state.queue > 0 ? 0xf0b400 : state.lastMsg ? 0x2ecc71 : 0x999999;
  gwLed.material.color.setHex(c); gwLed.material.emissive.setHex(c);
  upMat.color.setHex(state.broker === false ? 0xd64545 : COLORS.maroon);
  cloudMat.color.setHex(state.broker === false ? 0xC9CDD3 : 0xffffff);
}
setInterval(refreshChips, 1000);

function simDate(min, short) {
  const d = new Date(FIRST.getTime() + min * 60000);
  if (short) return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(',', '')
    + ' · ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// ---------------------------------------------------------------- applying messages
function onReading(p, animate = true) {
  const b = bins.get(p.bin_id);
  if (!b) return;
  state.lastMsg = performance.now();
  if (p.sim_min != null) {
    if (state.simMin != null && p.cycle != null && p.cycle !== state.cycle) log(`Replay restarted (cycle ${p.cycle})`, 'net');
    state.simMin = p.sim_min; state.cycle = p.cycle ?? state.cycle;
  }
  const prevStatus = b.status;
  b.target = p.units;
  if (b.shown == null) b.shown = p.units;
  b.status = p.status ?? 0;
  if (prevStatus != null && prevStatus !== b.status) {
    if (b.status === 1) log(`<b>${b.cfg.bin}</b> sensor reports a fault: flagged, no reorder`, 'flag');
    else if (b.status === 2) log(`<b>${b.cfg.bin}</b> reading frozen while demand continues: stuck sensor flagged`, 'flag');
    else log(`<b>${b.cfg.bin}</b> sensor back to normal`, '');
  }
  const now = performance.now();
  if (animate && now - b.lastReading > 900) {               // one Modbus packet per bin per second at most
    b.lastReading = now;
    packet(b.cable, COLORS.reading, 0.007, 0.8);
  }
  paintBin(b);
}

function onSent(topic, payload, fromCloud = false) {
  state.sent++;
  state.lastMsg = performance.now();
  const parts = topic.split('/');
  const kind = parts[parts.length - 1];
  if (kind === 'status') {
    const v = typeof payload === 'string' ? payload : String(payload);
    if (v !== state.gateway) log(`Gateway ${v}${v === 'offline' ? ' (MQTT last will or close message)' : ''}`, v === 'offline' ? 'flag' : 'net');
    state.gateway = v;
    packet(upCurve, COLORS.status, 0.012, 1.2);
    refreshChips();
    return;
  }
  if (state.gateway == null) state.gateway = 'online';
  const p = typeof payload === 'string' ? safeJson(payload) : payload;
  if (!p) return;
  if (kind === 'level') {
    if (fromCloud) onReading(p, false);                     // from the cloud the level is all we get
    packet(upCurve, COLORS.level, 0.012, 1.3);
  } else if (kind === 'reorder') {
    const b = bins.get(p.bin_id);
    packet(upCurve, COLORS.reorder, 0.024, 1.8);
    if (b) {
      b.flashUntil = performance.now() + 4000;
      if (p.sim_min != null) state.simMin = Math.max(state.simMin ?? 0, p.sim_min);
      log(`<b>Reorder ${b.cfg.bin}</b> ${shortName(b.cfg.name)}: ${fmt(p.units)} ≤ ROP ${fmt(p.rop)} → EPCIS event`, 'reorder');
      burst(b, `REORDER ${fmt(p.units)} ≤ ${fmt(p.rop)}`);
    }
  } else if (kind === 'epcis') {
    setTimeout(() => packet(upCurve, COLORS.epcis, 0.014, 1.5), 250);
  }
}

function onNodeStatus(s) {
  if (s.node === 'mqtt_out') {
    const up = s.fill === 'green';
    if (state.broker === true && !up) log('Broker connection lost: store-and-forward queues the messages', 'net');
    if (state.broker === false && up) log('Broker back: sending the queued messages in order', 'net');
    state.broker = up;
  } else if (s.node === 'fn_sf') {
    const m = /(\d+) queued/.exec(s.text || '');
    state.queue = m ? Number(m[1]) : 0;
    if (/connected/.test(s.text || '')) state.queue = 0;
  }
  refreshChips();
}

function handle(m) {
  if (m.type === 'reading') onReading(m.payload);
  else if (m.type === 'sent') onSent(m.topic, m.payload);
  else if (m.type === 'node_status') onNodeStatus(m);
}

function burst(b, text) {
  const el = document.createElement('div');
  el.className = 'burst';
  el.textContent = text;
  const o = new CSS2DObject(el);
  o.position.set(0, PLATE + BH + 0.18, BD / 2 - 0.05);
  o.center.set(0.5, 1);
  b.g.add(o);
  const t0 = performance.now();
  (function rise() {
    const u = (performance.now() - t0) / 2600;
    o.position.y = PLATE + BH + 0.18 + u * 0.18;
    el.style.opacity = String(Math.max(0, 1 - Math.max(0, u - 0.6) / 0.4));
    if (u < 1) requestAnimationFrame(rise); else { b.g.remove(o); el.remove(); }
  })();
}

function paintBin(b) {
  const units = b.target;
  if (units == null) return;
  const low = units <= b.cfg.ROP;
  const cls = b.status ? 'flag' : low ? 'low' : 'ok';
  b.binMat.color.setHex(b.status ? COLORS.flag : low ? COLORS.low : COLORS.ok);
  b.led.material.color.setHex(b.status ? 0xd64545 : 0x2ecc71);
  b.led.material.emissive.setHex(b.status ? 0xd64545 : 0x2ecc71);
  const flag = b.status === 1 ? 'sensor fault · flagged' : b.status === 2 ? 'stuck sensor · flagged' : low ? 'at or below ROP' : 'OK';
  b.el.className = 'tag ' + cls + (state.selected === b.cfg.bin ? ' sel' : '');
  b.el.querySelector('.u').textContent = fmt(units);
  b.el.querySelector('.s').textContent = flag + ' · ' + fmt(units * b.cfg.unit_g / 1000 + b.cfg.tare_g / 1000, 2) + ' kg';
  b.row.className = 'bin ' + cls + (state.selected === b.cfg.bin ? ' sel' : '');
  b.row.querySelector('.u').textContent = fmt(units);
  b.row.querySelector('.st').textContent = flag;
  b.row.querySelector('.bar i').style.width = Math.min(100, 100 * units / b.capacity) + '%';
}

// ---------------------------------------------------------------- animation loop
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (source && source.tick) source.tick(dt);
  for (const b of bins.values()) {
    if (b.target == null) continue;
    b.shown += (b.target - b.shown) * Math.min(1, dt * 4);   // ease the visible stock toward the reading
    const n = Math.max(b.target > 0 ? 1 : 0, Math.round(Math.min(1, b.shown / b.capacity) * b.slots));
    b.inst.count = n;
    if (b.caps) b.caps.count = n;
    const fl = b.flashUntil > now ? (Math.sin(now / 90) * 0.5 + 0.5) : 0;
    b.binMat.emissiveIntensity = fl * 0.9;
    b.ringMat.emissiveIntensity = 0.55 + fl * 1.2;
  }
  upMat.dashOffset -= dt * 0.08;
  stepPackets(now);
  if (state.simMin != null) {
    ui.date.textContent = simDate(state.simMin);
    ui.day.textContent = `day ${Math.floor(state.simMin / 1440) + 1} of ${LAST_DAY + 1}`;
  }
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- data sources
let source = null;

// Replay in the browser: same series, ROP, hysteresis, deadband and fault rules as the chain.
class Replay {
  constructor() {
    this.speed = Number(params.get('speed')) || 1;     // simulated days per real second
    this.playing = true; this.faults = { stuck: false, hard: false, net: false };
    this.reset();
  }
  reset(cycle = 0) {
    this.t = Number(params.get('day')) || 0; this.cycle = cycle; this.acc = 0; this.queue = [];
    this.st = {};
    for (const b of DATA.bins) this.st[b.bin] = { armed: true, pub: null, pubStatus: null, pubAt: 0, frozen: null, frozenAt: 0 };
    this.broker = true;
    onNodeStatus({ node: 'mqtt_out', fill: 'green' });
    onNodeStatus({ node: 'fn_sf', text: 'broker connected' });
    onSent(`css/${UE}/edge/${DATA.gw_id}/status`, 'online');
  }
  stock(bin, day) {
    const pts = DATA.series[bin];
    let i = 0;
    while (i < pts.length - 1 && pts[i + 1][0] <= day) i++;
    if (i >= pts.length - 1) return pts[pts.length - 1][1];
    const [d0, s0] = pts[i], [d1, s1] = pts[i + 1];
    if (s1 >= s0) return s0;                            // a receipt arrives on the report date
    const u = (day - d0) / (d1 - d0);
    const wobble = 0.08 * Math.sin(day * 17 + bin.charCodeAt(4)) * u * (1 - u);   // demand is not a straight line
    return Math.round(s0 + (s1 - s0) * Math.min(1, Math.max(0, u + wobble)));
  }
  send(m) {
    if (!this.broker) { this.queue.push(m); onNodeStatus({ node: 'fn_sf', text: `broker down: ${this.queue.length} queued` }); return; }
    onSent(m.topic, m.payload);
  }
  tick(dt) {
    // network cut / restore, with the store-and-forward flush in batches of 50 every 100 ms
    if (this.faults.net === this.broker) {
      this.broker = !this.faults.net;
      onNodeStatus({ node: 'mqtt_out', fill: this.broker ? 'green' : 'red' });
    }
    if (this.broker && this.queue.length) {
      this.flushAcc = (this.flushAcc || 0) + dt;
      if (this.flushAcc >= 0.1) {
        this.flushAcc = 0;
        this.queue.splice(0, 50).forEach(m => onSent(m.topic, m.payload));
        onNodeStatus({ node: 'fn_sf', text: this.queue.length ? `sending backlog: ${this.queue.length} queued` : 'broker connected' });
      }
    }
    if (!this.playing) return;
    this.acc += dt;
    if (this.acc < 0.1) return;                         // one poll every 100 ms of real time
    const step = this.acc; this.acc = 0;
    this.t += step * this.speed;
    if (this.t > LAST_DAY) { this.reset(this.cycle + 1); return; }
    const sim_min = Math.round(this.t * 1440);
    for (const b of DATA.bins) {
      const s = this.st[b.bin];
      let units = this.stock(b.bin, this.t);
      let status = 0;
      if (this.faults.hard && b.bin === 'bin05') status = 1;
      if (this.faults.stuck && b.bin === 'bin03') {
        if (s.frozen == null) { s.frozen = units; s.frozenAt = this.t; }
        units = s.frozen;
        // same rule as the edge: unchanged for a while although demand says units should be gone
        if ((this.t - s.frozenAt) * b.d_day >= DATA.edge.stuck_min_expected_units && this.t - s.frozenAt > 0.5) status = 2;
      } else s.frozen = null;
      onReading({ bin_id: b.bin, units, status, sim_min, cycle: this.cycle });
      // level: deadband, status change or heartbeat (60 s at 10 s per simulated day = 6 days)
      const now = this.t;
      if (s.pub == null || Math.abs(units - s.pub) >= b.deadband_units || status !== s.pubStatus || now - s.pubAt >= 6) {
        s.pub = units; s.pubStatus = status; s.pubAt = now;
        this.send({ topic: `css/${UE}/bins/${b.bin}/level`, payload: { bin_id: b.bin, units, status, rop: b.ROP, sim_min, cycle: this.cycle } });
      }
      // P-240 with hysteresis; a flagged bin never orders
      if (status === 0) {
        if (s.armed && units <= b.ROP) {
          s.armed = false;
          const ev = { bin_id: b.bin, item: b.item, units, rop: b.ROP, ss: b.SS, sim_min, cycle: this.cycle };
          this.send({ topic: `css/${UE}/bins/${b.bin}/reorder`, payload: ev });
          this.send({ topic: `css/${UE}/bins/${b.bin}/epcis`, payload: { type: 'ObjectEvent' } });
        } else if (!s.armed && units > b.ROP * (1 + DATA.p240.rearm_margin)) s.armed = true;
      }
    }
  }
  stop() {}
}

class LocalEdge {
  constructor() {
    const def = location.port === '1880' || /\/twin\/?$/.test(location.pathname) && !/github\.io$/.test(location.hostname)
      ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/twin` : 'ws://localhost:1880/ws/twin';
    this.url = params.get('ws') || def;
    this.open();
  }
  open() {
    note(`Listening to <code>${this.url}</code> (Node-RED flow node "3D twin feed")`);
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = e => { const m = safeJson(e.data); if (m) handle(m); };
    this.ws.onopen = () => { note(`Connected to the edge at <code>${this.url}</code>`); state.broker = state.broker ?? null; };
    this.ws.onclose = () => {
      if (this.stopped) return;
      note(`Edge not reachable at <code>${this.url}</code>. Start it with <code>docker compose up</code>; retrying…`);
      this.retry = setTimeout(() => this.open(), 3000);
    };
  }
  stop() { this.stopped = true; clearTimeout(this.retry); try { this.ws.close(); } catch (e) { /* closed */ } }
}

class Cloud {
  constructor(cfg) {
    this.cfg = cfg;
    this.start();
  }
  async start() {
    const { default: mqtt } = await import('./vendor/mqtt.esm.js');
    note(`Connecting to <code>${hostOf(this.cfg.url)}</code>…`);
    this.c = mqtt.connect(this.cfg.url, { username: this.cfg.user, password: this.cfg.pass, protocolVersion: 5,
      clientId: 'twin-' + Math.random().toString(16).slice(2, 10), clean: true, reconnectPeriod: 4000 });
    this.c.on('connect', () => {
      note(`Subscribed on <code>${hostOf(this.cfg.url)}</code> to css/${UE}/bins/+/level · reorder · epcis and the gateway status`);
      state.broker = true;
      this.c.subscribe([`css/${UE}/bins/+/level`, `css/${UE}/bins/+/reorder`, `css/${UE}/bins/+/epcis`, `css/${UE}/edge/+/status`], { qos: 1 });
      refreshChips();
    });
    this.c.on('message', (topic, buf) => {
      const text = buf.toString();
      onSent(topic, topic.endsWith('/status') ? text : safeJson(text), true);
    });
    this.c.on('error', e => note(`Broker: ${e.message}. Check the URL, user and password (⚙ Cloud again).`));
    this.c.on('close', () => { if (!this.stopped) { state.broker = false; refreshChips(); } });
  }
  stop() { this.stopped = true; try { this.c && this.c.end(true); } catch (e) { /* closed */ } }
}

function note(html) { ui.note.innerHTML = html; }

const dlg = document.getElementById('cloudDlg');
function cloudConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('twin.cloud') || '{}'); } catch (e) { /* storage blocked */ }
  return saved;
}
function askCloud() {
  return new Promise(resolve => {
    const s = cloudConfig();
    document.getElementById('cUrl').value = s.url || '';
    document.getElementById('cUser').value = s.user || '';
    document.getElementById('cPass').value = s.pass || '';
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      const cfg = { url: document.getElementById('cUrl').value.trim(), user: document.getElementById('cUser').value.trim(),
                    pass: document.getElementById('cPass').value };
      try {
        if (document.getElementById('cKeep').checked) localStorage.setItem('twin.cloud', JSON.stringify(cfg));
        else localStorage.removeItem('twin.cloud');
      } catch (e) { /* storage blocked */ }
      resolve(cfg.url ? cfg : null);
    };
    dlg.showModal();
  });
}

function clearScene() {
  for (const b of bins.values()) { b.target = null; b.shown = null; b.status = null; b.inst.count = 0; if (b.caps) b.caps.count = 0; }
  Object.assign(state, { simMin: null, cycle: 0, sent: 0, broker: null, queue: 0, gateway: null, lastMsg: 0 });
  ui.date.textContent = '—'; ui.day.textContent = ''; ui.log.innerHTML = '';
  for (const b of bins.values()) {
    b.el.className = 'tag'; b.el.querySelector('.u').textContent = '—'; b.el.querySelector('.s').textContent = 'waiting for data';
    b.row.className = 'bin'; b.row.querySelector('.u').textContent = '—'; b.row.querySelector('.st').textContent = '—';
  }
  refreshChips();
}

async function use(kind, interactive = true) {
  let cfg = null;
  if (kind === 'cloud') {
    cfg = cloudConfig();
    if (interactive || !cfg.url) cfg = await askCloud();
    if (!cfg) return;
  }
  if (source) source.stop();
  clearScene();
  document.body.className = document.body.className.replace(/\bsrc-\w+/g, '').trim() + ' src-' + kind;
  document.querySelectorAll('#src button').forEach(b => b.classList.toggle('on', b.dataset.src === kind));
  if (kind === 'demo') {
    source = new Replay();
    note('Replay in the browser of the 109 SALMI report dates (8 Jun – 13 Nov 2026), with the same ROP, hysteresis and fault rules as the edge.');
    syncDemoButtons();
  } else if (kind === 'local') source = new LocalEdge();
  else source = new Cloud(cfg);
}

document.querySelectorAll('#src button').forEach(b => b.addEventListener('click', () => use(b.dataset.src)));
document.getElementById('play').addEventListener('click', () => { if (source instanceof Replay) { source.playing = !source.playing; syncDemoButtons(); } });
document.getElementById('restart').addEventListener('click', () => { if (source instanceof Replay) { clearScene(); source.reset(0); } });
document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
  if (source instanceof Replay) { source.speed = Number(b.dataset.speed); syncDemoButtons(); }
}));
document.querySelectorAll('[data-fault]').forEach(b => b.addEventListener('click', () => {
  if (!(source instanceof Replay)) return;
  const f = b.dataset.fault;
  source.faults[f] = !source.faults[f];
  if (f === 'net') log(source.faults.net ? 'Network cut (demo)' : 'Network restored (demo)', 'net');
  syncDemoButtons();
}));
function syncDemoButtons() {
  if (!(source instanceof Replay)) return;
  document.getElementById('play').textContent = source.playing ? 'Pause' : 'Play';
  document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', Number(b.dataset.speed) === source.speed));
  document.querySelectorAll('[data-fault]').forEach(b => b.classList.toggle('on', source.faults[b.dataset.fault]));
}

// ---------------------------------------------------------------- helpers
function fmt(v, dec = 0) { return v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: dec, minimumFractionDigits: dec }); }
function shortName(n) { return n.split(',')[0].replace(/\s*\(.*?\)/, '').replace(/\s+[\d.,]+\s*(mg|ml|IU|g|mcg)?\b.*$/i, '').trim(); }
function safeJson(t) { try { return JSON.parse(t); } catch (e) { return null; } }
function hostOf(u) { try { return new URL(u).host; } catch (e) { return u; } }

resize();
const startSrc = params.get('source') || (location.port === '1880' ? 'local' : 'demo');
use(['demo', 'local', 'cloud'].includes(startSrc) ? startSrc : 'demo', false);
requestAnimationFrame(frame);
