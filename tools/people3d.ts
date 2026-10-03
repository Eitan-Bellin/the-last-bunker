/**
 * Graphics phase 1: pre-rendered 3D people. Open /tools/people3d.html?auto on the dev server.
 *
 * Raymarches the signed-distance characters of people3d-rig.ts in WebGL2 (orthographic camera turned ~18° toward
 * the viewer, top key light with a soft toon ramp, rim light, ambient occlusion, soft self-shadow), 3×3 supersampled.
 * Every frame is split into four layers so the game can recolour outfits without baking each one:
 *   0 trousers, 1 shirt, 2 skin (rendered as grey shading, tinted in the game), 3 gear (boots, belt, tools: own colours).
 * Hair, beards, glasses and hats are rendered once per body in the head's frame and placed at the per-frame head anchor.
 * Output: public/art/people/<body>.webp atlases, attach.webp and people.json (frame rects, offsets, head anchors).
 * Query: ?auto (render + save), ?only=man,child, ?ppm=80 (pixels per metre), ?sheet (save contact sheets only).
 */
import {
  ANIMS, ANIM_ORDER, ATTACHMENTS, BASE, BODIES, GROUP_K, Region, TINTED, attachPrims, bodyPrims, gearPrims, place, pose, point, sample,
  type Body, type BodyId, type Prim, type V3,
} from './people3d-rig';

const q = new URLSearchParams(location.search);
const PPM = Number(q.get('ppm') ?? 80);
const SS = 3;
const MAXP = 64;
const X0 = -0.95, X1 = 1.3, Y0 = -0.08, Y1 = 2.45;
const W = Math.round((X1 - X0) * PPM) * SS, H = Math.round((Y1 - Y0) * PPM) * SS;
const OW = W / SS, OH = H / SS;
const PIVOT_X = Math.round(-X0 * PPM), PIVOT_Y = Math.round(Y1 * PPM);

const YAW = (18 * Math.PI) / 180, ELEV = (7 * Math.PI) / 180;
const CAM: V3 = [Math.sin(YAW) * Math.cos(ELEV), Math.sin(ELEV), Math.cos(YAW) * Math.cos(ELEV)];
const norm = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const RIGHT = norm(cross([0, 1, 0], CAM));
const UP = cross(CAM, RIGHT);

const logEl = document.getElementById('log')!;
const log = (s: string) => { logEl.textContent += s + '\n'; };

