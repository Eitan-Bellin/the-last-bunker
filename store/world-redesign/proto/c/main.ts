import { tokens } from './tokens';
import { Mesh, STRIDE } from './mesh';
import { buildTerrain } from './terrain';
import { buildProps, type Extras } from './props';
import { makeWalkers } from './people';
import { Fow } from './fow';
import { Camera } from './camera';
import { DEG, noise3, project } from './math';
import * as S from './shaders';
import { makeNoise } from './noiseTex';

// ------------------------------------------------------------------ setup
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const Q = new URLSearchParams(location.search);
/** ?skip=sky,world,people,cones,halos,parts (profiling only). */
const SKIP = new Set((Q.get('skip') ?? '').split(','));
/** ?mobile=1 / ?mobile=0 forces the phone profile (measurement); otherwise coarse pointer or a narrow screen. */
const mobile = Q.has('mobile') ? Q.get('mobile') === '1' : matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 500;
const statsEl = document.getElementById('stats')!;
const labelsEl = document.getElementById('labels')!;
const lostEl = document.getElementById('lost')!;

// CPU-side scene (kept so a lost WebGL context can be rebuilt without regenerating it)
const t0 = performance.now();
const world = new Mesh();
buildTerrain(world);
const extras: Extras = buildProps(world, mobile);
const people = new Mesh();
const walkers = makeWalkers();
const fow = new Fow();
const cam = new Camera();
const buildMs = performance.now() - t0;
const L = tokens.lights;
const lanternIdx = L.length;

// cone mesh (pos3 nrm3 col4 light1)
function buildCones(): Float32Array {
  const out: number[] = [];
  const seg = 16;
  for (const c of extras.cones) {
    const [ax, ay, az] = c.apex;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const p0 = [ax + Math.cos(a0) * c.radius, ay - c.len, az + Math.sin(a0) * c.radius];
      const p1 = [ax + Math.cos(a1) * c.radius, ay - c.len, az + Math.sin(a1) * c.radius];
      const n0 = [Math.cos(a0), 0.3, Math.sin(a0)], n1 = [Math.cos(a1), 0.3, Math.sin(a1)];
      const am = (a0 + a1) / 2;
      const nm = [Math.cos(am), 0.3, Math.sin(am)];
      out.push(ax, ay, az, ...nm, ...c.c, 1, c.light);
      out.push(...p0, ...n0, ...c.c, 0, c.light);
      out.push(...p1, ...n1, ...c.c, 0, c.light);
    }
  }
  return new Float32Array(out);
}
const coneData = buildCones();

/**
 * Clustered forward lighting, 2D: the cross-section is cut into 2 m cells and each cell stores the (up to 8) static lights that can
 * reach it, strongest first. The fragment shader evaluates only those (plus the moving lantern) instead of every light in the scene (19, array capacity 24).
 */
const LG = { x0: -82, y0: -34, cell: 2, w: 68, h: 21 };
const lgData = new Uint8Array(LG.w * 2 * LG.h * 4);
let lgOverflow = 0, lgMax = 0;
for (let j = 0; j < LG.h; j++)
  for (let i = 0; i < LG.w; i++) {
    const cx0 = LG.x0 + i * LG.cell, cy0 = LG.y0 + j * LG.cell;
    const top = j === LG.h - 1; // the top row also serves everything above it (clamped lookups)
    const cand: [number, number][] = [];
    L.forEach((l, li) => {
      const dx = Math.max(cx0 - l.pos[0], 0, l.pos[0] - (cx0 + LG.cell));
      const dy = top ? Math.max(cy0 - l.pos[1], 0) : Math.max(cy0 - l.pos[1], 0, l.pos[1] - (cy0 + LG.cell));
      const d = Math.hypot(dx, dy);
      if (d < l.radius) cand.push([li, l.intensity * (1 - d / l.radius) ** 2]);
    });
    cand.sort((a, b) => b[1] - a[1]);
    lgMax = Math.max(lgMax, cand.length);
    if (cand.length > 8) lgOverflow++;
    cand.slice(0, 8).forEach(([li], k) => { lgData[(j * LG.w * 2 + i * 2 + (k >> 2)) * 4 + (k & 3)] = li + 1; });
  }

