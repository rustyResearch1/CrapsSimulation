// Cinematic 3D dice roll: a full craps table, a shooter's arm throwing from the near end,
// two dice tumbling down the felt, hitting the back wall and settling.
// The outcome is decided by the server; this only stages it. Each die's flight is scripted
// so that it always comes to rest with the server's value on its TOP face.
import * as THREE from '/vendor/three.module.js';

const TABLE_L = 12, TABLE_W = 6, DIE = 0.42, HALF = DIE / 2;
const RELEASE = 0.5;                 // seconds until the dice leave the hand
export const LAND_MS = 2350;         // dice are at rest and readable from here on

// BoxGeometry material order is +x, -x, +y, -y, +z, -z. Opposite faces sum to 7.
const FACE_VALUES = [2, 5, 1, 6, 3, 4];
const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
/** Rotation that turns the face showing `v` to point straight up. */
const TOP = {
  1: new THREE.Quaternion(),
  6: new THREE.Quaternion().setFromAxisAngle(X, Math.PI),
  2: new THREE.Quaternion().setFromAxisAngle(Z, Math.PI / 2),
  5: new THREE.Quaternion().setFromAxisAngle(Z, -Math.PI / 2),
  3: new THREE.Quaternion().setFromAxisAngle(X, -Math.PI / 2),
  4: new THREE.Quaternion().setFromAxisAngle(X, Math.PI / 2),
};

