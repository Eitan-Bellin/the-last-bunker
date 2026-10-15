import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { T } from './tokens';
import { NX, NY, idx } from './map';
import { SH, TW, Z_BASE, rng, sx, sy, zf } from './iso';
import { DepthSorter, buildStatic, type StaticScene } from './draw';
import { Lighting, radialTexture } from './lights';
import { Fog } from './fog';
import { People } from './people';
import { Camera } from './camera';

const app = new Application();
await app.init({
  resizeTo: window,
  antialias: true,
  background: T.color.bgBottom,
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  autoDensity: true,
  preference: 'webgl',
});
document.getElementById('stage')!.appendChild(app.canvas);
const W = (): number => app.screen.width;
const H = (): number => app.screen.height;

// ------------------------------------------------------------------------------------------------- layers
const bg = new Sprite(gradientTexture());
const world = new Container();
const sorter = new DepthSorter(world);
const overWorld = new Container();
const glowWorld = new Container();
const fogWorld = new Container();
const teaseWorld = new Container();
const labelWorld = new Container();
const vignette = new Sprite(vignetteTexture());
const lighting = new Lighting(app.renderer, W(), H());
app.stage.addChild(bg, world, lighting.darkness, overWorld, glowWorld, fogWorld, teaseWorld, labelWorld, vignette);
const camLayers = [world, overWorld, glowWorld, fogWorld, teaseWorld, labelWorld];

let slice = 0;
let scene: StaticScene = buildStatic(sorter, glowWorld, overWorld, slice);
glowWorld.addChild(lighting.glowLayer);
// the lantern past the rubble glows through the fog
for (const L of lighting.live) if (L.def.tease && L.glow && L.haze) { teaseWorld.addChild(L.haze, L.glow); L.haze.alpha = T.fog.teaseAlpha; }
glowWorld.addChildAt(coreGlow(), 0);

const people = new People(sorter, lighting);
const fog = new Fog(i => scene.cols.top[i]);
fogWorld.addChild(fog.layer);

// ------------------------------------------------------------------------------------------- string lights
const wires = new Graphics();
overWorld.addChild(wires);
const strings = [
  { a: [3.0, 11.5, zf(1) + 0.2], b: [13.5, 17.5, zf(3) + 1.35], sag: 0.9, n: 13 },
  { a: [14.9, 8.95, zf(1) + 0.5], b: [3.0, 15.5, zf(2) + 0.5], sag: 0.8, n: 12 },
];
const bulbTex = radialTexture(32, 0.7);
const bulbs: { s: Sprite; si: number; t: number; c: number }[] = [];
const bulbCols = [0xffc070, 0xffd890, 0xff9a50, 0xffe0a0, 0x9fe0ff, 0xff7060];
strings.forEach((st, si) => {
  for (let k = 1; k < st.n; k++) {
    const s = new Sprite(bulbTex);
    s.anchor.set(0.5); s.blendMode = 'add';
    const c = bulbCols[(k * 3 + si) % bulbCols.length];
    s.tint = c; s.width = s.height = 14;
    glowWorld.addChild(s);
    bulbs.push({ s, si, t: k / st.n, c });
  }
});
function stringPoint(si: number, t: number, time: number): number[] {
  const st = strings[si];
  const sway = Math.sin(time * 0.8 + si * 2) * 0.08 * Math.sin(Math.PI * t);
  return [st.a[0] + (st.b[0] - st.a[0]) * t + sway, st.a[1] + (st.b[1] - st.a[1]) * t - sway, st.a[2] + (st.b[2] - st.a[2]) * t - st.sag * 4 * t * (1 - t)];
}

