// Lathe & Luster — a rusty antique spins on the lathe table; hold on it and the crust peels off in rings until
// the metal shines. Sell it, upgrade tools, unlock metals, fill the shelf.
import * as THREE from './vendor/three.module.js';
import { RoomEnvironment } from './vendor/addons/environments/RoomEnvironment.js';
import { platform } from './platform.js';
import { audio } from './audio.js';
import { METALS, SHAPES, UPGRADES, shapesAvailable, metalsAvailable } from './data.js';

const Q = new URLSearchParams(location.search);
const DEBUG = Q.has('debug');
const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

// ---------- tuning ----------
const MW = 256, MH = 128;                      // dirt mask size (u around, v along the profile)
const BASE_SPIN = 3.6;                         // rad/s
const BRUSH_R = 0.15, BRUSH_VSTRETCH = 1.7;    // world units; brush head is taller than wide
const BASE_POWER = 5.0;                        // dirt units per second at the brush centre
const DONE_AT = 0.92;                          // progress that finishes a piece (the rest is wiped by the reveal)
const OBJ_H = 1.2;                            // tallest piece height in world units

// ---------- state / save ----------
const S = { coins: 0, lv: { size: 0, power: 0, speed: 0, helper: 0 }, shelf: {}, restored: 0, sound: true, music: true, lastSeen: 0, sales: 0 };
const SAVE_KEY_FIELDS = Object.keys(S);
let saveT = 0;
function save() { S.lastSeen = Date.now(); const s = JSON.stringify(S); platform.writeLocal(s); }
function saveSoon() { saveT = 1.5; }

// ---------- renderer / scene ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: DEBUG });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
const LOOK = new THREE.Vector3(0, 0.62, 0);

const key = new THREE.DirectionalLight(0xffe2b8, 2.4);
key.position.set(-2.2, 4.2, 2.6); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -1.6; key.shadow.camera.right = 1.6; key.shadow.camera.top = 2.2; key.shadow.camera.bottom = -1.2;
key.shadow.camera.near = 1; key.shadow.camera.far = 10; key.shadow.bias = -0.0008; key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0x9fc4ff, 1.1); rim.position.set(2.5, 2.2, -2.5); scene.add(rim);
scene.add(new THREE.HemisphereLight(0xffe8c8, 0x3a2416, 0.45));

// procedural textures
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const woodTex = canvasTex(1024, 512, (g, w, h) => {
  const r = rnd(3);
  g.fillStyle = '#6a4127'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) { // planks
    const y = i * h / 6; g.fillStyle = `hsl(${20 + r() * 6}, ${36 + r() * 8}%, ${17 + r() * 5}%)`; g.fillRect(0, y, w, h / 6);
    for (let k = 0; k < 70; k++) {
      g.strokeStyle = `rgba(${r() < 0.5 ? '40,22,12' : '150,100,62'},${0.08 + r() * 0.12})`; g.lineWidth = 1 + r() * 2;
      g.beginPath(); const yy = y + r() * h / 6; g.moveTo(0, yy);
      for (let x = 0; x <= w; x += 64) g.lineTo(x, yy + Math.sin(x * 0.01 + k) * 3 + (r() - 0.5) * 2); g.stroke();
    }
    g.fillStyle = 'rgba(20,10,5,.55)'; g.fillRect(0, y, w, 2);
  }
});
woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping; woodTex.repeat.set(2, 1.2);

const wallTex = canvasTex(1024, 512, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#24160e'); grd.addColorStop(1, '#3e281a'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.fillStyle = 'rgba(0,0,0,.22)'; for (let y = 12; y < h; y += 18) for (let x = 9; x < w; x += 18) { g.beginPath(); g.arc(x, y, 1.6, 0, TAU); g.fill(); }
  // tool silhouettes on the pegboard
  g.fillStyle = 'rgba(12,7,4,.55)';
  const tool = (x, y, s, rot, path) => { g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s); g.fill(new Path2D(path)); g.restore(); };
  const HAMMER = 'M-6 0h12v90h-12zM-26 -18h52v22h-52z', WRENCH = 'M-5 0h10v100h-10zM-16 -26a16 16 0 1 0 32 0l-8 0v10h-16v-10z', SAW = 'M0 0h120l-10 40h-110zM-30 0h30v26h-30z', PLIERS = 'M-4 0l8 0 10 80-6 2-12-60-12 60-6-2z';
  tool(150, 120, 1.1, 0.12, HAMMER); tool(240, 110, 1, -0.1, WRENCH); tool(330, 150, 1, 0.05, SAW); tool(560, 120, 1, 0.2, PLIERS);
  tool(690, 120, 1.1, -0.15, HAMMER); tool(800, 120, 1, 0.08, WRENCH); tool(880, 150, 0.9, -0.05, SAW);
  const v = g.createRadialGradient(w / 2, h * 0.65, h * 0.15, w / 2, h * 0.6, w * 0.6); v.addColorStop(0, 'rgba(255,190,120,.22)'); v.addColorStop(1, 'rgba(0,0,0,.6)');
  g.fillStyle = v; g.fillRect(0, 0, w, h);
});

// bench, wall
const bench = new THREE.Mesh(new THREE.BoxGeometry(9, 0.4, 4), new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.72, metalness: 0 }));
bench.position.set(0, -0.2, -0.4); bench.receiveShadow = true; scene.add(bench);
const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshBasicMaterial({ map: wallTex, toneMapped: false, color: 0xb0a090 }));
wall.position.set(0, 2.6, -2.4); scene.add(wall);
// warm light pool on the bench
const pool = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  map: canvasTex(256, 256, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(255,190,120,.30)'); r.addColorStop(1, 'rgba(255,190,120,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); }) }));
pool.rotation.x = -Math.PI / 2; pool.position.y = 0.002; scene.add(pool);

// the lathe table: cast-iron base + brass turntable with grooves
const castIron = new THREE.MeshStandardMaterial({ color: 0x2f4a3f, roughness: 0.55, metalness: 0.35 });
const brassDark = new THREE.MeshStandardMaterial({ color: 0x8a6a36, roughness: 0.38, metalness: 1 });
const baseM = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.1, 64), castIron); baseM.position.y = 0.05; baseM.castShadow = baseM.receiveShadow = true; scene.add(baseM);
const table = new THREE.Group(); table.position.y = 0.1; scene.add(table);
const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.04, 64), brassDark); plate.position.y = 0.02; plate.receiveShadow = true; table.add(plate);
for (const rr of [0.22, 0.38, 0.54]) { const g = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.006, 6, 64), castIron); g.rotation.x = Math.PI / 2; g.position.y = 0.041; table.add(g); }
const mark = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.1), castIron); mark.position.set(0, 0.045, 0.53); table.add(mark);
const TABLE_TOP = 0.14;

// side props: background shelves holding the latest restored pieces
const shelfPlankM = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.75 });
const shelves = [];
for (const sx of [-1, 1]) {
  const p = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.45), shelfPlankM); p.position.set(sx * 2.05, 1.05, -1.45); p.receiveShadow = true; scene.add(p);
  shelves.push(p);
}
const shelfSlots = [];
for (let i = 0; i < 8; i++) { const side = i < 4 ? -1 : 1, k = i % 4; shelfSlots.push(new THREE.Vector3(side * (1.45 + k * 0.4), 1.08, -1.42)); }
const shelfItems = [];

