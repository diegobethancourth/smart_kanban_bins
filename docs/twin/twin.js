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
// The scene follows the ISA-95 levels: the shelf with its load cells (L0-L1), the Node-RED
// gateway (L2), the cloud broker, the monitoring dashboard (L3) and the ERP requisition (L4).
// A receipt in the stock closes the loop: the requisition is marked received and the delivery
// flies back from the ERP screen to the bin.
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

  // smart-bin display on the front of the bin (like the e-paper label of an industrial smart bin):
  // the load cell's Modbus unit ID, the gross weight it reports and the units the edge computes
  const lcdC = document.createElement('canvas'); lcdC.width = 640; lcdC.height = 230;
  const lcdT = new THREE.CanvasTexture(lcdC); lcdT.colorSpace = THREE.SRGBColorSpace; lcdT.anisotropy = 8;
  const LW = 0.30, LH = 0.108, ly = PLATE + 0.075;
  box(LW + 0.014, LH + 0.014, 0.008, dark, 0, ly, BD / 2 + 0.006, g).castShadow = false;
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(LW, LH), new THREE.MeshBasicMaterial({ map: lcdT, toneMapped: false }));
  lcd.position.set(0, ly, BD / 2 + 0.0105);
  g.add(lcd);

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
    cfg, g, inst, caps, slots, capacity, binMat, ringMat, led, el, lcdC, lcdT, lcdKey: '',
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
gwTag.position.set(0.04, -0.09, 0.04); gwTag.center.set(0.5, 0);
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

// ---------------------------------------------------------------- ISA-95 levels 3 and 4: dashboard and ERP screens
// Both screens are fed only by what reached the cloud (level and reorder messages after the
// uplink), so during a network cut the dashboard stops and then backfills from the edge queue,
// as Grafana does with the edge timestamps.
const wall = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.3), new THREE.MeshStandardMaterial({ color: 0xE9E5DF, roughness: 0.95 }));
wall.position.set(0.15, 1.15, -0.78);
wall.receiveShadow = true;
scene.add(wall);

function screen(x, y, w, h, px, kicker, title, view) {
  const g = new THREE.Group();
  g.position.set(x, y, -0.76);
  scene.add(g);
  box(w + 0.035, h + 0.035, 0.025, dark, 0, 0, 0, g);                        // bezel
  const canvas = document.createElement('canvas');
  canvas.width = px; canvas.height = Math.round(px * h / w);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  plane.position.z = 0.0135;
  plane.userData.view = view;
  g.add(plane);
  pickables.push(plane);
  const el = document.createElement('div');
  el.className = 'ptag lvl';
  el.innerHTML = `<span class="k">${kicker}</span>${title}`;
  el.addEventListener('click', () => goView(view));
  const t = new CSS2DObject(el);
  t.position.set(-w / 2, h / 2 + 0.03, 0.02); t.center.set(0, 1);
  g.add(t);
  return { g, canvas, ctx: canvas.getContext('2d'), tex, w, h, world: new THREE.Vector3(x, y, -0.74) };
}
const L3 = screen(-0.42, 1.56, 0.98, 0.54, 1400, 'L3', 'Dashboard · InfluxDB → Grafana', 'l3');
const L4 = screen(0.66, 1.56, 0.82, 0.54, 1200, 'L4', 'ERP · P-240 requisitions', 'l4');

const CLOUD_OUT = CLOUD.clone().add(new THREE.Vector3(-0.15, -0.05, -0.05));
const toL3 = new THREE.CatmullRomCurve3([CLOUD_OUT, new THREE.Vector3(0.5, 1.98, -0.62), new THREE.Vector3(-0.42, 1.88, -0.7), L3.world.clone().add(new THREE.Vector3(0.1, 0.1, 0))]);
const toL4 = new THREE.CatmullRomCurve3([CLOUD_OUT, new THREE.Vector3(1.2, 1.7, -0.68), L4.world.clone().add(new THREE.Vector3(0.25, 0.05, 0))]);
for (const c of [toL3, toL4]) {
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(c.getPoints(60)), upMat);
  l.computeLineDistances();
  scene.add(l);
}
for (const b of bins.values()) {                 // delivery path: from the ERP back to the bin
  const top = b.g.position.clone().add(new THREE.Vector3(0, PLATE + BH * 0.6, 0));
  b.delivery = new THREE.CatmullRomCurve3([L4.world.clone().add(new THREE.Vector3(0, -0.25, 0.05)),
    new THREE.Vector3((L4.world.x + top.x) / 2, 1.45, 0.25), top.clone().add(new THREE.Vector3(0, 0.35, 0.05)), top]);
}