let renderer, scene, camera, dice = [], arm, fist, armMat, raf = 0, plan = null, host = null;

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function feltTexture() {
  return canvasTexture(2048, 1024, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 60, w / 2, h / 2, w * 0.62);
    grad.addColorStop(0, '#1b9368'); grad.addColorStop(1, '#0a4a34');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(240,226,170,.92)'; g.fillStyle = 'rgba(240,226,170,.92)'; g.lineWidth = 7; g.lineJoin = 'round';
    const rr = (x, y, ww, hh, r) => { g.beginPath(); g.roundRect(x, y, ww, hh, r); g.stroke(); };
    // Text is drawn rotated so it reads across the table from the shooter's end.
    const text = (s, x, y, size) => { g.save(); g.translate(x, y); g.rotate(Math.PI / 2); g.font = `700 ${size}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, 0, 0); g.restore(); };
    rr(70, 60, w - 140, h - 120, 150);                    // pass line, outer
    rr(190, 170, w - 330, h - 340, 80);                   // pass line, inner
    text('PASS LINE', 130, h / 2, 62);
    rr(250, 225, 170, h - 450, 20); text("DON'T PASS BAR", 335, h / 2, 44);
    rr(480, 225, 300, h - 450, 20); text('FIELD', 560, h / 2, 96);
    text('3 · 4 · 9 · 10 · 11', 700, h / 2, 44);
    rr(840, 225, 330, h - 450, 20); text('COME', 1005, h / 2, 130);
    const labels = ['4', '5', 'SIX', '8', 'NINE', '10'], y0 = 225, ch = (h - 450) / 6;
    labels.forEach((s, i) => { rr(1230, y0 + i * ch, 330, ch, 10); text(s, 1395, y0 + i * ch + ch / 2, s.length > 2 ? 54 : 74); });
    rr(1620, 225, 170, h - 450, 20); text("DON'T COME BAR", 1705, h / 2, 40);
  });
}

function wallTexture() {
  const t = canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = '#0c5a40'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.28)';
    for (let x = 0; x < w; x += 16) for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(x + 8, y); g.lineTo(x + 16, y + 8); g.lineTo(x + 8, y + 16); g.lineTo(x, y + 8); g.fill(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8, 1);
  return t;
}

function dieMaterials() {
  const spots = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return FACE_VALUES.map((v) => new THREE.MeshStandardMaterial({
    roughness: 0.32, metalness: 0.05,
    map: canvasTexture(256, 256, (g, w) => {
      g.fillStyle = '#8f1712'; g.fillRect(0, 0, w, w);
      const grad = g.createLinearGradient(0, 0, w, w); grad.addColorStop(0, '#f2554c'); grad.addColorStop(1, '#b8221c');
      g.fillStyle = grad; g.beginPath(); g.roundRect(8, 8, w - 16, w - 16, 34); g.fill();
      g.fillStyle = '#fff';
      for (const i of spots[v]) { g.beginPath(); g.arc(62 + (i % 3) * 66, 62 + Math.floor(i / 3) * 66, 23, 0, Math.PI * 2); g.fill(); }
    }),
  }));
}

function build(container) {
  host = container;
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  container.prepend(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#040907');
  scene.fog = new THREE.Fog('#040907', 16, 34);
  camera = new THREE.PerspectiveCamera(58, 1, 0.1, 80);

  scene.add(new THREE.HemisphereLight('#fff4d6', '#0a2016', 0.9));
  const lamp = new THREE.DirectionalLight('#fff1cf', 2.4);
  lamp.position.set(1.5, 9, 3.5); lamp.target.position.set(2, 0, 0);
  lamp.castShadow = true; lamp.shadow.mapSize.set(2048, 2048);
  Object.assign(lamp.shadow.camera, { left: -9, right: 9, top: 6, bottom: -6, near: 1, far: 22 });
  lamp.shadow.bias = -0.0006;
  scene.add(lamp, lamp.target);

  const felt = new THREE.Mesh(new THREE.PlaneGeometry(TABLE_L, TABLE_W), new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.95 }));
  felt.rotation.x = -Math.PI / 2; felt.receiveShadow = true;
  scene.add(felt);

  const wood = new THREE.MeshStandardMaterial({ color: '#4d2c16', roughness: 0.55 });
  const pad = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.9 });
  const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
  const RAIL = 0.5, WALL = 0.95;
  box(TABLE_L + 2 * RAIL, WALL + 0.2, RAIL, 0, (WALL + 0.2) / 2 - 0.1, -(TABLE_W + RAIL) / 2, wood);   // long rails
  box(TABLE_L + 2 * RAIL, WALL + 0.2, RAIL, 0, (WALL + 0.2) / 2 - 0.1, (TABLE_W + RAIL) / 2, wood);
  box(RAIL, WALL + 0.2, TABLE_W, (TABLE_L + RAIL) / 2, (WALL + 0.2) / 2 - 0.1, 0, wood);               // far end
  box(RAIL, 0.5, TABLE_W, -(TABLE_L + RAIL) / 2, 0.15, 0, wood);                                        // shooter's end, low
  box(0.08, WALL, TABLE_W, TABLE_L / 2 - 0.04, WALL / 2, 0, pad);                                       // rubber back wall
  box(TABLE_L, WALL, 0.08, 0, WALL / 2, -TABLE_W / 2 + 0.04, pad);
  box(TABLE_L, WALL, 0.08, 0, WALL / 2, TABLE_W / 2 - 0.04, pad);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: '#07100c', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.2; scene.add(floor);

  const mats = dieMaterials();
  for (let i = 0; i < 2; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(DIE, DIE, DIE), mats);
    d.castShadow = true; scene.add(d); dice.push(d);
  }

  // The shooter: a dark silhouette arm reaching in from off-table.
  armMat = new THREE.MeshBasicMaterial({ color: '#020403', transparent: true, opacity: 0.82 });
  arm = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1, 14), armMat);
  fist = new THREE.Mesh(new THREE.SphereGeometry(0.33, 18, 14), armMat);
  arm.castShadow = fist.castShadow = true;
  scene.add(arm, fist);

  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  if (!renderer) return;
  const w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

const smooth = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
const lerp3 = (a, b, u, out) => out.set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u);

/** Scripted flight: hand -> felt -> back wall -> two hops -> rest. Returns timed arc segments. */
function flight(i) {
  const side = i === 0 ? -1 : 1, r = (a) => (Math.random() - 0.5) * a;
  const rest = new THREE.Vector3(2.75 + i * 0.55 + r(0.2), HALF, side * (0.42 + Math.random() * 0.25));
  const pts = [
    new THREE.Vector3(-5.1, 1.35, 0.35 + side * 0.14),                 // release
    new THREE.Vector3(2.4 + r(0.5), HALF, side * 0.5 + r(0.5)),        // first touch on the felt
    new THREE.Vector3(TABLE_L / 2 - 0.08 - HALF, 0.5 + r(0.15), side * 0.7 + r(0.6)), // back wall
    new THREE.Vector3(4.5 + r(0.3), HALF, side * 0.65 + r(0.4)),       // off the wall
    new THREE.Vector3(3.5 + i * 0.3 + r(0.2), HALF, rest.z + r(0.2)),  // last hop
    rest,
  ];
  const durs = [0.62, 0.2, 0.3, 0.3, 0.36 + i * 0.05], arcs = [1.15, 0.2, 0.42, 0.24, 0.05];
  const segs = []; let t = RELEASE;
  for (let k = 0; k < durs.length; k++) { segs.push({ a: pts[k], b: pts[k + 1], t0: t, t1: t + durs[k], arc: arcs[k] }); t += durs[k]; }
  return { segs, end: t, rest };
}

function start(d1, d2) {
  const values = [d1, d2];
  plan = {
    t0: performance.now(),
    dice: values.map((v, i) => {
      const f = flight(i);
      const yaw = new THREE.Quaternion().setFromAxisAngle(Y, (Math.random() - 0.5) * 1.1);
      return {
        ...f,
        final: yaw.multiply(TOP[v]),                                    // value on top, small random turn
        axis: new THREE.Vector3(0.25 * (Math.random() - 0.5), 0.3 * (Math.random() - 0.5), -1).normalize(), // tumbling forward
        spin: Math.PI * (9 + Math.random() * 5),
      };
    }),
  };
  plan.focus = plan.dice[0].rest.clone().add(plan.dice[1].rest).multiplyScalar(0.5);
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), camPos = new THREE.Vector3(), camAim = new THREE.Vector3();
const SHOULDER = new THREE.Vector3(-8.4, 2.9, 1.5);

function pose(t) {
  // Shooter's hand: wind back, then sweep forward to the release point and withdraw.
  const back = new THREE.Vector3(-6.7, 0.85, 0.7), fwd = new THREE.Vector3(-5.1, 1.35, 0.35), away = new THREE.Vector3(-7.6, 1.6, 1.3);
  if (t < RELEASE) lerp3(back, fwd, smooth(t / RELEASE) ** 1.5, fist.position);
  else lerp3(fwd, away, smooth((t - RELEASE) / 0.7), fist.position);
  armMat.opacity = 0.82 * (1 - smooth((t - RELEASE - 0.25) / 0.6));
  arm.visible = fist.visible = armMat.opacity > 0.01;
  tmpV.copy(fist.position).sub(SHOULDER);
  const len = tmpV.length();
  arm.position.copy(SHOULDER).addScaledVector(tmpV, 0.5);
  arm.scale.set(1, len, 1);
  arm.quaternion.setFromUnitVectors(Y, tmpV.normalize());

  plan.dice.forEach((p, i) => {
    const die = dice[i];
    if (t < RELEASE) {
      die.position.copy(fist.position).add(tmpV.set(0.3, 0.12 + i * 0.05, (i ? 1 : -1) * 0.2));
    } else if (t >= p.end) {
      die.position.copy(p.rest);
    } else {
      const s = p.segs.find((q) => t < q.t1) || p.segs[p.segs.length - 1];
      const u = (t - s.t0) / (s.t1 - s.t0);
      lerp3(s.a, s.b, u, die.position);
      die.position.y += s.arc * 4 * u * (1 - u);
    }
    const left = 1 - smooth((t - RELEASE * 0.4) / (p.end - RELEASE * 0.4));   // spin unwinds to exactly zero at rest
    die.quaternion.copy(p.final).multiply(tmpQ.setFromAxisAngle(p.axis, p.spin * left * left));
  });

  // Camera: wide over the shooter's shoulder, then travel down the table and settle above the dice.
  const portrait = camera.aspect < 1;
  const wide = portrait ? tmpV.set(-9.5, 13, 0) : tmpV.set(-11, 6, 0);   // portrait looks steeply down so the whole table fills the screen
  const close = new THREE.Vector3(plan.focus.x - (portrait ? 1.5 : 1.3), portrait ? 4.1 : 3.0, plan.focus.z);   // steep, so the top faces dominate
  const u = smooth((t - 0.35) / 1.75);
  lerp3(wide, close, u, camPos);
  lerp3(new THREE.Vector3(-0.5, 0, 0), new THREE.Vector3(plan.focus.x + 0.25, 0, plan.focus.z), u, camAim);
  camera.position.copy(camPos);
  camera.lookAt(camAim);
}

function frame(now) {
  if (!plan) return;
  const t = (now - plan.t0) / 1000;
  pose(t);
  renderer.render(scene, camera);
  if (t < LAND_MS / 1000 + 0.2) raf = requestAnimationFrame(frame);   // then hold the last frame
}

/** Which value each die currently shows on top - used to prove animation and result agree. */
function tops() {
  return dice.map((d) => {
    let best = -2, val = 0;
    FACE_NORMALS.forEach((n, i) => { const y = tmpV.set(...n).applyQuaternion(d.quaternion).y; if (y > best) { best = y; val = FACE_VALUES[i]; } });
    return val;
  });
}

window.Roll3D = {
  LAND_MS,
  /** Returns false if WebGL is unavailable, so the caller can fall back. */
  play(container, d1, d2) {
    try { if (!renderer) build(container); resize(); start(d1, d2); return true; } catch (e) { console.warn('3D roll unavailable', e); window.Roll3D = null; return false; }
  },
  stop() { cancelAnimationFrame(raf); plan = null; },
  /** Test hook: draw the current roll frozen at time t (seconds). */
  at(t) { cancelAnimationFrame(raf); pose(t); renderer.render(scene, camera); },
  tops,
};