// ---------- noise ----------
function tileNoise(size, period, seed) {
  const r = rnd(seed), g = new Float32Array(period * period); for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / size * period, fy = y / size * period, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[(y0 % period) * period + (x0 % period)], b = g[(y0 % period) * period + ((x0 + 1) % period)];
    const c = g[((y0 + 1) % period) * period + (x0 % period)], d = g[((y0 + 1) % period) * period + ((x0 + 1) % period)];
    out[y * size + x] = lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
  }
  return out;
}
function fbm(size, seed, oct = [4, 8, 16, 32]) {
  const out = new Float32Array(size * size); let tot = 0;
  oct.forEach((p, i) => { const n = tileNoise(size, p, seed + i * 17), a = 1 / (i + 1); tot += a; for (let k = 0; k < out.length; k++) out[k] += n[k] * a; });
  for (let k = 0; k < out.length; k++) out[k] /= tot; return out;
}
const NZ = 128;
const noiseTex = (() => {
  const a = fbm(NZ, 11, [4, 8, 16]), b = fbm(NZ, 29, [8, 16, 32]), c = fbm(NZ, 47, [16, 32]);
  const d = new Uint8Array(NZ * NZ * 4);
  const st = (x) => clamp((x - 0.5) * 2.2 + 0.5, 0, 1);
  for (let i = 0; i < NZ * NZ; i++) { d[i * 4] = st(a[i]) * 255; d[i * 4 + 1] = st(b[i]) * 255; d[i * 4 + 2] = st(c[i]) * 255; d[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(d, NZ, NZ, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
})();
const CN = 128, crustNoise = fbm(CN, 5, [4, 8, 16]);

// ---------- dirt mask ----------
const dirt = new Float32Array(MW * MH);        // 1 = thick crust, 0.5 = bare dull metal, 0 = mirror polish
const dirt0 = new Float32Array(MW * MH);
const maskBytes = new Uint8Array(MW * MH);
const maskTex = new THREE.DataTexture(maskBytes, MW, MH, THREE.RedFormat, THREE.UnsignedByteType);
maskTex.wrapS = THREE.RepeatWrapping; maskTex.wrapT = THREE.ClampToEdgeWrapping; maskTex.magFilter = maskTex.minFilter = THREE.LinearFilter; maskTex.needsUpdate = true;
let maskDirty = true;
const rowW = new Float32Array(MH);              // 1 = row the player can see/reach
let wSum = 1, d0Sum = 1, dSum = 1, crustSum = 0, crust0 = 1;

function uploadMask() {
  for (let i = 0; i < dirt.length; i++) maskBytes[i] = dirt[i] * 255;
  maskTex.needsUpdate = true; maskDirty = false;
}
function recount() {
  let s = 0, c = 0;
  for (let y = 0; y < MH; y++) { if (!rowW[y]) continue; const o = y * MW; for (let x = 0; x < MW; x++) { const d = dirt[o + x]; s += d; if (d > 0.5) c += d - 0.5; } }
  dSum = s; crustSum = c;
}

// ---------- piece material ----------
function pieceMaterial() {
  const m = new THREE.MeshStandardMaterial({ map: noiseTex, roughness: 0.4, metalness: 1, envMapIntensity: 1.15 });
  m.userData.u = {
    uMask: { value: maskTex }, uMetal: { value: new THREE.Color() }, uDull: { value: new THREE.Color() },
    uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() },
    uSweep: { value: -1 }, uGlow: { value: 0 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uMask; uniform vec3 uMetal, uDull, uC0, uC1, uC2; uniform float uSweep, uGlow;`)
      .replace('#include <map_fragment>', `
        vec3 nz = texture2D(map, vMapUv * vec2(4.0, 2.0)).rgb;
        vec3 nz2 = texture2D(map, vMapUv * vec2(14.0, 7.0)).rgb;
        float dm = texture2D(uMask, vMapUv).r;
        float crust = smoothstep(0.5, 0.56, dm + (nz2.g - 0.5) * 0.05);
        float dull = clamp(dm / 0.5, 0.0, 1.0);
        dull = smoothstep(0.0, 1.0, dull);
        float blot = smoothstep(0.3, 0.75, nz.r * 0.7 + nz2.g * 0.3);
        vec3 crustCol = mix(uC0, uC1, 0.3 + blot * 0.6);
        crustCol = mix(crustCol, uC2, smoothstep(0.6, 0.9, nz2.b) * blot * 0.4);
        crustCol *= 0.8 + 0.3 * nz2.r;
        float edge = crust * (1.0 - smoothstep(0.56, 0.68, dm));
        vec3 metalCol = mix(uMetal, uDull, dull * (0.75 + 0.25 * nz.g));
        diffuseColor.rgb = mix(metalCol, crustCol, crust);
        diffuseColor.rgb *= 1.0 - edge * 0.5;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(mix(0.07, 0.5 + nz2.g * 0.2, dull), 0.95, crust);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(1.0, 0.0, crust);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(normal + crust * (nz2 - 0.5) * 0.9 + (1.0 - crust) * dull * (nz - 0.5) * 0.12);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float band = uSweep < -0.5 ? 0.0 : exp(-pow((vMapUv.y - uSweep) * 9.0, 2.0));
        totalEmissiveRadiance += vec3(1.0, 0.9, 0.7) * (band * 0.8 + uGlow * 0.12) * (1.0 - crust);`);
  };
  return m;
}
const pieceMat = pieceMaterial();
const cleanMats = METALS.map((mt) => new THREE.MeshStandardMaterial({ color: mt.metal, metalness: 1, roughness: 0.12, envMapIntensity: 1.2 }));

// ---------- pieces ----------
function profileCurve(shape, n) {
  const sc = OBJ_H / 1.45;
  const c = new THREE.CatmullRomCurve3(shape.pts.map(([r, y]) => new THREE.Vector3(Math.max(0.0001, r) * sc, y * sc, 0)), false, 'centripetal', 0.5);
  const pts = c.getSpacedPoints(n - 1).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  pts[0].x = shape.pts[0][0] === 0 ? 0 : pts[0].x; pts[pts.length - 1].x = shape.pts.at(-1)[0] === 0 ? 0 : pts.at(-1).x;
  return pts;
}
const geoCache = {};
function pieceGeo(si) {
  if (geoCache[si]) return geoCache[si];
  const pts = profileCurve(SHAPES[si], 160), proxyPts = profileCurve(SHAPES[si], 64);
  const g = new THREE.LatheGeometry(pts, 72), p = new THREE.LatheGeometry(proxyPts, 32);
  const prof = new Float32Array(MH), profY = new Float32Array(MH);
  for (let y = 0; y < MH; y++) { const f = y / (MH - 1) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), t = f - i; prof[y] = lerp(pts[i].x, pts[i + 1].x, t); profY[y] = lerp(pts[i].y, pts[i + 1].y, t); }
  let h = 0; for (const q of pts) h = Math.max(h, q.y);
  return (geoCache[si] = { g, p, prof, profY, h });
}
const holder = new THREE.Group(); scene.add(holder); holder.position.y = TABLE_TOP;
let piece = null, proxy = null, cur = null;   // cur = { si, mi, geo, value }

let choosePieceOverride = null, frozen = false;
function choosePiece() {
  if (choosePieceOverride) return choosePieceOverride;
  const n = S.restored, nm = metalsAvailable(n), ns = shapesAvailable(n);
  if (n === 0) return { si: 0, mi: 0 };
  for (let mi = nm - 1; mi >= 0; mi--) for (let si = 0; si < ns; si++) if (!S.shelf[`${mi}:${si}`] && !(mi === lastPick.mi && si === lastPick.si)) return { si, mi };
  const r = rnd(n * 7919 + 13); let si, mi;
  do { si = Math.floor(r() * ns); mi = Math.max(0, nm - 1 - Math.floor(r() * r() * nm)); } while (si === lastPick.si && mi === lastPick.mi && ns > 1);
  return { si, mi };
}
let lastPick = { si: -1, mi: -1 };

function setupPiece() {
  const { si, mi } = choosePiece(); lastPick = { si, mi };
  const geo = pieceGeo(si), mt = METALS[mi];
  if (piece) holder.remove(piece);
  piece = new THREE.Mesh(geo.g, pieceMat); piece.castShadow = true; piece.receiveShadow = true;
  proxy = new THREE.Mesh(geo.p, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); proxy.visible = false;
  piece.add(proxy);
  holder.add(piece);
  const u = pieceMat.userData.u;
  u.uMetal.value.set(mt.metal); u.uDull.value.set(mt.dull); u.uC0.value.set(mt.crust[0]); u.uC1.value.set(mt.crust[1]); u.uC2.value.set(mt.crust[2]);
  u.uSweep.value = -1; u.uGlow.value = 0;
  const value = Math.round(SHAPES[si].base * mt.mult * (1 + Math.min(1, S.restored / 40) * 0.5));
  cur = { si, mi, geo, value, doneAt: S.restored === 0 ? 0.82 : S.restored === 1 ? 0.88 : DONE_AT, tough: mt.tough * (S.restored === 0 ? 0.42 : S.restored === 1 ? 0.75 : 1) * (1 + si * 0.04) };
  // visibility per row (cached per shape): for every other row, a ray from the camera to the front and back point of
  // that ring; the row counts if that ray really lands on it (inside walls are seen through the opening)
  holder.updateMatrixWorld(true);
  piece.rotation.y = 0; piece.updateMatrixWorld(true);
  if (!geo.rowW) {
    geo.rowW = new Float32Array(MH);
    const rc = new THREE.Raycaster(), P = new THREE.Vector3(), dir = new THREE.Vector3();
    for (let y = 0; y < MH; y += 2) for (const zs of [0.97, -0.97]) {
      P.set(0, TABLE_TOP + geo.profY[y], geo.prof[y] * zs); dir.copy(P).sub(camera.position).normalize();
      rc.set(camera.position, dir);
      const hit = rc.intersectObject(proxy, false)[0]; if (!hit || !hit.uv) continue;
      const ry = Math.round(hit.uv.y * (MH - 1)); if (Math.abs(ry - y) > 3) continue;
      for (let d = -3; d <= 3; d++) if (y + d >= 0 && y + d < MH) geo.rowW[y + d] = 1;
    }
  }
  rowW.set(geo.rowW);
  piece.rotation.y = 0;
  // fresh crust
  const seed = (S.restored * 37) % CN;
  wSum = 0; d0Sum = 0;
  for (let y = 0; y < MH; y++) {
    const o = y * MW;
    for (let x = 0; x < MW; x++) {
      const n = crustNoise[((y + seed) % CN) * CN + (x >> 1)];
      let d = rowW[y] ? clamp(0.6 + 0.45 * (n - 0.35) * 1.6, 0.56, 1) : 0.3;
      dirt[o + x] = d; dirt0[o + x] = d;
      if (rowW[y]) { wSum += MW; d0Sum += d; }
    }
  }
  recount(); crust0 = crustSum; uploadMask();
  progress = 0; stage = 'crust'; revealT = -1; helperV = 0.3;
  piece.position.set(-2.4, 0, 0); slideIn = 1;
  $('pieceName').textContent = `${mt.name} ${SHAPES[si].name}`;
  updateGoalNext();
  setStageUI();
}

// ---------- brushing ----------
const ray = new THREE.Raycaster();
const ndcV = new THREE.Vector2();
const tmpV = new THREE.Vector3();
let removedFrame = 0, crustRemovedFrame = 0, lastHit = null;
function brushR() { return BRUSH_R * (1 + 0.13 * S.lv.size); }
function brushP() { return BASE_POWER * (1 + 0.28 * S.lv.power); }
function spin() { return BASE_SPIN * (1 + 0.12 * S.lv.speed); }

function stamp(u, v, rWorld, power, dt) {
  const y0 = v * (MH - 1), x0 = u * MW;
  const rRow = Math.max(0.03, cur.geo.prof[clamp(Math.round(y0), 0, MH - 1)]);
  const ru = clamp(rWorld / (TAU * rRow) * MW, 1.5, MW / 2), rv = clamp(rWorld * BRUSH_VSTRETCH / 1.9 * (MH - 1), 1.5, MH / 2);
  const tough = cur.tough;
  let rem = 0, crem = 0;
  for (let y = Math.max(0, Math.floor(y0 - rv)); y <= Math.min(MH - 1, Math.ceil(y0 + rv)); y++) {
    const dy = (y - y0) / rv, o = y * MW, live = rowW[y];
    for (let xi = Math.floor(x0 - ru); xi <= Math.ceil(x0 + ru); xi++) {
      const dx = (xi - x0) / ru, q = dx * dx + dy * dy; if (q >= 1) continue;
      const f = q < 0.45 ? 1 : 1 - (q - 0.45) / 0.55;
      const i = o + ((xi % MW) + MW) % MW; const d = dirt[i]; if (d <= 0) continue;
      const k = power * dt * f * (d > 0.5 ? 1 / tough : 1.25);
      const nd = Math.max(0, d - k); dirt[i] = nd;
      if (live) { rem += d - nd; if (d > 0.5) crem += d - Math.max(0.5, nd); }
    }
  }
  dSum -= rem; crustSum -= crem; removedFrame += rem; crustRemovedFrame += crem;
  if (rem > 0) maskDirty = true;
  return rem;
}

function hitAt(px, py) {
  ndcV.set(px / innerWidth * 2 - 1, -(py / innerHeight) * 2 + 1);
  ray.setFromCamera(ndcV, camera);
  return ray.intersectObject(proxy, false)[0] || null;
}

// ---------- particles ----------
function makePoints(max, additive) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1)); g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uScale: { value: 300 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale;
      void main() { vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: additive
      ? `varying vec3 vC; varying float vA; void main() { vec2 p = gl_PointCoord - 0.5; float d = length(p); float s = max(0.0, 1.0 - d * 2.0); float cross = max(0.0, 1.0 - abs(p.x) * 14.0) * max(0.0, 1.0 - abs(p.y) * 2.2) + max(0.0, 1.0 - abs(p.y) * 14.0) * max(0.0, 1.0 - abs(p.x) * 2.2); gl_FragColor = vec4(vC * (s * s + cross * 0.9) * vA, 1.0); }`
      : `varying vec3 vC; varying float vA; void main() { vec2 p = gl_PointCoord - 0.5; if (abs(p.x) + abs(p.y) * 1.3 > 0.5) discard; gl_FragColor = vec4(vC, vA); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
  const P = []; for (let i = 0; i < max; i++) P.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0, r: 1, g: 1, b: 1, rest: false });
  return { pts, P, g, pos, col, size, alpha, next: 0, max };
}
const flakes = makePoints(700, false), glints = makePoints(300, true);
const tmpC = new THREE.Color();
function emit(sys, n, at, opts) {
  for (let k = 0; k < n; k++) {
    const p = sys.P[sys.next]; sys.next = (sys.next + 1) % sys.max;
    p.life = p.max = opts.life * (0.7 + Math.random() * 0.6); p.rest = false;
    p.x = at.x + (Math.random() - 0.5) * opts.spread; p.y = at.y + (Math.random() - 0.5) * opts.spread; p.z = at.z + (Math.random() - 0.5) * opts.spread;
    const v = opts.vel(); p.vx = v.x; p.vy = v.y; p.vz = v.z;
    p.s = opts.size * (0.6 + Math.random() * 0.8);
    const c = opts.color(); p.r = c.r; p.g = c.g; p.b = c.b;
  }
}
function updatePoints(sys, dt, grav, floorY) {
  for (let i = 0; i < sys.max; i++) {
    const p = sys.P[i];
    if (p.life > 0) {
      p.life -= dt;
      if (!p.rest) {
        p.vy -= grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const fl = Math.hypot(p.x, p.z) < 0.6 ? TABLE_TOP : floorY;
        if (grav > 0 && p.y < fl) { p.y = fl; if (Math.abs(p.vy) > 0.6) { p.vy *= -0.25; p.vx *= 0.5; p.vz *= 0.5; } else { p.rest = true; p.life = Math.min(p.life, 0.2); p.max = Math.max(p.max, 0.6); } }
        if (grav === 0) { p.vx *= 0.92; p.vy *= 0.92; p.vz *= 0.92; }
      }
    }
    const t = Math.max(0, p.life / p.max);
    sys.pos[i * 3] = p.x; sys.pos[i * 3 + 1] = p.y; sys.pos[i * 3 + 2] = p.z;
    sys.col[i * 3] = p.r; sys.col[i * 3 + 1] = p.g; sys.col[i * 3 + 2] = p.b;
    sys.size[i] = p.life > 0 ? p.s * (grav > 0 ? 1 : Math.sin(t * Math.PI)) : 0;
    sys.alpha[i] = p.life > 0 ? (grav > 0 ? Math.min(1, t * 3) : 1) : 0;
  }
  for (const k of ['position', 'color', 'size', 'alpha']) sys.g.attributes[k].needsUpdate = true;
}
function crustColor() { const c = METALS[cur.mi].crust[1 + (Math.random() < 0.5 ? 1 : 0)]; tmpC.set(c); const m = 0.7 + Math.random() * 0.5; return { r: tmpC.r * m, g: tmpC.g * m, b: tmpC.b * m }; }
const glintCol = () => ({ r: 1, g: 0.92 + Math.random() * 0.08, b: 0.75 + Math.random() * 0.2 });

function emitAt(worldP, normalW, crustAmt, polishAmt) {
  if (crustAmt > 0) {
    const n = Math.min(10, Math.ceil(crustAmt * 0.06));
    const w = spin();
    emit(flakes, n, worldP, { life: 0.9, spread: 0.03, size: 0.028, color: crustColor,
      vel: () => ({ x: -worldP.z * w * 0.45 + normalW.x * 0.8 + (Math.random() - 0.5) * 0.7, y: 0.4 + Math.random() * 0.9, z: worldP.x * w * 0.45 + normalW.z * 0.8 + (Math.random() - 0.5) * 0.7 }) });
  }
  if (polishAmt > 0) {
    const n = Math.min(4, Math.ceil(polishAmt * 0.04));
    emit(glints, n, worldP, { life: 0.45, spread: 0.12, size: 0.07, color: glintCol, vel: () => ({ x: normalW.x * 0.3, y: 0.1 + Math.random() * 0.2, z: normalW.z * 0.3 }) });
  }
}

// ---------- input ----------
const pointer = { x: 0, y: 0, down: false, over: false, id: null, heldT: 0 };
let idleT = 0, everHeld = 0;
const toolEl = $('tool');
function sizeTool() {
  const d = camera.position.distanceTo(LOOK), px = brushR() * innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * d);
  const w = Math.round(px * 2), h = Math.round(px * 2 * 1.5);
  toolEl.style.width = `${w}px`; toolEl.style.height = `${h}px`; toolEl.style.margin = `${-h / 2}px 0 0 ${-w / 2}px`;
}
function placeTool() { toolEl.style.transform = `translate(${pointer.x}px, ${pointer.y}px)`; }
canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (pointer.down && e.pointerId !== pointer.id) return;
  pointer.down = true; pointer.id = e.pointerId; pointer.x = e.clientX; pointer.y = e.clientY; pointer.over = true;
  canvas.setPointerCapture?.(e.pointerId);
  toolEl.classList.add('on', 'down'); placeTool();
  lastHit = null;
  if (!away) { if (state === 'play') brushTick(1 / 60, true); pressPuff(); }   // respond on this very event, in every state
});
canvas.addEventListener('pointermove', (e) => {
  if (pointer.down && e.pointerId !== pointer.id) return;
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.over = true;
  if (e.pointerType === 'mouse') toolEl.classList.add('on');
  placeTool();
});
const up = (e) => { if (e.pointerId !== pointer.id) return; pointer.down = false; pointer.id = null; toolEl.classList.remove('down'); if (e.pointerType !== 'mouse') toolEl.classList.remove('on'); lastHit = null; };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pointer.down) toolEl.classList.remove('on'); });
addEventListener('keydown', (e) => { if (e.code === 'Escape') closePanels(); });
addEventListener('contextmenu', (e) => e.preventDefault());