const CSS_LOGO = new Image();
CSS_LOGO.onload = () => { ent.dirty = true; drawSign(); };
CSS_LOGO.src = 'img/css_logo.png';

// sign on the wall: whose shelf this is
const sign = (() => {
  const c = document.createElement('canvas'); c.width = 1400; c.height = 220;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.236), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  m.position.set(0.1, 2.15, -0.775);
  scene.add(m);
  return { c, tex };
})();
function drawSign() {
  const ctx = sign.c.getContext('2d'), W = sign.c.width, H = sign.c.height;
  ctx.clearRect(0, 0, W, H);
  if (CSS_LOGO.complete && CSS_LOGO.naturalWidth) ctx.drawImage(CSS_LOGO, 10, 10, 200, 200);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1A5BA8'; ctx.font = '700 64px Segoe UI, Arial';
  ctx.fillText('Caja de Seguro Social', 240, 78);
  ctx.fillStyle = '#4b5563'; ctx.font = '40px Segoe UI, Arial';
  ctx.fillText(`DINALOG · facility ${UE} · smart Kanban pharmacy shelf`, 242, 150);
  sign.tex.needsUpdate = true;
}
drawSign();

const ent = { hist: new Map(), reqs: [], seq: 0, cloudMin: null, cycle: null, dirty: true };
function resetEnterprise() {
  ent.hist = new Map([...bins.keys()].map(k => [k, []]));
  ent.reqs = []; ent.seq = 0; ent.cloudMin = null; ent.cycle = null; ent.dirty = true;
}
resetEnterprise();

// a level message reached the cloud: history for L3, receipt check for L4
function arriveLevel(p) {
  const b = bins.get(p.bin_id);
  if (!b || p.units == null) return;
  if (p.cycle != null && ent.cycle != null && p.cycle !== ent.cycle) resetEnterprise();
  if (p.cycle != null) ent.cycle = p.cycle;
  const h = ent.hist.get(p.bin_id);
  const t = p.sim_min ?? (h.length ? h[h.length - 1][0] : 0);
  const prev = h.length ? h[h.length - 1] : null;
  h.push([t, p.units, p.status ?? 0]);
  if (h.length > 3000) h.shift();
  ent.cloudMin = Math.max(ent.cloudMin ?? 0, t);
  ent.dirty = true;
  // a receipt: the stock jumps up by at least a quarter of the ROP (smaller rises are returns or adjustments)
  if (prev && p.units - prev[1] >= Math.max(3 * b.cfg.deadband_units, 0.25 * b.cfg.ROP)) {
    const r = ent.reqs.find(q => q.bin === b.cfg.bin && q.status === 'Requested');
    const qty = p.units - prev[1];
    if (r) {
      Object.assign(r, { status: 'Received', recvMin: t, recvQty: qty, lead: (t - r.reqMin) / 1440 });
      log(`<b>Receipt ${b.cfg.bin}</b> +${fmt(qty)} units: ${r.id} closed, actual lead time ${fmt(r.lead, 1)} days`, 'recv');
    } else {
      log(`<b>Receipt ${b.cfg.bin}</b> +${fmt(qty)} units`, 'recv');
    }
    packet(b.delivery, COLORS.ok, 0.03, 1.8, () => burst(b, `RECEIVED +${fmt(qty)}`, 'recv'));
  }
}

// a reorder event reached the ERP: open a requisition
function arriveReorder(p) {
  const b = bins.get(p.bin_id);
  if (!b) return;
  if (ent.reqs.some(q => q.bin === b.cfg.bin && q.status === 'Requested' && q.cycle === p.cycle && Math.abs(q.reqMin - p.sim_min) < 1)) return;
  ent.seq += 1;
  ent.reqs.unshift({ id: 'REQ-' + String(ent.seq).padStart(4, '0'), bin: b.cfg.bin, item: b.cfg.item, name: shortName(b.cfg.name),
    units: p.units, qty: Math.max(0, Math.round(b.cfg.max_stock - p.units)), reqMin: p.sim_min ?? ent.cloudMin ?? 0,
    cycle: p.cycle, status: 'Requested' });
  ent.dirty = true;
}