// --- WebGL2 raymarcher ---
const FRAG = `#version 300 es
precision highp float;
uniform vec4 uA[${MAXP}], uB[${MAXP}], uC[${MAXP}], uM[${MAXP}], uCol[${MAXP}], uP[${MAXP}];
uniform float uGK[16];
uniform int uN;
uniform vec3 uCam, uRight, uUp;
uniform vec4 uWin; // x0, y0, pixels per metre (supersampled), unused
out vec4 o;

float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a; float l2 = dot(ba, ba); float rr = r1 - r2; float a2 = l2 - rr * rr; float il2 = 1.0 / l2;
  vec3 pa = p - a; float y = dot(pa, ba); float z = y - l2; vec3 xv = pa * l2 - ba * y; float x2 = dot(xv, xv);
  float y2 = y * y * l2; float z2 = z * z * l2; float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
float prim(int i, vec3 p) {
  vec4 A = uA[i], B = uB[i], C = uC[i], M = uM[i];
  float d;
  if (M.x < 0.5) d = sdRoundCone(p, A.xyz, B.xyz, A.w, B.w);
  else {
    vec3 ex = B.xyz, ey = C.xyz; float rx = length(ex), ry = length(ey); ex /= rx; ey /= ry; vec3 ez = cross(ex, ey);
    vec3 q = p - A.xyz; vec3 l = vec3(dot(q, ex), dot(q, ey), dot(q, ez)); vec3 r = vec3(rx, ry, A.w);
    if (M.x < 1.5) { float k0 = length(l / r); float k1 = length(l / (r * r)); d = k0 * (k0 - 1.0) / max(k1, 1e-6); }
    else { vec3 qq = abs(l) - r + M.w; d = length(max(qq, 0.0)) + min(max(qq.x, max(qq.y, qq.z)), 0.0) - M.w; }
  }
  vec4 P = uP[i];
  if (dot(P.xyz, P.xyz) > 0.5) d = max(d, P.w - dot(p, P.xyz));
  return d;
}
float map(vec3 p, out int best) {
  float d = 1e9, gd = 1e9, bestRaw = 1e9; int g = -1; best = -1;
  for (int i = 0; i < ${MAXP}; i++) {
    if (i >= uN) break;
    float di = prim(i, p);
    if (di < bestRaw) { bestRaw = di; best = i; }
    int gi = int(uM[i].y);
    if (gi != g) { d = min(d, gd); gd = di; g = gi; } else gd = smin(gd, di, uGK[gi]);
  }
  return min(d, gd);
}
float map0(vec3 p) { int b; return map(p, b); }
vec3 nrm(vec3 p) {
  vec2 e = vec2(0.0007, -0.0007);
  return normalize(e.xyy * map0(p + e.xyy) + e.yyx * map0(p + e.yyx) + e.yxy * map0(p + e.yxy) + e.xxx * map0(p + e.xxx));
}
float shadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.012;
  for (int i = 0; i < 40; i++) {
    float h = map0(ro + rd * t);
    res = min(res, 9.0 * h / t);
    t += clamp(h, 0.006, 0.08);
    if (res < 0.02 || t > 1.6) break;
  }
  return clamp(res, 0.0, 1.0);
}
float ao(vec3 p, vec3 n) {
  float occ = 0.0, w = 1.0;
  for (int i = 1; i <= 5; i++) { float h = 0.012 * float(i); occ += (h - map0(p + n * h)) * w; w *= 0.7; }
  return clamp(1.0 - 9.0 * occ, 0.0, 1.0);
}
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  vec2 s = uWin.xy + gl_FragCoord.xy / uWin.z;
  vec3 ro = uRight * s.x + uUp * s.y + uCam * 4.0, rd = -uCam;
  float t = 0.0; int id = -1; bool hit = false;
  for (int i = 0; i < 160; i++) {
    int b; float d = map(ro + rd * t, b);
    if (d < 0.0005) { hit = true; id = b; break; }
    t += d;
    if (t > 8.0) break;
  }
  if (!hit) { o = vec4(0.0); return; }
  int region = int(uM[id].z);
  if (region == 7) { o = vec4(0.0); return; }
  vec3 p = ro + rd * t, n = nrm(p);
  // Cloth: a soft fold/fibre wobble on the normal so fabric doesn't read as plastic.
  if (region == 1 || region == 2) {
    vec3 w = vec3(vnoise(p * 55.0), vnoise(p * 55.0 + 7.1), vnoise(p * 55.0 + 3.7)) - 0.5;
    n = normalize(n + w * 0.32);
  }
  vec3 L = normalize(vec3(0.42, 1.0, 0.55)), Rl = normalize(vec3(-0.85, 0.45, -0.15)), V = uCam;
  float nl = dot(n, L);
  float sh = shadow(p + n * 0.003, L);
  // Painterly toon ramp: a soft terminator with a little brush-like jitter, a flat-ish lit plane and a gentle top highlight.
  float j = (vnoise(p * 70.0) - 0.5) * 0.16;
  float lit = smoothstep(-0.08 + j, 0.26 + j, nl) * mix(0.25, 1.0, sh);
  float diff = mix(0.46, 0.94, lit) + 0.06 * smoothstep(0.55, 0.85, nl) * sh;
  float a = mix(0.62, 1.0, ao(p, n));
  float rim = pow(1.0 - max(dot(n, V), 0.0), 2.6) * smoothstep(-0.1, 0.5, dot(n, Rl)) * 0.32;
  float bounce = 0.07 * max(0.0, -n.y);
  float shade = clamp(diff * a + rim + bounce, 0.0, 1.0);
  o = vec4(uCol[id].rgb * shade, (float(region) + 1.0) / 8.0);
}`;