const lastPoint = new THREE.Vector3();
function brushTick(dt, instant = false) {
  if (!pointer.down || !piece || slideIn > 0) return;
  const hit = hitAt(pointer.x, pointer.y);
  if (!hit || !hit.uv) { lastHit = null; return; }
  const u = hit.uv.x, v = hit.uv.y;
  const R = brushR(), P = brushP();
  const c0 = crustRemovedFrame, r0 = removedFrame;
  // interpolate from where the tool touched last frame (the surface keeps turning under it)
  let steps = 1, du = 0, dv = 0;
  if (lastHit) { du = u - lastHit.u; if (du > 0.5) du -= 1; if (du < -0.5) du += 1; dv = v - lastHit.v; steps = clamp(Math.ceil(Math.max(Math.abs(du) * MW / 3, Math.abs(dv) * MH / 3)), 1, 12); }
  for (let s = 1; s <= steps; s++) {
    const t = lastHit ? s / steps : 1;
    stamp(((lastHit ? lastHit.u + du * t : u) + 1) % 1, lastHit ? lastHit.v + dv * t : v, R, P, dt / steps);
  }
  lastHit = { u, v }; lastPoint.copy(hit.point);
  const crem = (crustRemovedFrame - c0), prem = (removedFrame - r0) - crem;
  const nW = hit.face ? hit.face.normal.clone().transformDirection(piece.matrixWorld) : new THREE.Vector3(0, 0, 1);
  emitAt(hit.point, nW, crem * (instant ? 3 : 1), prem * (instant ? 3 : 1));
  pointer.heldT += dt; everHeld += dt;
}