function fit(ctx, text, max) {                    // cut a text with an ellipsis to fit a column
  if (ctx.measureText(text).width <= max) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > max) text = text.slice(0, -1);
  return text + '…';
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function drawL3() {
  const { ctx, canvas } = L3, W = canvas.width, H = canvas.height, s = W / 1400;
  ctx.fillStyle = '#111217'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#e8e9ed'; ctx.font = `600 ${30 * s}px Segoe UI, Arial`; ctx.textBaseline = 'middle';
  let lx = 28 * s;
  if (CSS_LOGO.complete && CSS_LOGO.naturalWidth) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(lx + 25 * s, 34 * s, 25 * s, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(CSS_LOGO, lx + 1 * s, 10 * s, 48 * s, 48 * s); lx += 62 * s; }
  ctx.fillStyle = '#e8e9ed';
  const title = `CSS · Smart Kanban · ${UE}`;
  ctx.fillText(title, lx, 34 * s);
  const tx = lx + ctx.measureText(title).width + 22 * s;
  ctx.font = `${20 * s}px Segoe UI, Arial`; ctx.fillStyle = '#9aa0ab';
  ctx.fillText(ent.cloudMin != null ? 'last data in the cloud: ' + simDate(ent.cloudMin) : 'waiting for data', tx, 35 * s);
  const online = state.gateway !== 'offline' && state.lastMsg;
  const pill = (x, text, bg, fg) => { ctx.font = `600 ${19 * s}px Segoe UI, Arial`; const w = ctx.measureText(text).width + 28 * s;
    ctx.fillStyle = bg; rr(ctx, x - w, 16 * s, w, 36 * s, 18 * s); ctx.fill(); ctx.fillStyle = fg; ctx.fillText(text, x - w + 14 * s, 35 * s); return x - w - 10 * s; };
  let x = pill(W - 24 * s, online ? 'GATEWAY ONLINE' : 'GATEWAY OFFLINE', online ? '#1f4d2c' : '#5a1f1f', online ? '#8be0a4' : '#ff9d9d');
  const flagged = [...bins.values()].filter(b => b.status).length;
  x = pill(x, `${flagged} flagged`, flagged ? '#5a1f1f' : '#24262d', flagged ? '#ff9d9d' : '#c4c7ce');
  pill(x, `${ent.reqs.length} reorder${ent.reqs.length === 1 ? '' : 's'}`, '#4a3b0c', '#ffd65c');
  // six panels, 30 simulated days each
  const cols = 3, pw = (W - 28 * s * 2 - 16 * s * 2) / cols, ph = (H - 76 * s - 22 * s - 16 * s) / 2;
  const span = 30 * 1440, tEnd = ent.cloudMin ?? 0, tStart = tEnd - span;
  [...bins.values()].forEach((b, i) => {
    const px = 28 * s + (i % cols) * (pw + 16 * s), py = 76 * s + Math.floor(i / cols) * (ph + 16 * s);
    ctx.fillStyle = '#1b1d24'; rr(ctx, px, py, pw, ph, 10 * s); ctx.fill();
    const h = ent.hist.get(b.cfg.bin), last = h[h.length - 1];
    ctx.fillStyle = '#c9ccd3'; ctx.font = `600 ${20 * s}px Segoe UI, Arial`;
    ctx.fillText(fit(ctx, `${b.cfg.bin} · ${shortName(b.cfg.name)}`, pw - 130 * s), px + 16 * s, py + 24 * s);
    const low = last && last[1] <= b.cfg.ROP, flag = last && last[2];
    ctx.font = `700 ${38 * s}px Segoe UI, Arial`; ctx.textAlign = 'right';
    ctx.fillStyle = flag ? '#ff8a8a' : low ? '#ffd65c' : '#8be0a4';
    ctx.fillText(last ? fmt(last[1]) : '—', px + pw - 16 * s, py + 30 * s);
    ctx.textAlign = 'left';
    // chart area
    const cx = px + 16 * s, cy = py + 58 * s, cw = pw - 32 * s, ch = ph - 78 * s;
    const ymax = b.capacity;
    const X = t => cx + (t - tStart) / span * cw, Y = v => cy + ch - Math.min(1, v / ymax) * ch;
    ctx.strokeStyle = '#2a2d36'; ctx.lineWidth = 1;
    for (let k = 0; k <= 3; k++) { const yy = cy + ch * k / 3; ctx.beginPath(); ctx.moveTo(cx, yy); ctx.lineTo(cx + cw, yy); ctx.stroke(); }
    ctx.setLineDash([10 * s, 7 * s]); ctx.strokeStyle = '#FFC627'; ctx.lineWidth = 2.5 * s;
    ctx.beginPath(); ctx.moveTo(cx, Y(b.cfg.ROP)); ctx.lineTo(cx + cw, Y(b.cfg.ROP)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#FFC627'; ctx.font = `${15 * s}px Segoe UI, Arial`; ctx.fillText(`ROP ${fmt(b.cfg.ROP)}`, cx + 4 * s, Y(b.cfg.ROP) - 11 * s);
    // stock as a step line (each value holds until the next message), like the Grafana panel
    const pts = h.filter(q => q[0] >= tStart - 1440 * 6);
    if (pts.length) {
      ctx.save(); ctx.beginPath(); ctx.rect(cx, cy - 4, cw, ch + 8); ctx.clip();
      ctx.strokeStyle = '#E87597'; ctx.lineWidth = 3 * s; ctx.beginPath();
      pts.forEach((q, k) => { const xx = X(q[0]), yy = Y(q[1]); if (k === 0) ctx.moveTo(xx, yy); else { ctx.lineTo(xx, Y(pts[k - 1][1])); ctx.lineTo(xx, yy); } });
      ctx.stroke();
      ent.reqs.filter(r => r.bin === b.cfg.bin && r.reqMin >= tStart).forEach(r => {   // reorder markers
        ctx.fillStyle = '#FFC627'; ctx.beginPath(); ctx.arc(X(r.reqMin), Y(r.units), 7 * s, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
    }
    ctx.fillStyle = '#6f7582'; ctx.font = `${14 * s}px Segoe UI, Arial`;
    ctx.fillText(ent.cloudMin != null ? simDate(tStart, true) : '', cx, cy + ch + 12 * s);
    ctx.textAlign = 'right'; ctx.fillText(ent.cloudMin != null ? simDate(tEnd, true) : '', cx + cw, cy + ch + 12 * s); ctx.textAlign = 'left';
  });
  L3.tex.needsUpdate = true;
}

function drawL4() {
  const { ctx, canvas } = L4, W = canvas.width, H = canvas.height, s = W / 1200;
  const F = (px, w = '') => `${w} ${px * s}px Segoe UI, Arial`;
  ctx.fillStyle = '#F7F6F3'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#8C1D40'; ctx.fillRect(0, 0, W, 78 * s);
  ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.font = F(34, 600);
  ctx.fillText('ERP · Purchase requisitions', 26 * s, 40 * s);
  ctx.font = F(20); ctx.textAlign = 'right';
  ctx.fillText(`P-240 · from reorder + EPCIS events · ${UE}`, W - 24 * s, 41 * s); ctx.textAlign = 'left';
  const cols = [['Req.', 26], ['Item', 170], ['Units', 545], ['Qty', 665], ['Requested', 780], ['Status', 935]];
  ctx.fillStyle = '#5b6270'; ctx.font = F(20, 600);
  cols.forEach(([t, x]) => ctx.fillText(t, x * s, 110 * s));
  ctx.fillStyle = '#E4E1DC'; ctx.fillRect(20 * s, 128 * s, W - 40 * s, 2 * s);
  const rh = 66 * s, rows = ent.reqs.slice(0, Math.floor((H - 210 * s) / rh));
  rows.forEach((r, k) => {
    const y = 164 * s + k * rh;
    ctx.fillStyle = k % 2 ? '#F7F6F3' : '#FFFFFF'; ctx.fillRect(20 * s, y - rh / 2, W - 40 * s, rh);
    ctx.fillStyle = '#1f2328'; ctx.font = F(22, 600); ctx.fillText(r.id.replace('REQ-', '#'), 26 * s, y);
    ctx.font = F(23, 600); ctx.fillText(fit(ctx, `${r.bin} · ${r.name}`, 360 * s), 170 * s, y - 11 * s);
    ctx.fillStyle = '#6b7280'; ctx.font = F(17); ctx.fillText(`SALMI ${r.item}`, 170 * s, y + 15 * s);
    ctx.fillStyle = '#1f2328'; ctx.font = F(23);
    ctx.fillText(fmt(r.units), 545 * s, y); ctx.fillText(fmt(r.qty), 665 * s, y); ctx.fillText(simDate(r.reqMin, true), 780 * s, y);
    const rec = r.status === 'Received';
    const text = rec ? `Received · ${fmt(r.lead, 1)} d` : 'Requested';
    ctx.font = F(20, 600);
    const w = ctx.measureText(text).width + 24 * s;
    ctx.fillStyle = rec ? '#D3EEDB' : '#FFEBB0'; rr(ctx, 935 * s - 10 * s, y - 19 * s, w, 38 * s, 19 * s); ctx.fill();
    ctx.fillStyle = rec ? '#1E6B3A' : '#7A5600'; ctx.fillText(text, 935 * s + 2 * s, y);
  });
  if (!rows.length) { ctx.fillStyle = '#6b7280'; ctx.font = F(24); ctx.fillText('No requisitions yet: one opens when a bin crosses its ROP.', 26 * s, 180 * s); }
  // footer: actual lead time from the receipts against the L of P-240
  const done = ent.reqs.filter(r => r.status === 'Received');
  const open = ent.reqs.length - done.length;
  const mean = done.length ? done.reduce((a, r) => a + r.lead, 0) / done.length : null;
  ctx.fillStyle = '#EFEDE9'; ctx.fillRect(0, H - 76 * s, W, 76 * s);
  ctx.fillStyle = '#1f2328'; ctx.font = F(23, 600);
  ctx.fillText(`${open} open · ${done.length} received`, 26 * s, H - 38 * s);
  ctx.font = F(23); ctx.textAlign = 'right';
  ctx.fillText(mean != null ? `actual lead time ${fmt(mean, 1)} d · P-240 assumes L = ${DATA.p240.L_days} d`
    : `P-240 assumes a lead time L = ${DATA.p240.L_days} d`, W - 26 * s, H - 38 * s);
  ctx.textAlign = 'left';
  L4.tex.needsUpdate = true;
}

// ---------------------------------------------------------------- camera views
const VIEWS = {
  overview: { pos: [0.62, 1.42, 3.35], at: [0.32, 0.96, -0.3] },
  shelf:    { pos: [0.95, 1.25, 2.55], at: [0.25, 0.66, 0] },
  l3:       { pos: [-0.42, 1.56, 0.42], at: [-0.42, 1.56, -0.76] },
  l4:       { pos: [0.66, 1.56, 0.25], at: [0.66, 1.56, -0.76] },
};
const SHELF_C = new THREE.Vector3(0, 0.6, 0);
const tween = { on: false, pos: new THREE.Vector3(), at: new THREE.Vector3() };
function goView(name, instant = false) {
  const v = VIEWS[name] || VIEWS.overview;
  tween.pos.set(...v.pos); tween.at.set(...v.at); tween.on = true;
  if (instant) { camera.position.copy(tween.pos); controls.target.copy(tween.at); tween.on = false; }
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
controls.addEventListener('start', () => { tween.on = false; document.querySelectorAll('#views button').forEach(b => b.classList.remove('on')); });
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => goView(b.dataset.view)));

// ---------------------------------------------------------------- packets
const packets = [];
const PACKET_GEO = new THREE.SphereGeometry(1, 16, 12);
function packet(curve, color, r, dur, onDone) {
  if (packets.length > 400) { if (onDone) setTimeout(onDone, 0); return; }   // keep the scene light during a backlog burst
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
    <div class="detail"><h4>${b.cfg.bin} · ${b.cfg.name}</h4><table>
      <tr><td>Item (SALMI code)</td><td>${b.cfg.item}</td></tr>
      <tr><td>Average demand d̄</td><td>${fmt(b.cfg.d_day, 1)} units/day</td></tr>
      <tr><td>Lead time L</td><td>${DATA.p240.L_days} days</td></tr>
      <tr><td>Service factor z</td><td>${b.cfg.vital ? DATA.p240.z_vital : DATA.p240.z_other}</td></tr>
      <tr><td>Safety stock z·σd·√L</td><td>${fmt(b.cfg.SS)} units</td></tr>
      <tr><td>ROP d̄·L + SS</td><td>${fmt(b.cfg.ROP)} units</td></tr>
      <tr><td>Unit weight · tare</td><td>${b.cfg.unit_g} g · ${b.cfg.tare_g} g</td></tr>
    </table></div>`;
  row.addEventListener('click', e => { if (!e.target.closest('.detail')) select(state.selected === b.cfg.bin ? null : b.cfg.bin); });
  ui.bins.appendChild(row);
  b.row = row;
}

function select(binId) {
  state.selected = binId;
  document.body.classList.toggle('binsel', !!binId);       // the P-240 pop-up takes the place of the events panel
  for (const b of bins.values()) {
    const on = b.cfg.bin === binId;
    b.row.classList.toggle('sel', on);
    b.el.classList.toggle('sel', on);
  }
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
  if (hit && hit.object.userData.view) { goView(hit.object.userData.view); return; }
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
  setChip(ui.msgs, 'info', `${state.sent.toLocaleString('en-US')} msgs sent`);
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
    arriveLevel(p);                                         // the data path is immediate; the packets only show it
    packet(upCurve, COLORS.level, 0.012, 1.3, () => packet(toL3, COLORS.level, 0.011, 1.0));
  } else if (kind === 'reorder') {
    const b = bins.get(p.bin_id);
    arriveReorder(p);
    packet(upCurve, COLORS.reorder, 0.024, 1.8, () => packet(toL4, COLORS.reorder, 0.022, 1.0));
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

function burst(b, text, cls = '') {
  const el = document.createElement('div');
  el.className = 'burst ' + cls;
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

function drawLcd(b) {
  const units = b.target, st = b.status || 0;
  const grams = b.cfg.tare_g + units * b.cfg.unit_g / (b.cfg.scale_k || 1);
  const key = units + '|' + st;
  if (key === b.lcdKey) return;
  b.lcdKey = key;
  const c = b.lcdC.getContext('2d'), W = b.lcdC.width, H = b.lcdC.height;
  const low = units <= b.cfg.ROP;
  c.fillStyle = '#10151c'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#8C1D40'; c.fillRect(0, 0, W, 46);
  c.fillStyle = '#fff'; c.font = '700 28px Segoe UI, Arial'; c.textBaseline = 'middle';
  c.fillText(`KANBAN ${b.cfg.bin.toUpperCase()}`, 16, 24);
  c.textAlign = 'right'; c.font = '600 24px Segoe UI, Arial'; c.fillStyle = '#FFC627';
  c.fillText(`MODBUS ID ${b.cfg.unit_id}`, W - 16, 24); c.textAlign = 'left';
  c.fillStyle = st ? '#ff8a8a' : '#7CF2A0'; c.font = '700 66px Consolas, monospace';
  c.fillText(st === 2 ? '---- g' : fmt(grams, 1) + ' g', 16, 104);
  c.fillStyle = '#9aa4b2'; c.font = '22px Segoe UI, Arial';
  c.fillText('gross weight · registers 40001-40002 (mg)', 16, 152);
  c.fillStyle = st ? '#ff8a8a' : low ? '#FFC627' : '#e8edf2'; c.font = '700 34px Segoe UI, Arial';
  c.fillText(`${fmt(units)} units`, 16, 198);
  c.textAlign = 'right'; c.font = '700 26px Segoe UI, Arial';
  c.fillText(st === 1 ? 'SENSOR FAULT' : st === 2 ? 'STUCK' : low ? 'REORDER POINT' : 'OK', W - 16, 198);
  c.textAlign = 'left';
  b.lcdT.needsUpdate = true;
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
  drawLcd(b);
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
  if (tween.on) {
    const k = Math.min(1, dt * 3.5);
    camera.position.lerp(tween.pos, k); controls.target.lerp(tween.at, k);
    if (camera.position.distanceTo(tween.pos) < 0.002) tween.on = false;
  }
  if (ent.dirty && now - (ent.drawnAt || 0) > 250) { ent.dirty = false; ent.drawnAt = now; drawL3(); drawL4(); }
  stepPackets(now);
  if (state.simMin != null) {
    ui.date.textContent = simDate(state.simMin);
    ui.day.textContent = `day ${Math.floor(state.simMin / 1440) + 1} of ${LAST_DAY + 1}`;
  }
  const far = camera.position.distanceTo(SHELF_C) > 2.4;      // compact labels when zoomed out
  if (far !== ui.far) { ui.far = far; document.getElementById('labels').classList.toggle('far', far); }
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
  packets.splice(0).forEach(q => scene.remove(q.m));
  resetEnterprise();
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
goView(params.get('view') || 'overview', true);
document.getElementById('evHead').addEventListener('click', () => {
  const ev = document.getElementById('events');
  ev.classList.toggle('closed');
  document.getElementById('evToggle').textContent = ev.classList.contains('closed') ? 'show' : 'hide';
});
if (window.innerWidth < 700) document.getElementById('events').classList.add('closed');
setInterval(() => { ent.dirty = true; }, 1000);              // gateway pill and flagged count on L3
const startSrc = params.get('source') || (location.port === '1880' ? 'local' : 'demo');
use(['demo', 'local', 'cloud'].includes(startSrc) ? startSrc : 'demo', false);
requestAnimationFrame(frame);