const canvas = document.createElement('canvas');
canvas.width = W;
canvas.height = H;
const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true })!;
function compile(type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}
const prog = gl.createProgram()!;
gl.attachShader(prog, compile(gl.VERTEX_SHADER, `#version 300 es
in vec2 v; void main() { gl_Position = vec4(v, 0.0, 1.0); }`));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
gl.useProgram(prog);
const vb = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vb);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'v');
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
const U = (n: string) => gl.getUniformLocation(prog, n);
gl.uniform3fv(U('uCam'), CAM);
gl.uniform3fv(U('uRight'), RIGHT);
gl.uniform3fv(U('uUp'), UP);
gl.uniform4f(U('uWin'), X0, Y0, PPM * SS, 0);
gl.uniform1fv(U('uGK[0]'), GROUP_K);
gl.viewport(0, 0, W, H);

const pix = new Uint8Array(W * H * 4);

function draw(prims: Prim[]): Uint8Array {
  if (prims.length > MAXP) throw new Error(`too many prims ${prims.length}`);
  const sorted = [...prims].sort((a, b) => a.group - b.group);
  const A = new Float32Array(MAXP * 4), B = new Float32Array(MAXP * 4), C = new Float32Array(MAXP * 4), M = new Float32Array(MAXP * 4), Co = new Float32Array(MAXP * 4), P = new Float32Array(MAXP * 4);
  sorted.forEach((p, i) => {
    A.set([...p.a, p.r1], i * 4);
    B.set([...p.b, p.r2], i * 4);
    C.set([...p.c, 0], i * 4);
    M.set([p.type, p.group, p.region, p.round], i * 4);
    Co.set([...p.col, 1], i * 4);
    if (p.plane) P.set(p.plane, i * 4);
  });
  gl.uniform4fv(U('uA[0]'), A);
  gl.uniform4fv(U('uB[0]'), B);
  gl.uniform4fv(U('uC[0]'), C);
  gl.uniform4fv(U('uM[0]'), M);
  gl.uniform4fv(U('uCol[0]'), Co);
  gl.uniform4fv(U('uP[0]'), P);
  gl.uniform1i(U('uN'), sorted.length);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pix);
  return pix;
}

// --- splitting a supersampled render into layers ---
interface Img { w: number; h: number; data: Uint8ClampedArray; ox: number; oy: number }

/** Draw order in the game: trousers, shirt, skin, gear. */
const ORDER = [Region.Bottom, Region.Top, Region.Skin, Region.Gear];

/**
 * One output pixel per 3×3 block. Each layer's alpha is chosen so that drawing the layers in ORDER with normal
 * blending reproduces the total coverage (no background seam where two regions meet inside a pixel).
 */
function split(src: Uint8Array, nLayers: number, regionOf: (a: number) => number): Img[] {
  const N = SS * SS;
  const out = Array.from({ length: nLayers }, () => new Uint8ClampedArray(OW * OH * 4));
  const cnt = new Float32Array(nLayers), sr = new Float32Array(nLayers), sg = new Float32Array(nLayers), sb = new Float32Array(nLayers);
  for (let y = 0; y < OH; y++) {
    for (let x = 0; x < OW; x++) {
      cnt.fill(0); sr.fill(0); sg.fill(0); sb.fill(0);
      let any = false;
      for (let j = 0; j < SS; j++) {
        // GL rows are bottom-up.
        const row = H - 1 - (y * SS + j);
        for (let i = 0; i < SS; i++) {
          const k = (row * W + x * SS + i) * 4;
          const a = src[k + 3];
          if (!a) continue;
          const r = regionOf(a);
          if (r < 0) continue;
          any = true;
          cnt[r]++; sr[r] += src[k]; sg[r] += src[k + 1]; sb[r] += src[k + 2];
        }
      }
      if (!any) continue;
      let S = 0;
      for (let li = 0; li < nLayers; li++) {
        const n = cnt[li];
        if (!n) continue;
        const alpha = n / (N - S);
        S += n;
        const o = (y * OW + x) * 4;
        out[li][o] = sr[li] / n; out[li][o + 1] = sg[li] / n; out[li][o + 2] = sb[li] / n;
        out[li][o + 3] = Math.round(alpha * 255);
      }
    }
  }
  return out.map(trim);
}