// a visible puff of dust + glints where the brush lands (every press, so the touch always answers at once)
const benchPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), benchHit = new THREE.Vector3();
function pressPuff() {
  const hit = piece && slideIn === 0 && slideOut < 0 ? hitAt(pointer.x, pointer.y) : null;
  if (!hit) {   // off the piece (or between pieces): a little puff of workshop dust where the finger lands
    ndcV.set(pointer.x / innerWidth * 2 - 1, -(pointer.y / innerHeight) * 2 + 1); ray.setFromCamera(ndcV, camera);
    if (!ray.ray.intersectPlane(benchPlane, benchHit)) return;
    benchHit.y = Math.hypot(benchHit.x, benchHit.z) < 0.6 ? TABLE_TOP + 0.01 : 0.01;
    emit(glints, 8, benchHit, { life: 0.45, spread: 0.12, size: 0.11, color: glintCol, vel: () => ({ x: (Math.random() - 0.5) * 0.6, y: 0.4, z: (Math.random() - 0.5) * 0.6 }) });
    contact.position.copy(benchHit); contactT = 0.3; return;
  }
  const nW = hit.face ? hit.face.normal.clone().transformDirection(piece.matrixWorld) : new THREE.Vector3(0, 0, 1);
  const crust = stage === 'crust';
  if (crust) emit(flakes, 16, hit.point, { life: 1.4, spread: 0.06, size: 0.034, color: crustColor, vel: () => ({ x: nW.x * 1.2 + (Math.random() - 0.5) * 1.4, y: 0.5 + Math.random() * 1.2, z: nW.z * 1.2 + (Math.random() - 0.5) * 1.4 }) });
  emit(glints, crust ? 6 : 12, hit.point, { life: 0.5, spread: 0.1, size: 0.12, color: glintCol, vel: () => ({ x: nW.x * 0.5, y: 0.2, z: nW.z * 0.5 }) });
  // soft warm contact glow where the tool touches (fades in ~0.3 s)
  contact.position.copy(hit.point).addScaledVector(nW, 0.03); contactT = 0.3;
}
const contact = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(128, 128, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(255,236,190,1)'); r.addColorStop(0.35, 'rgba(255,200,130,.45)'); r.addColorStop(1, 'rgba(255,180,100,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); }), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
contact.scale.setScalar(0.42); contact.material.opacity = 0; contact.renderOrder = 5; scene.add(contact);
let contactT = 0;