// ---------------------------------------------------------------------------------------------- particles
interface Part { s: Sprite; x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; kind: string }
const dotTex = radialTexture(16, 0.8);
const parts: Part[] = [];
const PT = T.particles;
function spawn(kind: string, layer: Container, color: number, size: number, blend: 'add' | 'normal'): Part {
  const s = new Sprite(dotTex);
  s.anchor.set(0.5); s.tint = color; s.blendMode = blend; s.width = s.height = size;
  layer.addChild(s);
  const p: Part = { s, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, kind };
  parts.push(p);
  return p;
}
const R = rng(9);
for (let i = 0; i < PT.embers; i++) spawn('ember', glowWorld, 0xff9a40, 3 + R() * 2, 'add').life = R() * 2;
for (let i = 0; i < PT.sparks; i++) spawn('forge', glowWorld, 0xffb050, 2.5, 'add').life = R();
for (let i = 0; i < PT.sparks; i++) spawn('weld', glowWorld, 0xd8f0ff, 2.2, 'add').life = R();
for (let i = 0; i < PT.dust; i++) spawn('dust', glowWorld, 0xb8c8f0, 2 + R() * 2, 'add').life = R() * 6;
for (let i = 0; i < PT.ash; i++) spawn('ash', overWorld, 0xb0aaa0, 2 + R() * 1.5, 'normal').life = R() * 8;
for (let i = 0; i < PT.steam; i++) spawn('steam', overWorld, 0x9aa2ac, 22, 'normal').life = R() * 3;
function respawn(p: Part): void {
  respawnInner(p);
}
function respawnInner(p: Part): void {
  const r = R;
  switch (p.kind) {
    case 'ember': p.x = 8.5 + (r() - 0.5) * 0.4; p.y = 15.5 + (r() - 0.5) * 0.4; p.z = zf(3) + 0.75; p.vx = (r() - 0.5) * 0.3; p.vy = (r() - 0.5) * 0.3; p.vz = 0.8 + r() * 1.2; p.max = 1 + r() * 1.6; break;
    case 'forge': p.x = 31.2; p.y = 16.3; p.z = zf(3) + 0.6; p.vx = (r() - 0.3) * 1.2; p.vy = r() * 1.2; p.vz = 1 + r() * 1.5; p.max = 0.4 + r() * 0.6; break;
    case 'weld': p.x = 29.2; p.y = 8.9; p.z = zf(3) + 0.8; p.vx = (r() - 0.5) * 2; p.vy = r() * 1.5; p.vz = 0.5 + r() * 1.5; p.max = 0.3 + r() * 0.5; break;
    case 'dust': p.x = 7 + r() * 4; p.y = 10 + r() * 5; p.z = zf(3) + r() * 6; p.vx = (r() - 0.5) * 0.1; p.vy = (r() - 0.5) * 0.1; p.vz = -0.05 - r() * 0.1; p.max = 4 + r() * 5; break;
    case 'ash': p.x = r() * 34; p.y = r() * 7; p.z = 3 + r() * 4; p.vx = 0.25 + r() * 0.2; p.vy = -0.05; p.vz = -0.35 - r() * 0.25; p.max = 10 + r() * 6; break;
    case 'steam': p.x = 18.7 + r() * 0.2; p.y = 12.2; p.z = zf(3) + 0.6; p.vx = 0.05; p.vy = 0.15; p.vz = 0.5 + r() * 0.3; p.max = 2 + r() * 1.5; break;
  }
  p.life = 0;
}
for (const p of parts) { respawn(p); p.life = R() * p.max; }
function updateParticles(dt: number, time: number): void {
  const weldOn = (time + (lighting.live.find(L => L.def.type === 'weld')?.seed ?? 0)) % 5 < 2.2;
  for (const p of parts) {
    p.life += dt;
    if (p.life >= p.max) {
      if ((p.kind === 'weld' && !weldOn) || (p.kind === 'forge' && Math.sin(time * 0.7) < 0.2)) { p.s.visible = false; p.max = 0.2; p.life = 0; continue; }
      respawn(p);
    }
    if (p.kind === 'forge' || p.kind === 'weld') p.vz -= 6 * dt;
    if (p.kind === 'ember') { p.vx += Math.sin(time * 3 + p.y * 10) * 0.3 * dt; }
    if (p.kind === 'ash') p.vx = 0.25 + Math.sin(time * 0.5 + p.y) * 0.15;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const f = p.life / p.max;
    const lvl = p.z > -0.5 ? 0 : Math.min(3, Math.floor((-p.z + 0.3) / SH));
    p.s.visible = lvl >= slice || p.kind === 'dust';
    p.s.position.set(sx(p.x, p.y), sy(p.x, p.y, p.z));
    switch (p.kind) {
      case 'ember': p.s.alpha = (1 - f) * (0.6 + 0.4 * Math.sin(time * 20 + p.x * 50)); break;
      case 'forge': case 'weld': p.s.alpha = 1 - f; break;
      case 'dust': p.s.alpha = Math.sin(f * Math.PI) * 0.35 * (slice === 0 ? 1 : 0); break;
      case 'ash': p.s.alpha = Math.min(1, f * 4) * (1 - f) * 0.7; if (p.z < 0) p.life = p.max; break;
      case 'steam': p.s.alpha = Math.sin(f * Math.PI) * 0.1; p.s.width = p.s.height = 18 + f * 40; break;
    }
  }
}