function trim(d: Uint8ClampedArray): Img {
  let x0 = OW, y0 = OH, x1 = -1, y1 = -1;
  for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) if (d[(y * OW + x) * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { w: 0, h: 0, data: new Uint8ClampedArray(0), ox: 0, oy: 0 };
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(d.subarray(((y0 + y) * OW + x0) * 4, ((y0 + y) * OW + x0 + w) * 4), y * w * 4);
  return { w, h, data, ox: x0 - PIVOT_X, oy: y0 - PIVOT_Y };
}

/** World point → output pixel relative to the pivot (the point between the feet on the floor). */
function proj(p: V3): [number, number] {
  return [dot(p, RIGHT) * PPM, -dot(p, UP) * PPM];
}

// Layer index from the alpha code: 0 trousers, 1 shirt, 2 skin, 3 gear (ORDER).
const bodyRegion = (a: number) => ORDER.indexOf(Math.round((a * 8) / 255) - 1 as never);

interface FrameOut { layers: Img[]; head: [number, number, number] }

function renderFrame(b: Body, animName: string, i: number): FrameOut {
  const a = ANIMS[animName];
  const p = sample(a, b, i / a.frames);
  const bones = pose(b, p);
  const prims = place([...bodyPrims(b, p.g_N, p.g_F), ...gearPrims(a.gear ?? null, b)], bones);
  const layers = split(draw(prims), 4, bodyRegion);
  const hb = bones.head;
  const h0 = proj(hb.t), h1 = proj(point(hb, [0, 0.1, 0]));
  const ang = Math.atan2(h1[0] - h0[0], -(h1[1] - h0[1]));
  return { layers, head: [round1(h0[0]), round1(h0[1]), Math.round(ang * 1000) / 1000] };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function renderAttachment(b: Body, id: (typeof ATTACHMENTS)[number]): Img {
  const bones = pose(b, { ...BASE });
  const head = place(bodyPrims(b, 0.35, 0.35).filter(l => l.bone === 'head' || l.bone === 'neck'), bones);
  for (const h of head) h.region = Region.Hold;
  const prims = [...head, ...place(attachPrims(id, b), bones)];
  const [img] = split(draw(prims), 1, a => (Math.round((a * 8) / 255) - 1 === Region.Hold ? -1 : 0));
  // Offsets relative to the head joint instead of the feet.
  const hp = proj(bones.head.t);
  img.ox = Math.round((img.ox - hp[0]) * 10) / 10;
  img.oy = Math.round((img.oy - hp[1]) * 10) / 10;
  return img;
}

/** Lets the page breathe between animations (MessageChannel: not throttled in a background tab, unlike timers). */
function yieldNow(): Promise<void> {
  return new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
}

// --- atlas packing ---
interface Placed { img: Img; x: number; y: number }

function pack(imgs: Img[], width: number): { placed: Placed[]; w: number; h: number } {
  const PAD = 4;
  const order = imgs.filter(i => i.w).sort((a, b) => b.h - a.h || b.w - a.w);
  const placed: Placed[] = [];
  let x = PAD, y = PAD, rowH = 0;
  for (const img of order) {
    if (x + img.w + PAD > width) { x = PAD; y += rowH + PAD; rowH = 0; }
    placed.push({ img, x, y });
    x += img.w + PAD;
    rowH = Math.max(rowH, img.h);
  }
  const h = y + rowH + PAD;
  return { placed, w: width, h: Math.ceil(h / 4) * 4 };
}

function atlasCanvas(p: { placed: Placed[]; w: number; h: number }): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = p.w;
  c.height = p.h;
  const ctx = c.getContext('2d')!;
  for (const { img, x, y } of p.placed) ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), x, y);
  return c;
}

async function save(path: string, c: HTMLCanvasElement, quality = 0.9): Promise<number> {
  const blob = await new Promise<Blob>(r => c.toBlob(bl => r(bl!), 'image/webp', quality));
  await fetch(`/__art/save/${path}`, { method: 'POST', body: blob });
  return blob.size;
}