// apprentice: a small buffing wheel on the right that walks up and down the piece
const helper = new THREE.Group();
const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 32), new THREE.MeshStandardMaterial({ color: 0xf3ead6, roughness: 0.9 }));
wheel.rotation.z = Math.PI / 2; helper.add(wheel);
const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.04), castIron); arm.position.x = 0.3; helper.add(arm);
helper.visible = false; scene.add(helper);
let helperV = 0.3, helperDir = 1;
function helperTick(dt) {
  helper.visible = S.lv.helper > 0 && !!piece;
  if (!helper.visible || state !== 'play' || slideIn > 0) return;
  // find a dirty visible row near the current one, walk toward it
  helperV += helperDir * dt * 0.12; if (helperV > 0.95) helperDir = -1; if (helperV < 0.05) helperDir = 1;
  let y = Math.round(helperV * (MH - 1)); if (!rowW[y]) { for (let k = 1; k < MH; k++) { if (rowW[clamp(y + k * helperDir, 0, MH - 1)]) { y = clamp(y + k * helperDir, 0, MH - 1); break; } } helperV = y / (MH - 1); }
  const r = cur.geo.prof[y], hy = cur.geo.profY[y];
  const u = ((Math.PI / 2 - piece.rotation.y) / TAU % 1 + 1) % 1;
  const c0 = crustRemovedFrame, r0 = removedFrame;
  stamp(u, helperV, brushR() * 0.6, BASE_POWER * 0.35 * S.lv.helper, dt);
  helper.position.set(r + 0.11, TABLE_TOP + hy, 0.02);
  wheel.rotation.x += dt * 20;
  const crem = crustRemovedFrame - c0, prem = removedFrame - r0 - crem;
  if (Math.random() < 0.5) emitAt(tmpV.set(r + 0.01, TABLE_TOP + hy, 0), new THREE.Vector3(1, 0, 0), crem, prem);
}

// ---------- game flow ----------
const flyFrom = new THREE.Vector3(), flyTo = new THREE.Vector3();
let state = 'play', progress = 0, stage = 'crust', revealT = -1, slideIn = 0, slideOut = -1, playT = 0, lastAdT = -1e9;
let away = false, panelOpen = null, firstSaleT = null;
let sweepFx = 0, scrubR = 0, scrubP = 0;

function updateGoalNext() {
  const mi = cur.mi, n = SHAPES.filter((_, si) => S.shelf[`${mi}:${si}`]).length, goal = n < 4 ? 4 : SHAPES.length;
  $('goalNext').textContent = n >= SHAPES.length ? `${METALS[mi].name} shelf complete` : `${METALS[mi].name} shelf ${n}/${goal} for a bonus`;
}
function setStageUI() {
  const crust = stage === 'crust';
  $('stage').textContent = crust ? METALS[cur.mi].verb : 'Polish it to a shine';
  $('gaugeF').classList.toggle('pol', !crust);
  $('toolIc').innerHTML = `<use href="#${crust ? 'i-brush' : 'i-cloth'}"/>`;
  $('hint').querySelector('.txt').textContent = crust ? 'Hold on the piece' : 'Keep holding to polish';
}

function updateProgress() {
  progress = clamp(1 - dSum / d0Sum, 0, 1);
  const crustLeft = crustSum / Math.max(1e-6, crust0);
  if (stage === 'crust' && crustLeft < 0.025) { stage = 'polish'; audio.play('ting'); setStageUI(); }
  $('gaugeF').style.width = `${Math.min(100, progress / cur.doneAt * 100).toFixed(1)}%`;
  $('pct').textContent = `${Math.min(100, Math.floor(progress / cur.doneAt * 100))}%`;
  if (progress >= cur.doneAt && state === 'play') startReveal();
}

function startReveal() {
  state = 'reveal'; revealT = 0; pointer.down = false; toolEl.classList.remove('down');
  audio.play('reveal'); platform.happytime?.();
  const key = `${cur.mi}:${cur.si}`, isNew = !S.shelf[key];
  S.shelf[key] = (S.shelf[key] || 0) + 1; S.restored++; S.sales++;
  const rowN = SHAPES.filter((_, si) => S.shelf[`${cur.mi}:${si}`]).length;
  if (isNew && (rowN === 4 || rowN === SHAPES.length)) {
    const bonus = cur.value * (rowN === 4 ? 4 : 10);
    setTimeout(() => { showBanner(`${METALS[cur.mi].name} shelf ${rowN}/${SHAPES.length}!`, `Collector bonus +${bonus}`); audio.play('fanfare'); flyCoins(bonus); }, 1500);
  }
  const val = cur.value;
  cur.sold = val; cur.isNew = isNew;
  if (firstSaleT == null) firstSaleT = playT;
  setTimeout(() => {
    showPop(isNew ? 'New for your shelf!' : 'Sold!', `${METALS[cur.mi].name} ${SHAPES[cur.si].name}  +${val}`);
    flyCoins(val);
    audio.play('sold');
    if (S.sales % 3 === 0 && platform.hasRewarded) showOffer(val);
  }, 700);
  updateShelfBtn(); saveSoon();
}