const partData = new Float32Array(extras.particles.length * 5);
extras.particles.forEach((p, i) => partData.set([p.p[0], p.p[1], p.p[2], p.seed, p.kind], i * 5));

// halos: rebuilt each frame (flicker) - 4 verts x (center3, corner2, col4)
const halos = [...extras.halos, { p: [0, 0, 0] as [number, number, number], c: tokens.lantern.color, size: tokens.lantern.halo, light: lanternIdx }];
const haloData = new Float32Array(halos.length * 4 * 9);
const haloIdx = new Uint32Array(halos.length * 6);
halos.forEach((_, i) => haloIdx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6));

// ------------------------------------------------------------------ GL
let gl: WebGL2RenderingContext;
interface Prog { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }
let progMain: Prog, progSky: Prog, progHalo: Prog, progCone: Prog, progPart: Prog;
let vaoWorld: WebGLVertexArrayObject, vaoPeople: WebGLVertexArrayObject, vaoSky: WebGLVertexArrayObject, vaoHalo: WebGLVertexArrayObject, vaoCone: WebGLVertexArrayObject, vaoPart: WebGLVertexArrayObject;
let bufPeopleV: WebGLBuffer, bufPeopleI: WebGLBuffer, bufHaloV: WebGLBuffer;
let fowTex: WebGLTexture, noiseTex: WebGLTexture, lgTex: WebGLTexture;
const noiseData = makeNoise(128);
let running = false;

function compile(vs: string, fs: string): Prog {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return { p, u: new Map() };
}
function U(pr: Prog, name: string): WebGLUniformLocation | null {
  if (!pr.u.has(name)) pr.u.set(name, gl.getUniformLocation(pr.p, name));
  return pr.u.get(name)!;
}

function meshAttribs(): void {
  const B = STRIDE * 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, B, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, B, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, B, 24);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, B, 36);
}

function initGL(): void {
  const aa = Q.has('aa') ? Q.get('aa') === '1' : mobile ? tokens.render.antialiasMobile : tokens.render.antialiasDesktop;
  gl = canvas.getContext('webgl2', { antialias: aa, alpha: false, depth: true, powerPreference: 'high-performance' }) as WebGL2RenderingContext;
  if (!gl) throw new Error('WebGL2 not available');
  progMain = compile(S.MAIN_VS, S.MAIN_FS);
  progSky = compile(S.SKY_VS, S.SKY_FS);
  progHalo = compile(S.HALO_VS, S.HALO_FS);
  progCone = compile(S.CONE_VS, S.CONE_FS);
  progPart = compile(S.PART_VS, S.PART_FS);

  vaoWorld = gl.createVertexArray()!;
  gl.bindVertexArray(vaoWorld);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, world.v.subarray(0, world.nv * STRIDE), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, world.i.subarray(0, world.ni), gl.STATIC_DRAW);
  meshAttribs();

  vaoPeople = gl.createVertexArray()!;
  gl.bindVertexArray(vaoPeople);
  bufPeopleV = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, bufPeopleV);
  bufPeopleI = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufPeopleI);
  meshAttribs();

  vaoSky = gl.createVertexArray()!;

  vaoHalo = gl.createVertexArray()!;
  gl.bindVertexArray(vaoHalo);
  bufHaloV = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, bufHaloV);
  gl.bufferData(gl.ARRAY_BUFFER, haloData.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 36, 20);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, haloIdx, gl.STATIC_DRAW);

  vaoCone = gl.createVertexArray()!;
  gl.bindVertexArray(vaoCone);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, coneData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 44, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 44, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 44, 24);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 44, 40);

  vaoPart = gl.createVertexArray()!;
  gl.bindVertexArray(vaoPart);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, partData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
  gl.bindVertexArray(null);

  noiseTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, noiseTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseData);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  lgTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, lgTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, LG.w * 2, LG.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, lgData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  fowTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, fowTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  fow.dirty = true;
  fow.update(performance.now() / 1000);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, fow.w, fow.h, 0, gl.RED, gl.UNSIGNED_BYTE, fow.bytes);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