// -------------------------------------------------------------------------------------------------- labels
const RLI = '⁧', PDI = '⁩';
const labels: { t: Text; l: number }[] = [];
function label(text: string, x: number, y: number, z: number, l: number, size: number = T.labels.size, color: number = T.color.label, anchorX = 0.5): void {
  const t = new Text({
    text: RLI + text + PDI,
    style: { fontFamily: 'Segoe UI, Arial Hebrew, Arial, sans-serif', fontSize: size, fill: color, fontWeight: '600', dropShadow: { color: 0x000000, alpha: 0.85, blur: 4, distance: 0, angle: 0 } },
    resolution: 2,
  });
  t.anchor.set(anchorX, 1);
  t.position.set(sx(x, y), sy(x, y, z));
  labelWorld.addChild(t);
  labels.push({ t, l });
}
label('פתח הצוהר', 10, 2.6, 2.4, 0);
label('האטריום · לב העיר', 9, 9, zf(1) + 1.9, 1);
label('מנהרת המטרו', 17.5, 12.5, zf(3) + 2.6, 3);
label('רובע המגורים', 26.5, 13, zf(3) + 3.0, 3);
label('הקצה האפל', 37, 13, zf(3) + 2.6, 3);
const strataNames = ['פני השטח', 'שכבה 1 · מקלט עליון', 'שכבה 2 · רשת השירות', 'שכבה 3 · המטרו הישן', 'שכבה 4 · המכרות', 'שכבה 5 · המערות העמוקות', 'שכבה 6 · הליבה'];
const bandMid = [0, zf(1) / 2, (zf(1) + zf(2)) / 2, (zf(2) + zf(3)) / 2, zf(3) - T.deepBand / 2, zf(3) - 1.5 * T.deepBand, zf(3) - 2.5 * T.deepBand];
for (let b = 1; b < 7; b++) label(strataNames[b], 9, NY + 0.4, bandMid[b] - 0.5, b <= 3 ? b : 0, 13, T.color.strataLabel, 0.5);

// ---------------------------------------------------------------------------------------------- camera & input
const camera = new Camera(app.canvas);
const mobile = W() < 700;
const start = mobile ? T.camera.startMobile : T.camera.startDesktop;
camera.set(sx(start.x, start.y), sy(start.x, start.y, start.z), start.zoom);
const bounds = { x0: sx(0, NY), x1: sx(NX, 0), y0: sy(0, 0, 4), y1: sy(NX, NY, Z_BASE) };
let revealed = 0;
camera.onTap = (px, py) => {
  const w = camera.toWorld(px, py);
  const n = fog.tap(w.x, w.y, camera.zoom);
  revealed += n;
  if (n) hint(`נחשפו ${n} תאים`);
};

function setSlice(s: number): void {
  if (s === slice) return;
  slice = s;
  for (const g of scene.chunks) g.destroy();
  scene.glow.destroy(); scene.ghost.destroy();
  scene = buildStatic(sorter, glowWorld, overWorld, slice);
  glowWorld.setChildIndex(scene.glow, 1);
  overWorld.setChildIndex(scene.ghost, 0);
  lighting.setSlice(slice);
  fog.restack();
  for (const L of labels) L.t.visible = L.l >= slice;
  wires.visible = slice <= 1;
  for (const b of bulbs) b.s.visible = slice <= 2;
  document.querySelectorAll<HTMLButtonElement>('#levels button').forEach(b => b.classList.toggle('on', Number(b.dataset.l) === slice));
}
document.querySelectorAll<HTMLButtonElement>('#levels button').forEach(b => b.addEventListener('click', () => setSlice(Number(b.dataset.l))));
window.addEventListener('keydown', e => { if (e.key >= '0' && e.key <= '3') setSlice(Number(e.key)); });
const hintEl = document.getElementById('hint')!;
let hintT = 0;
function hint(s: string): void { hintEl.textContent = s; hintEl.style.opacity = '1'; hintT = 2; }