let offerT = 0, offerVal = 0;
function showOffer(v) { offerVal = v; offerT = 5; $('offer').classList.remove('hidden'); }
$('btnDouble').addEventListener('click', async () => {
  $('offer').classList.add('hidden'); offerT = 0;
  audio.suspend(); setPausedForAd(true);
  const ok = await platform.rewarded(() => {});
  audio.resume(); setPausedForAd(false);
  if (ok) { flyCoins(offerVal); showPop('Doubled!', `+${offerVal}`); }
});
let adPause = false; function setPausedForAd(v) { adPause = v; }

function finishReveal() {
  // piece flies onto the shelf (it lands in slot 0), a new rusty one arrives
  flyFrom.copy(piece.position); flyTo.copy(shelfSlots[0]).sub(holder.position);
  const prevMetals = metalsAvailable(S.restored - 1);
  slideOut = 0;
  const nm = metalsAvailable(S.restored);
  if (nm > prevMetals) setTimeout(() => { showBanner(`${METALS[nm - 1].name} unlocked!`, `${METALS[nm - 1].name} pieces sell for much more`); audio.play('fanfare'); }, 500);
  else if (shapesAvailable(S.restored) > shapesAvailable(S.restored - 1)) setTimeout(() => showBanner(`New piece: ${SHAPES[shapesAvailable(S.restored) - 1].name}`, 'It will come to your bench soon'), 500);
}

function maybeMidgameAd() {
  if (playT < 180 || playT - lastAdT < 180) return Promise.resolve();
  lastAdT = playT;
  return new Promise((res) => {
    setPausedForAd(true); platform.gameplayStop();
    platform.interstitial(() => audio.suspend()).then(() => { audio.resume(); setPausedForAd(false); if (!panelOpen) platform.gameplayStart(); res(); });
  }).catch(() => {});
}

// ---------- HUD ----------
const coinEl = $('coinN');
let shownCoins = 0;
function addCoins(n) { S.coins += n; saveSoon(); refreshUps(); }
function flyCoins(total) {
  const p = tmpV.set(0, TABLE_TOP + cur.geo.h * 0.5, 0).project(camera);
  const sx = (p.x + 1) / 2 * innerWidth, sy = (1 - p.y) / 2 * innerHeight;
  const tgt = $('coins').querySelector('.ic').getBoundingClientRect();
  const n = clamp(Math.round(Math.sqrt(total)), 4, 12), per = Math.floor(total / n);
  let given = 0;
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div'); el.className = 'fcoin'; el.innerHTML = '<svg viewBox="0 0 32 32" width="26" height="26"><use href="#i-coin"/></svg>';
    document.body.appendChild(el);
    const ox = (Math.random() - 0.5) * 140, oy = (Math.random() - 0.5) * 90, delay = i * 45;
    const amt = i === n - 1 ? total - given : per; given += amt;
    el.animate([{ transform: `translate(${sx}px, ${sy}px) scale(.6)` }, { transform: `translate(${sx + ox}px, ${sy + oy}px) scale(1.1)`, offset: 0.35 },
      { transform: `translate(${tgt.left + tgt.width / 2}px, ${tgt.top + tgt.height / 2}px) scale(.8)` }], { duration: 750, delay, easing: 'cubic-bezier(.5,0,.6,1)', fill: 'both' })
      .onfinish = () => { el.remove(); addCoins(amt); audio.play('coin', { vol: 0.7, rate: 0.95 + Math.random() * 0.15 }); const c = $('coins'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); };
  }
  const f = document.createElement('div'); f.className = 'float'; f.textContent = `+${total}`; f.style.left = `${sx}px`; f.style.top = `${sy - 40}px`; document.body.appendChild(f);
  f.animate([{ opacity: 0, transform: 'translate(-50%,-30%) scale(.7)' }, { opacity: 1, transform: 'translate(-50%,-80%) scale(1.1)', offset: 0.25 }, { opacity: 0, transform: 'translate(-50%,-200%) scale(1)' }], { duration: 1300, easing: 'ease-out' }).onfinish = () => f.remove();
}
let popTimer = 0;
function showPop(h, s) { $('popH').textContent = h; $('popS').textContent = s; const p = $('pop'); p.classList.remove('hidden', 'go'); void p.offsetWidth; p.classList.add('go'); clearTimeout(popTimer); popTimer = setTimeout(() => p.classList.add('hidden'), 1700); }
let banTimer = 0;
function showBanner(h, s) { $('banH').textContent = h; $('banS').textContent = s; const b = $('banner'); b.classList.remove('hidden', 'go'); void b.offsetWidth; b.classList.add('go'); clearTimeout(banTimer); banTimer = setTimeout(() => b.classList.add('hidden'), 2600); }

const upsEl = $('ups');
for (const u of UPGRADES) {
  const b = document.createElement('button'); b.className = 'up plate'; b.id = `up-${u.id}`;
  b.innerHTML = `<div class="ic"><svg class="i" viewBox="0 0 32 32"><use href="#${u.icon}"/></svg></div><div class="tx"><div class="t">${u.name}</div><div class="l"></div></div><div class="c"><svg viewBox="0 0 32 32"><use href="#i-coin"/></svg><span></span></div>`;
  b.addEventListener('click', () => buy(u));
  upsEl.appendChild(b);
}
function refreshUps() {
  for (const u of UPGRADES) {
    const b = $(`up-${u.id}`), l = S.lv[u.id], max = l >= u.max, c = u.cost(l);
    b.querySelector('.l').textContent = max ? 'Max level' : `Level ${l}`;
    b.querySelector('.c span').textContent = max ? 'MAX' : c;
    b.classList.toggle('max', max); b.classList.toggle('off', !max && S.coins < c); b.classList.toggle('ready', !max && S.coins >= c);
  }
}
function placeAtPiece() { if (pointer.over) return; const p = tmpV.set(0, TABLE_TOP + cur.geo.h * 0.5, 0.4).project(camera); pointer.x = (p.x + 1) / 2 * innerWidth; pointer.y = (1 - p.y) / 2 * innerHeight; placeTool(); }
function buy(u) {
  audio.unlock();
  const l = S.lv[u.id]; if (l >= u.max) return;
  const c = u.cost(l);
  if (S.coins < c) { audio.play('error'); const b = $(`up-${u.id}`); b.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 200 }); return; }
  S.coins -= c; S.lv[u.id]++; audio.play('buy'); refreshUps(); saveSoon();
  if (u.id === 'size') { sizeTool(); toolEl.classList.add('on'); placeAtPiece(); toolEl.animate([{ transform: toolEl.style.transform + ' scale(1.35)' }, { transform: toolEl.style.transform }], { duration: 450, easing: 'cubic-bezier(.3,1.6,.5,1)' }); showPop('Bigger brush!', `Level ${S.lv.size}`); }
  if (u.id === 'power') showPop('Stronger scrub!', `Rust comes off ${Math.round(28 * S.lv.power)}% faster`);
  if (u.id === 'speed') showPop('Faster lathe!', `Level ${S.lv.speed}`);
  if (u.id === 'helper' && S.lv.helper === 1) showBanner('Apprentice hired!', 'Polishes the piece for you, even when you rest');
}
function updateShelfBtn() { const n = Object.keys(S.shelf).length; $('shelfN').textContent = `${n}/${METALS.length * SHAPES.length}`; }