// ------------------------------------------------------------------ sizing
let dpr = 1;
function resize(): void {
  const R = tokens.render;
  // ?w=&h=&dpr= pin the viewport (benchmarks in a hidden or resized pane)
  const w = Math.max(1, Q.has("w") ? Number(Q.get("w")) : innerWidth), h = Math.max(1, Q.has("h") ? Number(Q.get("h")) : innerHeight);
  const deviceDpr = Q.has('dpr') ? Number(Q.get('dpr')) : devicePixelRatio || 1;
  dpr = Math.min(deviceDpr, mobile ? R.maxDprMobile : R.maxDprDesktop);
  if (mobile) dpr = Math.min(dpr, Math.sqrt((R.mobileMaxMegapixels * 1e6) / (w * h)));
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  cam.setViewport(w, h);
}

function resetCamera(): void {
  const C = tokens.camera;
  cam.yaw = 0;
  cam.stop();
  const t = mobile ? C.startTargetMobile : C.startTargetDesktop;
  const span = mobile ? C.startSpanMobile : C.startSpanDesktop;
  cam.tx = t.x; cam.ty = t.y;
  cam.dist = cam.goalDist = Math.min(C.distMax, span / 2 / (Math.tan((C.fovDeg * DEG) / 2) * (cam.w / cam.h)));
  cam.rebuild();
}

// ------------------------------------------------------------------ input
const pointers = new Map<number, { x: number; y: number; sx: number; sy: number; btn: number; shift: boolean }>();
let dragging = false;
let lastMoveT = 0;
let gesture: { d: number; a: number; mx: number; my: number } | null = null;

function revealAt(sx: number, sy: number): void {
  const p = cam.pick(sx, sy, -3);
  if (!p) return;
  fow.reveal(p[0], p[1], performance.now() / 1000);
  const ring = document.createElement('div');
  ring.className = 'ping';
  ring.style.left = sx + 'px';
  ring.style.top = sy + 'px';
  document.body.appendChild(ring);
  setTimeout(() => ring.remove(), 900);
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, btn: e.button, shift: e.shiftKey });
  cam.stop();
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    dragging = true;
  }
  lastMoveT = performance.now();
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const now = performance.now();
  const dt = Math.max(0.001, (now - lastMoveT) / 1000);
  lastMoveT = now;
  if (pointers.size === 1) {
    if (!dragging && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > tokens.camera.dragThresholdPx) dragging = true;
    if (dragging) {
      if (p.btn === 2 || p.shift) cam.orbit((e.clientX - p.x) * tokens.camera.orbitDegPerPx);
      else cam.panPixels(p.x, p.y, e.clientX, e.clientY, dt);
    }
    p.x = e.clientX; p.y = e.clientY;
  } else if (pointers.size === 2 && gesture) {
    p.x = e.clientX; p.y = e.clientY;
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    cam.panPixels(gesture.mx, gesture.my, mx, my, dt);
    cam.goalDist = cam.dist = Math.min(tokens.camera.distMax, Math.max(tokens.camera.distMin, cam.dist * (gesture.d / Math.max(d, 1))));
    let da = ang - gesture.a;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    cam.orbit(-da / DEG);
    gesture = { d, a: ang, mx, my };
  }
});
const up = (e: PointerEvent) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (p && !dragging && pointers.size === 0 && p.btn === 0) revealAt(e.clientX, e.clientY);
  if (pointers.size < 2) gesture = null;
  if (pointers.size === 0) {
    dragging = false;
    if (performance.now() - lastMoveT > 80) cam.stop();
  }
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.zoomAt(Math.exp(e.deltaY * tokens.camera.wheelZoom * (e.deltaMode === 1 ? 30 : 1)), e.clientX, e.clientY);
}, { passive: false });
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === 'r') resetCamera();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
document.getElementById('btnCam')!.addEventListener('click', resetCamera);
document.getElementById('btnFog')!.addEventListener('click', () => fow.reset());
document.getElementById('btnAll')!.addEventListener('click', () => {
  const now = performance.now() / 1000;
  for (let x = -78; x <= 50; x += 7) for (let y = -30; y <= -2; y += 6) fow.reveal(x, y, now + Math.abs(x + 20) * 0.01);
});
document.getElementById('btnHud')!.addEventListener('click', () => document.body.classList.toggle('nohud'));