// ------------------------------------------------------------------------------------------------- frame
let time = 0;
const fpsEl = document.getElementById('fps')!;
let fpsAcc = 0, fpsN = 0;
app.ticker.add(tk => {
  const dt = Math.min(0.05, tk.deltaMS / 1000);
  time += dt;
  camera.w = W(); camera.h = H();
  camera.update(dt, bounds);
  const z = camera.zoom;
  for (const c of camLayers) { c.scale.set(z); c.position.set(W() / 2 - camera.x * z, H() / 2 - camera.y * z); }
  bg.width = W(); bg.height = H();
  vignette.width = W(); vignette.height = H();
  people.update(dt, slice, lighting);
  fog.update(time, dt);
  updateParticles(dt, time);
  // string lights
  wires.clear();
  for (let si = 0; si < strings.length; si++) {
    const N = 20;
    for (let k = 0; k <= N; k++) { const p = stringPoint(si, k / N, time); if (k === 0) wires.moveTo(sx(p[0], p[1]), sy(p[0], p[1], p[2])); else wires.lineTo(sx(p[0], p[1]), sy(p[0], p[1], p[2])); }
    wires.stroke({ color: 0x15120f, width: 1.2, alpha: 0.9 });
  }
  for (const b of bulbs) {
    const p = stringPoint(b.si, b.t, time);
    b.s.position.set(sx(p[0], p[1]), sy(p[0], p[1], p[2]) + 3);
    b.s.alpha = 0.75 + 0.25 * Math.sin(time * 2 + b.t * 40);
  }
  const ls = Math.max(T.labels.minScale, Math.min(T.labels.maxScale, 1 / z));
  for (const L of labels) L.t.scale.set(ls);
  lighting.update(time, camera.x, camera.y, z, W(), H());
  if (hintT > 0) { hintT -= dt; if (hintT <= 0) hintEl.style.opacity = '0'; }
  fpsAcc += tk.deltaMS; fpsN++;
  if (fpsAcc > 500) { fpsEl.textContent = `${(fpsAcc / fpsN).toFixed(1)} ms · ${countObjects(app.stage)} objects`; fpsAcc = 0; fpsN = 0; }
});
window.addEventListener('resize', () => lighting.resize(W(), H()));
app.renderer.on('resize', () => lighting.resize(W(), H()));

function countObjects(c: Container): number { let n = 1; for (const ch of c.children) n += countObjects(ch as Container); return n; }
(window as unknown as Record<string, unknown>).__proto = {
  app, camera, setSlice, countObjects: () => countObjects(app.stage), fog, people, revealedCount: () => revealed,
  chunks: () => scene.chunks.length, groups: () => sorter.groups.size,
};

// ---------------------------------------------------------------------------------------------- textures
function gradientTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');
  g.addColorStop(0, hex(T.color.bgTop));
  g.addColorStop(0.55, hex(T.color.bgBottom));
  g.addColorStop(1, hex(T.color.coreGlowBg));
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
  return Texture.from(c);
}
function vignetteTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 256 * T.vignette.inner * 0.5, 128, 128, 182);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${T.vignette.alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  return Texture.from(c);
}
function coreGlow(): Sprite {
  // a deep red bloom under the block: the core
  const s = new Sprite(radialTexture(128));
  s.anchor.set(0.5); s.blendMode = 'add'; s.tint = T.light.core; s.alpha = 0.35;
  s.position.set(sx(NX / 2, NY / 2 + 6), sy(NX / 2, NY / 2 + 6, Z_BASE));
  s.width = TW * 46; s.height = TW * 12;
  return s;
}
void idx;