// shelf panel
function shapeSvg(si, color) {
  const pts = SHAPES[si].pts; const right = pts.map(([r, y]) => `${50 + r * 62},${92 - y * 58}`); const left = pts.slice().reverse().map(([r, y]) => `${50 - r * 62},${92 - y * 58}`);
  return `<svg viewBox="0 0 100 100"><polygon points="${right.join(' ')} ${left.join(' ')}" fill="${color}" stroke="#24160d" stroke-width="3" stroke-linejoin="round"/></svg>`;
}
function openShelf() {
  const g = $('shelfGrid'); g.innerHTML = '';
  const nm = metalsAvailable(S.restored);
  METALS.forEach((mt, mi) => {
    const lab = document.createElement('div'); lab.className = 'rowlab' + (mi < nm ? '' : ' lock');
    const have = SHAPES.filter((_, si) => S.shelf[`${mi}:${si}`]).length;
    lab.innerHTML = `<span>${mt.name}</span><span>${mi < nm ? `${have}/${SHAPES.length}` : `unlocks after ${mt.unlock} pieces`}</span>`; g.appendChild(lab);
    SHAPES.forEach((sh, si) => {
      const c = document.createElement('div'); c.className = 'cell'; const n = S.shelf[`${mi}:${si}`];
      c.innerHTML = shapeSvg(si, n ? mt.metal : '#3a2818') + (n > 1 ? `<b>x${n}</b>` : '');
      g.appendChild(c);
    });
  });
  $('shelfSub').textContent = `${Object.keys(S.shelf).length} of ${METALS.length * SHAPES.length} pieces restored`;
  openPanel('shelf');
}
function openPanel(id) { audio.unlock(); audio.play('open'); panelOpen = id; $('veil').classList.remove('hidden'); $(id).classList.remove('hidden'); platform.gameplayStop(); pointer.down = false; }
function closePanels() { if (!panelOpen) return; audio.play('close'); $(panelOpen).classList.add('hidden'); $('veil').classList.add('hidden'); panelOpen = null; if (!away) platform.gameplayStart(); }
$('btnShelf').addEventListener('click', openShelf);
$('btnSet').addEventListener('click', () => { syncToggles(); openPanel('settings'); });
$('veil').addEventListener('click', closePanels);
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closePanels));
function syncToggles() { $('tSound').querySelector('span').textContent = S.sound ? 'On' : 'Off'; $('tMusic').querySelector('span').textContent = S.music ? 'On' : 'Off'; }
$('tSound').addEventListener('click', () => { S.sound = !S.sound; audio.setSound(S.sound && portalAudio); syncToggles(); saveSoon(); });
$('tMusic').addEventListener('click', () => { S.music = !S.music; audio.setMusic(S.music && portalAudio); syncToggles(); saveSoon(); });
let portalAudio = true;
platform.onAudio = (on) => { portalAudio = on; audio.setSound(S.sound && on); audio.setMusic(S.music && on); };

// shelf props in the scene
function addShelfItem(si, mi) {
  const geo = pieceGeo(si), m = new THREE.Mesh(geo.g, cleanMats[mi]); m.scale.setScalar(0.24); m.castShadow = true;
  shelfItems.unshift(m); scene.add(m);
  while (shelfItems.length > shelfSlots.length) scene.remove(shelfItems.pop());
  shelfItems.forEach((it, i) => it.position.copy(shelfSlots[i]));
}

// ---------- layout ----------
function layout() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // fit the piece (≈1.9 tall incl. table, ≈1.5 wide) with room for the HUD
  const short = h < 500 && w > h, needH = short ? 2.05 : 2.25, needW = 1.55;
  LOOK.y = short ? 0.8 : 0.62;
  const vf = THREE.MathUtils.degToRad(camera.fov);
  const dH = needH / 2 / Math.tan(vf / 2), dW = needW / 2 / (Math.tan(vf / 2) * camera.aspect);
  const d = Math.max(dH, dW, 3.2);
  const dir = new THREE.Vector3(0, 0.36, 1).normalize();
  camera.position.copy(LOOK).addScaledVector(dir, d);
  camera.lookAt(LOOK);
  // phone landscape: the upgrade column sits on the right, so centre the bench in the space left of it
  if (h < 500 && w > h) camera.setViewOffset(w, h, Math.min(95, w * 0.1), 0, w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  for (const s of [flakes, glints]) s.pts.material.uniforms.uScale.value = h * renderer.getPixelRatio() * 0.9;
}
addEventListener('resize', () => { layout(); sizeTool(); });