async function saveStore(path: string, c: HTMLCanvasElement): Promise<void> {
  const blob = await new Promise<Blob>(r => c.toBlob(bl => r(bl!), 'image/png'));
  await fetch(`/__store/save/${path}`, { method: 'POST', body: blob });
}

// --- contact sheet (for review): composite tinted layers like the game does ---
const SAMPLE_TINT: Record<BodyId, [number, number, number]> = { man: [0x3a3328, 0x8a6a4a, 0xd8a882], woman: [0x2e3a4e, 0x6a9e9a, 0xc68a5e], child: [0x4a4a52, 0x9a8450, 0xf0c8a6], elder: [0x3e3a30, 0x5e6670, 0xe8c0a0] };

function composite(ctx: CanvasRenderingContext2D, f: FrameOut, tints: number[], x: number, y: number, attach?: Img[]): void {
  const tmp = document.createElement('canvas');
  for (let li = 0; li < 4; li++) {
    const img = f.layers[li];
    if (!img.w) continue;
    tmp.width = img.w; tmp.height = img.h;
    const tc = tmp.getContext('2d')!;
    const d = new Uint8ClampedArray(img.data);
    if (li < 3) {
      const t = tints[li];
      for (let k = 0; k < d.length; k += 4) { d[k] = (d[k] * ((t >> 16) & 255)) / 255; d[k + 1] = (d[k + 1] * ((t >> 8) & 255)) / 255; d[k + 2] = (d[k + 2] * (t & 255)) / 255; }
    }
    tc.putImageData(new ImageData(d, img.w, img.h), 0, 0);
    ctx.drawImage(tmp, x + img.ox, y + img.oy);
  }
  for (const a of attach ?? []) {
    if (!a.w) continue;
    tmp.width = a.w; tmp.height = a.h;
    const tc = tmp.getContext('2d')!;
    const d = new Uint8ClampedArray(a.data);
    for (let k = 0; k < d.length; k += 4) { d[k] *= 0.35; d[k + 1] *= 0.27; d[k + 2] *= 0.2; }
    tc.putImageData(new ImageData(d, a.w, a.h), 0, 0);
    ctx.save();
    ctx.translate(x + f.head[0], y + f.head[1]);
    ctx.rotate(f.head[2]);
    ctx.drawImage(tmp, a.ox, a.oy);
    ctx.restore();
  }
}