// ------------------------------------------------------------------ labels (DOM overlay anchored to 3D points)
const labelEls = tokens.labels.map((l) => {
  const el = document.createElement('div');
  el.className = 'tag';
  el.textContent = l.text;
  labelsEl.appendChild(el);
  return el;
});
function updateLabels(): void {
  tokens.labels.forEach((l, i) => {
    const [x, y, , w] = project(cam.vp, l.pos[0], l.pos[1], l.pos[2]);
    const el = labelEls[i];
    const vis = fow.at(l.pos[0], l.pos[1] - 2) > 0.6 && w > 0 && cam.dist < 110;
    el.style.opacity = vis ? '1' : '0';
    el.style.transform = `translate(${((x + 1) / 2) * cam.w}px, ${((1 - y) / 2) * cam.h}px) translate(-50%, -100%)`;
  });
}

// ------------------------------------------------------------------ frame
const LP = new Float32Array(96), LC = new Float32Array(96), LI = new Float32Array(24);
const stats = { cpuMs: 0, drawCalls: 0, tris: 0, fps: 0, ms: 0, buildMs, dpr: 1, w: 0, h: 0 };
(window as unknown as { __protoC: unknown }).__protoC = { lightGrid: () => ({ max: lgMax, overflow: lgOverflow }), stats, cam, fow, tokens, bench: (n?: number) => bench(n), gpuProfile: (n?: number) => gpuProfile(n), resize: () => resize(),
  /** Render one frame synchronously and return it as a JPEG data URL (for checking the look while the pane is hidden). */
  snap: (w = 640, q = 0.72) => {
    step(performance.now());
    const c2 = document.createElement('canvas');
    c2.width = w;
    c2.height = Math.round((w * canvas.height) / canvas.width);
    c2.getContext('2d')!.drawImage(canvas, 0, 0, c2.width, c2.height);
    return c2.toDataURL('image/jpeg', q);
  },
  /** Advance the simulation (people, fog reveals) by `sec` seconds without rendering. */
  advance: (sec: number) => {
    for (let t = 0; t < sec; t += 1 / 30) for (const w of walkers) w.update(1 / 30);
  },
};

function flicker(kind: number, t: number, seed: number): number {
  if (kind === 1) return 0.84 + 0.09 * Math.sin(t * 11 + seed) + 0.05 * Math.sin(t * 23.7 + seed * 2) + 0.12 * (noise3(t * 5, seed, 0) - 0.5);
  if (kind === 2) {
    const n = noise3(t * 0.9, seed * 10, 3);
    return n > 0.7 ? (Math.sin(t * 57 + seed) > 0.2 ? 1 : 0.25) : 1;
  }
  return 1;
}