// ---------- away / pause ----------
function setAway(v) {
  if (v === away) return; away = v;
  if (v) { audio.suspend(); platform.gameplayStop(); pointer.down = false; toolEl.classList.remove('down'); save(); }
  else { audio.resume(); if (!panelOpen) platform.gameplayStart(); last = performance.now(); }
}
let blurred = false;
const checkAway = () => setAway(document.hidden || blurred);
document.addEventListener('visibilitychange', checkAway);
addEventListener('blur', () => { blurred = true; checkAway(); });
addEventListener('focus', () => { blurred = false; checkAway(); });
addEventListener('pointerdown', () => { if (blurred) { blurred = false; checkAway(); } }, true);
addEventListener('pagehide', () => { setAway(true); save(); });
platform.onPause = () => setAway(true);
platform.onResume = () => checkAway();

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (away || adPause) return;
  playT += dt;
  const w = spin();
  if (piece) {
    const spinMul = state === 'reveal' ? 1 + 1.5 * Math.sin(Math.min(1, revealT / 1.6) * Math.PI) : 1;
    if (!frozen) piece.rotation.y += w * spinMul * dt;
    table.rotation.y = piece.rotation.y;   // the turntable turns with the piece
  }
  if (slideIn > 0) { slideIn = Math.max(0, slideIn - dt * 2.4); const e = slideIn * slideIn * (3 - 2 * slideIn); piece.position.x = -2.4 * e; piece.position.y = Math.sin(e * Math.PI) * 0.15; }
  if (state === 'play') {
    brushTick(dt); helperTick(dt);
    if (maskDirty) { uploadMask(); updateProgress(); }
    // hint: until the player has held for a moment, and again after a long idle
    idleT = pointer.down ? 0 : idleT + dt;
    const showHint = slideIn === 0 && !panelOpen && ((everHeld < 0.8 && !pointer.down) || idleT > 7);
    $('hint').classList.toggle('hidden', !showHint);
    if (showHint) { const p = tmpV.set(0, TABLE_TOP + cur.geo.h * 0.55, 0.3).project(camera); const hs = $('hint').style; hs.left = `${(p.x + 1) / 2 * innerWidth}px`; hs.top = `${(1 - p.y) / 2 * innerHeight}px`; }
  } else if (state === 'reveal') {
    revealT += dt;
    $('hint').classList.add('hidden');
    const k = Math.min(1, dt * 4); let any = false;
    for (let i = 0; i < dirt.length; i++) if (dirt[i] > 0) { dirt[i] = Math.max(0, dirt[i] - k * Math.max(dirt[i], 0.05)); any = true; }
    if (any) { uploadMask(); recount(); }
    if (slideOut < 0) piece.position.y = revealT < 0.5 ? Math.sin(revealT / 0.5 * Math.PI) * 0.06 : 0;
    pieceMat.userData.u.uSweep.value = revealT < 1.3 ? -0.15 + revealT / 1.3 * 1.3 : -1;
    pieceMat.userData.u.uGlow.value = Math.sin(Math.min(1, revealT / 1.8) * Math.PI);
    if (revealT < 1.3 && Math.random() < 0.7) { const y = Math.random() * cur.geo.h, a = Math.random() * TAU; const r = cur.geo.prof[Math.floor(Math.random() * MH)] + 0.02; emit(glints, 1, tmpV.set(Math.sin(a) * r, TABLE_TOP + y, Math.cos(a) * r), { life: 0.7, spread: 0.05, size: 0.09, color: glintCol, vel: () => ({ x: 0, y: 0.15, z: 0 }) }); }
    $('gaugeF').style.width = '100%'; $('pct').textContent = '100%';
    if (revealT > 2.0 && slideOut < 0) finishReveal();
    if (slideOut >= 0) {
      slideOut += dt * 1.4; const e = Math.min(1, slideOut), k = e * e * (3 - 2 * e);
      piece.position.lerpVectors(flyFrom, flyTo, k); piece.position.y += Math.sin(k * Math.PI) * 0.7;
      piece.scale.setScalar(lerp(1, 0.24, k));
      if (slideOut >= 1) { slideOut = -1; addShelfItem(cur.si, cur.mi); audio.play('place'); holder.remove(piece); piece.scale.setScalar(1); state = 'wait'; maybeMidgameAd().then(() => { state = 'play'; setupPiece(); }); }
    }
  }
  // scrub sound follows what is being removed right now
  const idt = dt > 0 ? 1 / dt : 0, tr = clamp(crustRemovedFrame * idt / 90, 0, 1), tp = clamp((removedFrame - crustRemovedFrame) * idt / 90, 0, 1);
  scrubR = lerp(scrubR, tr, 0.5); scrubP = lerp(scrubP, tp, 0.5);
  audio.scrub(scrubR, scrubP, 0.9 + w / BASE_SPIN * 0.1);
  removedFrame = 0; crustRemovedFrame = 0;
  if (contactT > 0) { contactT = Math.max(0, contactT - dt); } contact.scale.setScalar(0.42 + 0.5 * (contactT / 0.3)); contact.material.opacity = pointer.down && state === 'play' ? Math.max(contactT / 0.3, 0.35) : contactT / 0.3;
  if (pointer.down && lastHit) contact.position.copy(lastPoint);
  updatePoints(flakes, dt, 5, 0.005); updatePoints(glints, dt, 0, 0);
  if (offerT > 0) { offerT -= dt; if (offerT <= 0) $('offer').classList.add('hidden'); }
  if (Math.round(shownCoins) !== Math.round(S.coins)) { shownCoins = S.coins; coinEl.textContent = fmt(S.coins); }
  if (saveT > 0) { saveT -= dt; if (saveT <= 0) save(); }
  renderer.render(scene, camera);
}
const fmt = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : `${Math.floor(n)}`;

// ---------- boot ----------
async function boot() {
  const bar = $('bar').firstElementChild; bar.style.width = '20%';
  await platform.init(); bar.style.width = '50%';
  try { const raw = await platform.loadSave(); if (raw) { const d = JSON.parse(raw); for (const k of SAVE_KEY_FIELDS) if (d[k] !== undefined) S[k] = d[k]; S.lv = Object.assign({ size: 0, power: 0, speed: 0, helper: 0 }, d.lv || {}); } } catch (e) { /* fresh start */ }
  if (Q.has('fresh')) Object.assign(S, { coins: 0, lv: { size: 0, power: 0, speed: 0, helper: 0 }, shelf: {}, restored: 0, sales: 0 });
  audio.setSound(S.sound); audio.setMusic(S.music);
  layout();
  // pre-build the shelf props from the save
  Object.keys(S.shelf).slice(-8).forEach((k) => { const [mi, si] = k.split(':').map(Number); addShelfItem(si, mi); });
  SHAPES.forEach((_, i) => pieceGeo(i));
  setupPiece(); slideIn = 0; piece.position.set(0, 0, 0);
  sizeTool(); refreshUps(); updateShelfBtn(); shownCoins = S.coins; coinEl.textContent = fmt(S.coins);
  { const warm = cleanMats.map((m, i) => { const w = new THREE.Mesh(pieceGeo(0).g, m); w.position.set(-50 + i, 0, 0); scene.add(w); return w; }); renderer.compile(scene, camera); warm.forEach((w) => scene.remove(w)); }
  bar.style.width = '100%';
  requestAnimationFrame((t) => { last = t; frame(t); });
  setTimeout(() => {
    $('loader').classList.add('hidden'); $('hud').classList.remove('hidden');
    platform.loadingDone(); platform.gameplayStart();
    checkAway();
  }, 150);
  if (DEBUG) {
    window.__game = {
      S, camera, get state() { return state; }, get progress() { return progress; }, get stage() { return stage; }, get panel() { return panelOpen; },
      get firstSaleT() { return firstSaleT; }, get playT() { return playT; }, get audioState() { return audio.state; }, get muted() { return audio.muted; },
      piece: () => piece,
      // screen point on the front of the dirtiest visible row (what a player would aim at)
      target() {
        if (!cur || !piece) return null;
        const rows = [];
        for (let y = 2; y < MH - 2; y++) { if (!rowW[y] || cur.geo.prof[y] < 0.05) continue; let s = 0; const o = y * MW; for (let x = 0; x < MW; x += 4) s += dirt[o + x]; rows.push([s, y]); }
        rows.sort((a, b) => b[0] - a[0]);
        for (const [, by] of rows.slice(0, 12)) for (const z of [0.92, -0.85, 0.5, -0.5]) {
          const r = cur.geo.prof[by], p = new THREE.Vector3(0, TABLE_TOP + cur.geo.profY[by], r * z).project(camera);
          const sx = (p.x + 1) / 2 * innerWidth, sy = (1 - p.y) / 2 * innerHeight, h = hitAt(sx, sy);
          if (h && h.uv && Math.abs(h.uv.y * (MH - 1) - by) < 6) return { x: sx, y: sy, row: by };
        }
        return null;
      },
      give(n) { addCoins(n); },
      get ptr() { return { ...pointer }; }, get adPause() { return adPause; },
      hud(v) { $('hud').style.visibility = v ? '' : 'hidden'; $('hint').style.visibility = v ? '' : 'hidden'; $('tool').style.visibility = v ? '' : 'hidden'; },
      // store shots: force a piece and clean it half way (the right half of the turn shines)
      setPiece(mi, si) { lastPick = { si: -1, mi: -1 }; const keep = choosePiece; choosePieceOverride = { mi, si }; setupPiece(); choosePieceOverride = null; slideIn = 0; piece.position.set(0, 0, 0); },
      half(frac = 0.5) { for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) { const i = y * MW + x; if (x < MW * frac) dirt[i] = 0; } uploadMask(); recount(); },
      spinTo(a) { piece.rotation.y = a; table.rotation.y = a; },
      freeze(v) { frozen = v; },
    };
  }
}
boot();