async function run(): Promise<void> {
  const only = q.get('only')?.split(',') as BodyId[] | undefined;
  const bodies = (Object.keys(BODIES) as BodyId[]).filter(b => !only || only.includes(b));
  const auto = q.has('auto');
  const metaUrl = '/art/people/people.json';
  let meta: { v: number; ppm: number; ss: number; bodies: Record<string, unknown>; attach: { atlas: string; w: number; h: number; items: Record<string, Record<string, number[]>> } } =
    { v: 1, ppm: PPM, ss: SS, bodies: {}, attach: { atlas: 'people/attach.webp', w: 0, h: 0, items: {} } };
  if (only) {
    try { const r = await fetch(metaUrl, { cache: 'no-store' }); if (r.ok) meta = await r.json(); } catch { /* fresh */ }
  }
  const t0 = performance.now();
  let total = 0;
  const attachImgs: { body: BodyId; id: string; img: Img }[] = [];
  for (const id of bodies) {
    const b = BODIES[id];
    const frames: Record<string, FrameOut[]> = {};
    for (const an of ANIM_ORDER) {
      frames[an] = [];
      for (let i = 0; i < ANIMS[an].frames; i++) frames[an].push(renderFrame(b, an, i));
      await yieldNow();
      (window as unknown as { __progress: string }).__progress = `${id}/${an}`;
    }
    for (const at of ATTACHMENTS) attachImgs.push({ body: id, id: at, img: renderAttachment(b, at) });
    const all = Object.values(frames).flatMap(fs => fs.flatMap(f => f.layers));
    const area = all.reduce((s, i) => s + i.w * i.h, 0);
    const width = area > 3_000_000 ? 2048 : area > 900_000 ? 1536 : 1024;
    const packed = pack(all, width);
    const pos = new Map<Img, Placed>(packed.placed.map(p => [p.img, p]));
    const rest = pose(b, { ...BASE });
    const top = proj(point(rest.head, [0, 0.235 * b.headS, 0]));
    const hb = rest.head, h0 = proj(hb.t), h1 = proj(point(hb, [0, 0.1, 0]));
    const anims: Record<string, unknown> = {};
    for (const an of ANIM_ORDER) {
      const A = ANIMS[an];
      anims[an] = {
        fps: A.fps,
        ...(A.stride ? { stride: A.stride } : {}),
        f: frames[an].map(f => ({
          l: f.layers.map(img => { const p = pos.get(img); return p ? [p.x, p.y, img.w, img.h, img.ox, img.oy] : 0; }),
          h: f.head,
        })),
      };
    }
    meta.bodies[id] = { atlas: `people/${id}.webp`, w: packed.w, h: packed.h, height: Math.round(-top[1]), headRef: Math.round(Math.atan2(h1[0] - h0[0], -(h1[1] - h0[1])) * 1000) / 1000, anims };
    const canvasA = atlasCanvas(packed);
    log(`${id}: ${all.length} layer cells, ${packed.w}x${packed.h}, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    if (auto) { const sz = await save(`people/${id}.webp`, canvasA); total += sz; log(`  saved ${(sz / 1024).toFixed(0)} KB`); }
    // Contact sheet: every other frame of every animation in sample clothes.
    const cols = 16, cw = Math.round(1.25 * PPM), ch = Math.round(2.55 * PPM);
    const list = ANIM_ORDER.flatMap(an => frames[an].filter((_f, i) => i % 2 === 0).map(f => ({ an, f })));
    const sheet = document.createElement('canvas');
    sheet.width = cols * cw; sheet.height = Math.ceil(list.length / cols) * ch;
    const sc = sheet.getContext('2d')!;
    sc.fillStyle = '#5a5248'; sc.fillRect(0, 0, sheet.width, sheet.height);
    const hair = attachImgs.filter(a => a.body === id && a.id === (id === 'woman' ? 'hair-long' : id === 'elder' ? 'hair-short' : id === 'child' ? 'hair-cropped' : 'hair-short')).map(a => a.img);
    list.forEach(({ f }, k) => composite(sc, f, SAMPLE_TINT[id], (k % cols) * cw + cw * 0.4, Math.floor(k / cols) * ch + ch - 8, hair));
    document.getElementById('outs')!.appendChild(sheet);
    if (auto || q.has('sheet')) await saveStore(`store/compare/p1-people/sheet-${id}.png`, sheet);
  }
  // Attachments atlas (all bodies rendered this run; keep earlier ones when only some bodies were redone).
  const packedA = pack(attachImgs.map(a => a.img), 512);
  const posA = new Map<Img, Placed>(packedA.placed.map(p => [p.img, p]));
  if (!only) meta.attach.items = {};
  for (const a of attachImgs) {
    const p = posA.get(a.img);
    (meta.attach.items[a.body] ??= {})[a.id] = p ? [p.x, p.y, a.img.w, a.img.h, a.img.ox, a.img.oy, TINTED[a.id as keyof typeof TINTED] ? 1 : 0] : [];
  }
  meta.attach.w = packedA.w; meta.attach.h = packedA.h;
  if (auto && !only) {
    total += await save('people/attach.webp', atlasCanvas(packedA), 0.92);
    await fetch('/__art/save/people/people.json', { method: 'POST', body: JSON.stringify(meta) });
    log(`total ${(total / 1024).toFixed(0)} KB; done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  } else if (auto) {
    log('partial run (only=): atlases saved, attach + meta not rewritten — run without only= to finish');
  }
  (window as unknown as { __done: boolean }).__done = true;
}

void run().catch(e => { log(String(e?.stack ?? e)); (window as unknown as { __done: string }).__done = 'error'; });