// ---- GPU timer queries (EXT_disjoint_timer_query_webgl2), used by gpuProfile() only
let timing = false;
let timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
let pendingQ: { name: string; q: WebGLQuery }[] = [];
const gpuSamples = new Map<string, number[]>();
function tBegin(name: string): void {
  if (!timing || !timerExt) return;
  const q = gl.createQuery()!;
  gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q);
  pendingQ.push({ name, q });
}
function tEnd(): void {
  if (!timing || !timerExt) return;
  gl.endQuery(timerExt.TIME_ELAPSED_EXT);
}
function collectQ(): void {
  if (!timerExt) return;
  pendingQ = pendingQ.filter(({ name, q }) => {
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true;
    if (!gl.getParameter(timerExt!.GPU_DISJOINT_EXT)) {
      if (!gpuSamples.has(name)) gpuSamples.set(name, []);
      gpuSamples.get(name)!.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    }
    gl.deleteQuery(q);
    return false;
  });
}
const yieldTask = () => new Promise<void>((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
/** GPU milliseconds per pass (median and p95 over n frames) plus the summed frame. Does not need rAF. */
async function gpuProfile(n = 120): Promise<Record<string, { med: number; p95: number }>> {
  timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') as typeof timerExt;
  if (!timerExt) return {};
  gpuSamples.clear();
  timing = true;
  let fake = performance.now();
  const totals: number[] = [];
  for (let i = 0; i < n; i++) {
    fake += 1000 / 60;
    last = fake - 1000 / 60;
    step(fake);
    gl.flush();
    for (let k = 0; k < 40 && pendingQ.length > 12; k++) { await yieldTask(); collectQ(); }
    await yieldTask();
    collectQ();
  }
  for (let k = 0; k < 200 && pendingQ.length; k++) { await yieldTask(); collectQ(); }
  timing = false;
  const out: Record<string, { med: number; p95: number }> = {};
  let sumMed = 0;
  for (const [name, v] of gpuSamples) {
    v.sort((a, b) => a - b);
    out[name] = { med: +v[Math.floor(v.length / 2)].toFixed(3), p95: +v[Math.floor(v.length * 0.95)].toFixed(3) };
    sumMed += out[name].med;
  }
  const w = gpuSamples.get('world') ?? [];
  for (let i = 0; i < w.length; i++) totals.push([...gpuSamples.values()].reduce((s, v) => s + (v[i] ?? 0), 0));
  totals.sort((a, b) => a - b);
  out.frame = { med: +sumMed.toFixed(3), p95: +(totals[Math.floor(totals.length * 0.95)] ?? 0).toFixed(3) };
  return out;
}

let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsT = 0;

function frame(): void {
  if (!running) return;
  requestAnimationFrame(frame);
  step(performance.now());
}

/**
 * Synchronous benchmark that does not depend on requestAnimationFrame (hidden panes throttle rAF): renders n frames back to back,
 * forcing each to finish with a 1-pixel readback, and reports CPU+GPU ms per frame.
 */
function bench(n = 120): { avg: number; p95: number; max: number } {
  const px = new Uint8Array(4);
  const ts: number[] = [];
  let fake = performance.now();
  for (let i = 0; i < n; i++) {
    const a = performance.now();
    fake += 1000 / 60;
    last = fake - 1000 / 60;
    step(fake);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    ts.push(performance.now() - a);
  }
  ts.sort((x, y) => x - y);
  return { avg: +(ts.reduce((x, y) => x + y, 0) / n).toFixed(2), p95: +ts[Math.floor(n * 0.95)].toFixed(2), max: +ts[n - 1].toFixed(2) };
}

function step(nowMs: number): void {
  const cpu0 = performance.now();
  const dt = Math.min(0.05, (nowMs - last) / 1000);
  last = nowMs;
  const time = nowMs / 1000;
  fpsAcc += dt; fpsN++;
  if (nowMs - fpsT > 500) {
    stats.fps = fpsN / fpsAcc; stats.ms = (fpsAcc / fpsN) * 1000;
    fpsAcc = 0; fpsN = 0; fpsT = nowMs;
    statsEl.textContent = `${stats.fps.toFixed(0)} fps · ${stats.ms.toFixed(1)} ms · ${stats.drawCalls} draws · ${(stats.tris / 1000).toFixed(1)}k tris · dpr ${dpr.toFixed(2)}`;
  }

  if (keys.has('q')) cam.orbit(-tokens.camera.keyYawDegPerSec * dt);
  if (keys.has('e')) cam.orbit(tokens.camera.keyYawDegPerSec * dt);
  cam.update(dt, dragging);

  // people
  people.reset();
  for (const w of walkers) { w.update(dt); w.build(people, time); }

  // lights (unused slots get a zero radius)
  LP.fill(0);
  LC.fill(0);
  for (let i = 0; i < L.length && i < 23; i++) {
    const l = L[i];
    const f = flicker(l.flicker, time, i * 1.7);
    LP.set([l.pos[0], l.pos[1], l.pos[2], l.radius], i * 4);
    LC.set([l.color[0] * l.intensity * f, l.color[1] * l.intensity * f, l.color[2] * l.intensity * f, 0], i * 4);
    LI[i] = f * Math.sqrt(l.intensity / 3);
  }
  const lw = walkers[0];
  const lt = tokens.lantern;
  const lf = flicker(1, time * 0.6, 9) * 0.3 + 0.7;
  LP.set([lw.lanternPos[0], lw.lanternPos[1], lw.lanternPos[2], lt.radius], lanternIdx * 4);
  LC.set([lt.color[0] * lt.intensity * lf, lt.color[1] * lt.intensity * lf, lt.color[2] * lt.intensity * lf, 0], lanternIdx * 4);
  LI[lanternIdx] = lf;

  // halos
  const HS = tokens.light.haloStrength;
  halos.forEach((h, i) => {
    const p = h.light === lanternIdx ? lw.lanternPos : h.p;
    let k = HS;
    if (h.light >= 0 && h.light < L.length) k *= LI[h.light] * Math.sqrt(L[h.light].intensity / 3);
    else if (h.light === lanternIdx) k *= lf;
    const s = h.size * tokens.light.haloSize;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    corners.forEach((c, j) => haloData.set([p[0], p[1], p[2], c[0], c[1], h.c[0] * k, h.c[1] * k, h.c[2] * k, s], (i * 4 + j) * 9));
  });

  if (fow.update(time)) {
    gl.bindTexture(gl.TEXTURE_2D, fowTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, fow.w, fow.h, gl.RED, gl.UNSIGNED_BYTE, fow.bytes);
  }

  // ---- draw
  let draws = 0, tris = 0;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, lgTex);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, noiseTex);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, fowTex);
  const R = tokens.render;
  const common = (pr: Prog) => {
    gl.useProgram(pr.p);
    gl.uniform1f(U(pr, 'uTime'), time % 1000);
    gl.uniform2f(U(pr, 'uRes'), canvas.width, canvas.height);
    gl.uniform4f(U(pr, 'uPost'), R.exposure, R.saturation, R.contrast, R.vignette);
    gl.uniform1f(U(pr, 'uGrain'), R.grain);
    gl.uniform1i(U(pr, 'uFow'), 0);
    gl.uniform1i(U(pr, 'uNoise'), 1);
    gl.uniform4f(U(pr, 'uFowRect'), fow.x0, fow.y0, 1 / fow.wM, 1 / fow.hM);
  };

  // world + people
  gl.disable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.depthMask(true);
  gl.enable(gl.CULL_FACE);
  common(progMain);
  const LT = tokens.light;
  gl.uniformMatrix4fv(U(progMain, 'uVP'), false, cam.vp);
  gl.uniform3fv(U(progMain, 'uCam'), cam.eye);
  gl.uniform1i(U(progMain, 'uLGrid'), 2);
  gl.uniform4f(U(progMain, 'uLGRect'), LG.x0, LG.y0, 1 / LG.cell, 1 / LG.cell);
  gl.uniform2i(U(progMain, 'uLGSize'), LG.w, LG.h);
  gl.uniform1i(U(progMain, 'uLantern'), lanternIdx);
  gl.uniform4fv(U(progMain, 'uLP'), LP);
  gl.uniform4fv(U(progMain, 'uLC'), LC);
  gl.uniform3fv(U(progMain, 'uAmbTop'), LT.ambientSurface);
  gl.uniform3fv(U(progMain, 'uAmbDeep'), LT.ambientDeep);
  gl.uniform3fv(U(progMain, 'uSection'), LT.sectionFill);
  const sd = LT.sunDir, sl = Math.hypot(...sd);
  gl.uniform3f(U(progMain, 'uSunDir'), sd[0] / sl, sd[1] / sl, sd[2] / sl);
  gl.uniform3fv(U(progMain, 'uSunCol'), LT.sunColor);
  gl.uniform3fv(U(progMain, 'uSkyFill'), LT.skyFill);
  gl.uniform2f(U(progMain, 'uDark'), tokens.depth.darkStartY, tokens.depth.darkEndY);
  gl.uniform3fv(U(progMain, 'uHazeCol'), tokens.haze.color);
  gl.uniform2f(U(progMain, 'uHaze'), tokens.haze.density, cam.dist * tokens.haze.startFactor);
  gl.uniform3fv(U(progMain, 'uFowCol'), tokens.fow.color);
  gl.uniform3fv(U(progMain, 'uFowEdge'), tokens.fow.edgeColor);
  gl.uniform2f(U(progMain, 'uFowK'), tokens.fow.swirl, tokens.fow.edgeStrength);
  gl.uniform4f(U(progMain, 'uLook'), LT.falloffK, LT.wrap, LT.specular, LT.figureLift);
  gl.bindVertexArray(vaoWorld);
  tBegin('world');
  if (!SKIP.has('world')) gl.drawElements(gl.TRIANGLES, world.ni, gl.UNSIGNED_INT, 0);
  tEnd();
  draws++; tris += world.ni / 3;
  gl.bindVertexArray(vaoPeople);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufPeopleV);
  gl.bufferData(gl.ARRAY_BUFFER, people.v.subarray(0, people.nv * STRIDE), gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufPeopleI);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, people.i.subarray(0, people.ni), gl.DYNAMIC_DRAW);
  tBegin('people');
  if (!SKIP.has('people')) gl.drawElements(gl.TRIANGLES, people.ni, gl.UNSIGNED_INT, 0);
  tEnd();
  draws++; tris += people.ni / 3;

  // sky (last opaque)
  // drawn after the opaque world at the far plane, so only the uncovered background is shaded
  gl.disable(gl.CULL_FACE);
  gl.depthMask(false);
  common(progSky);
  const K = tokens.sky;
  gl.uniformMatrix4fv(U(progSky, 'uInvVP'), false, cam.invVP);
  gl.uniform3fv(U(progSky, 'uSunDir'), tokens.light.sunDir);
  gl.uniform3fv(U(progSky, 'uZenith'), K.zenith);
  gl.uniform3fv(U(progSky, 'uHorizon'), K.horizon);
  gl.uniform3fv(U(progSky, 'uSunGlow'), K.sunGlow);
  gl.uniform3fv(U(progSky, 'uSkyline'), K.skyline);
  gl.uniform3fv(U(progSky, 'uSkyWin'), K.skylineWindow);
  gl.uniform3fv(U(progSky, 'uVoid'), K.voidColor);
  gl.bindVertexArray(vaoSky);
  tBegin('sky');
  if (!SKIP.has('sky')) gl.drawArrays(gl.TRIANGLES, 0, 3);
  tEnd();
  draws++; tris++;

  // additive light: cones, halos, dust
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.depthMask(false);
  common(progCone);
  gl.uniformMatrix4fv(U(progCone, 'uVP'), false, cam.vp);
  gl.uniform3fv(U(progCone, 'uCam'), cam.eye);
  gl.uniform1fv(U(progCone, 'uLI'), LI);
  gl.uniform1f(U(progCone, 'uStrength'), LT.coneStrength);
  gl.bindVertexArray(vaoCone);
  tBegin('cones');
  if (!SKIP.has('cones')) gl.drawArrays(gl.TRIANGLES, 0, coneData.length / 11);
  tEnd();
  draws++; tris += coneData.length / 11 / 3;

  common(progHalo);
  gl.uniformMatrix4fv(U(progHalo, 'uV'), false, cam.view);
  gl.uniformMatrix4fv(U(progHalo, 'uP'), false, cam.proj);
  gl.bindVertexArray(vaoHalo);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufHaloV);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, haloData);
  tBegin('halos');
  if (!SKIP.has('halos')) gl.drawElements(gl.TRIANGLES, haloIdx.length, gl.UNSIGNED_INT, 0);
  tEnd();
  draws++; tris += haloIdx.length / 3;

  common(progPart);
  gl.uniformMatrix4fv(U(progPart, 'uVP'), false, cam.vp);
  gl.uniform1f(U(progPart, 'uPointScale'), canvas.height / (2 * Math.tan(cam.fov / 2)));
  gl.uniform4fv(U(progPart, 'uLP'), LP);
  gl.uniform4fv(U(progPart, 'uLC'), LC);
  gl.bindVertexArray(vaoPart);
  tBegin('parts');
  if (!SKIP.has('parts')) gl.drawArrays(gl.POINTS, 0, extras.particles.length);
  tEnd();
  draws++;
  gl.disable(gl.BLEND);
  gl.depthMask(true);

  if (Q.has('finish')) gl.finish();
  stats.cpuMs = stats.cpuMs * 0.9 + (performance.now() - cpu0) * 0.1;
  stats.drawCalls = draws;
  stats.tris = Math.round(tris);
  stats.dpr = dpr; stats.w = canvas.width; stats.h = canvas.height;
  updateLabels();
}

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  running = false;
  lostEl.style.display = 'flex';
});
canvas.addEventListener('webglcontextrestored', () => {
  initGL();
  lostEl.style.display = 'none';
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
});
addEventListener('resize', resize);

try {
  initGL();
  resize();
  resetCamera();
  running = true;
  requestAnimationFrame(frame);
} catch (err) {
  statsEl.textContent = String(err);
  console.error(err);
}
