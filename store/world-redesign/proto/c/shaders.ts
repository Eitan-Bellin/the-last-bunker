/** GLSL ES 3.00 sources. Forward shading: one pass, up to 16 point lights, procedural materials, fog of war, tone-map and grain. */

const COMMON = /* glsl */ `
precision highp float;
precision highp int;
uniform float uTime;
uniform vec2 uRes;
uniform vec4 uPost;   // exposure, saturation, contrast, vignette
uniform float uGrain;
uniform sampler2D uFow;
uniform vec4 uFowRect; // x0, y0, 1/w, 1/h (metres)
uniform sampler2D uNoise;

float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return vnoise(p) * 0.62 + vnoise(p * 2.13 + 7.1) * 0.38; }

float fowAt(vec2 xy) {
  float r = texture(uFow, (xy - uFowRect.xy) * uFowRect.zw).r;
  return max(r, smoothstep(-0.9, 0.4, xy.y));
}

`;

const POST = /* glsl */ `
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

vec3 post(vec3 c) {
  c = aces(c * uPost.x);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uPost.y);
  c = clamp((c - 0.5) * uPost.z + 0.5, 0.0, 1.0);
  c = pow(c, vec3(1.0 / 2.2));
  vec2 q = gl_FragCoord.xy / uRes;
  float v = smoothstep(0.95, 0.2, length((q - 0.5) * vec2(1.15, 1.0)));
  c *= mix(1.0, v, uPost.w);
  c += (h12(gl_FragCoord.xy + fract(uTime * 7.0) * 113.0) - 0.5) * uGrain;
  return c;
}
`;

export const MAIN_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aCol;
layout(location=3) in vec2 aMat;
uniform mat4 uVP;
out vec3 vPos; out vec3 vNrm; out vec3 vCol; out float vMat; out float vAo;
void main() {
  vPos = aPos; vNrm = aNrm; vCol = aCol; vMat = aMat.x; vAo = aMat.y;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

export const MAIN_FS = /* glsl */ `#version 300 es
${COMMON}
${POST}
in vec3 vPos; in vec3 vNrm; in vec3 vCol; in float vMat; in float vAo;
uniform vec3 uCam;
uniform int uNL;
uniform vec4 uLP[24];
uniform vec4 uLC[24];
uniform vec3 uAmbTop, uAmbDeep, uSection, uSunDir, uSunCol, uSkyFill;
uniform vec2 uDark;
uniform vec3 uHazeCol; uniform vec2 uHaze;
uniform vec3 uFowCol, uFowEdge; uniform vec2 uFowK;
uniform vec4 uLook; // falloffK, wrap, specular, figureLift
out vec4 oCol;

uniform sampler2D uLGrid;
uniform vec4 uLGRect; // x0, y0, 1/cell, 1/cell
uniform ivec2 uLGSize;
uniform int uLantern;
float vAoG;

float lineD(float u, float s) { return s * abs(fract(u / s + 0.5) - 0.5); }

void addLight(int i, vec3 P, vec3 N, vec3 V, float spec, inout vec3 L, inout vec3 S) {
  if (i < 0) return;
  vec3 d = uLP[i].xyz - P;
  float d2 = dot(d, d);
  float r = uLP[i].w;
  if (d2 > r * r) return;
  float dist = sqrt(d2);
  vec3 l = d / dist;
  float x = d2 / (r * r);
  float att = (1.0 - x) * (1.0 - x) / (1.0 + uLook.x * d2);
  float ndl = max((dot(N, l) + uLook.y) / (1.0 + uLook.y), 0.0);
  vec3 lc = uLC[i].rgb * att;
  L += lc * ndl * mix(1.0, vAoG, 0.6);
  if (spec > 0.0) {
    vec3 h = normalize(l + V);
    S += lc * pow(max(dot(N, h), 0.0), 28.0) * spec * uLook.z * step(0.0, dot(N, l));
  }
}

void main() {
  vec3 P = vPos;
  vec3 N = normalize(vNrm);
  vAoG = vAo;
  int m = int(vMat + 0.5);
  vec3 base = vCol;
  vec3 emis = vec3(0.0);
  float spec = 0.0;
  vec3 a = abs(N);
  vec2 uv = a.x > a.y && a.x > a.z ? P.zy : (a.y > a.z ? P.xz : P.xy);
  float fw = length(fwidth(P));

  if (m == 0 || m == 11) {
    vec4 T = texture(uNoise, uv * 0.11);
    float n1 = T.r * 0.6 + T.g * 0.4;
    float bands = sin(P.y * 2.3 + n1 * 5.0 + P.x * 0.05);
    base *= 0.58 + 0.62 * n1 + 0.1 * bands + 0.26 * (T.b - 0.5);
    float cr = texture(uNoise, uv * vec2(0.045, 0.03) + 0.37).g;
    base *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.025 + fw * 0.1, abs(cr - 0.5)));
    base += vec3(0.03, 0.028, 0.025) * step(0.86, T.a);
  } else if (m == 1) {
    vec4 T = texture(uNoise, uv * 0.13);
    base *= 0.78 + 0.38 * (T.r * 0.6 + T.g * 0.4) + 0.1 * (T.a - 0.5);
    float seam = min(lineD(uv.x, 2.4), lineD(uv.y, 1.6));
    base *= 1.0 - 0.35 * (1.0 - smoothstep(0.015, 0.04 + fw, seam)) * (1.0 - smoothstep(0.08, 0.3, fw));
    float st = texture(uNoise, vec2(uv.x * 0.25, uv.y * 0.025)).b;
    base *= 1.0 - 0.3 * smoothstep(0.55, 0.85, st);
    spec = 0.08;
  } else if (m == 2) {
    vec4 T = texture(uNoise, uv * 0.3);
    float rust = smoothstep(0.48, 0.78, T.r * 0.6 + T.g * 0.4);
    base = mix(base, base * vec3(1.25, 0.7, 0.45) + vec3(0.08, 0.03, 0.0), rust);
    base *= 0.85 + 0.3 * T.b;
    spec = 0.7 * (1.0 - rust);
  } else if (m == 3) {
    float g = texture(uNoise, vec2((P.x + P.z) * 0.08, P.y * 0.9)).b;
    base *= 0.72 + 0.45 * g;
    base *= 1.0 - 0.45 * (1.0 - smoothstep(0.01, 0.025 + fw, lineD(uv.x, 0.32))) * (1.0 - smoothstep(0.05, 0.2, fw));
  } else if (m == 4) {
    float rib = sin(uv.x * 20.0);
    base *= 0.84 + 0.16 * rib * (1.0 - smoothstep(0.03, 0.12, fw));
    vec4 T = texture(uNoise, uv * 0.2);
    base = mix(base, base * vec3(1.3, 0.75, 0.5), smoothstep(0.5, 0.8, T.r * 0.6 + T.g * 0.4));
    base *= 0.8 + 0.3 * T.b;
    spec = 0.3;
  } else if (m == 5) {
    vec2 cell = floor(uv / 0.3);
    base *= 0.85 + 0.3 * h12(cell);
    float grout = min(lineD(uv.x, 0.3), lineD(uv.y, 0.3));
    base *= 1.0 - 0.5 * (1.0 - smoothstep(0.008, 0.02 + fw, grout)) * (1.0 - smoothstep(0.05, 0.15, fw));
    base *= 0.55 + 0.5 * texture(uNoise, uv * 0.06).r;
    spec = 0.5;
  } else if (m == 6) {
    emis = base; base = vec3(0.0);
  } else if (m == 7 || m == 10) {
    vec4 T = texture(uNoise, uv * (m == 7 ? 0.25 : 0.1));
    base *= 0.62 + 0.55 * (T.r * 0.6 + T.g * 0.4);
    base += vec3(0.025) * step(0.86, T.a);
  } else if (m == 8) {
    float pulse = 0.6 + 0.4 * sin(uTime * 1.3 + P.x * 3.0 + P.y * 2.0);
    emis = base * pulse * 1.6; base *= 0.25;
  }

  // ---- light
  float deep = 1.0 - smoothstep(uDark.y, uDark.x, P.y);
  vec3 amb = mix(uAmbTop, uAmbDeep, deep) * (0.7 + 0.3 * max(N.y, 0.0));
  vec3 L = amb * vAo;
  float sunK = smoothstep(-4.5, 0.2, P.y);
  L += (uSunCol * max(dot(N, uSunDir), 0.0) + uSkyFill * (0.6 + 0.4 * N.y)) * sunK * vAo;
  float cut = step(0.9, N.z) * step(-0.05, P.z);
  L += uSection * cut;
  vec3 V = normalize(uCam - P);
  vec3 S = vec3(0.0);
  // clustered lights: this 2 m cell's (up to 8) lights from the light grid, plus the moving lantern
  ivec2 ci = clamp(ivec2(floor((P.xy - uLGRect.xy) * uLGRect.zw)), ivec2(0), uLGSize - 1);
  vec4 A = texelFetch(uLGrid, ivec2(ci.x * 2, ci.y), 0);
  vec4 B = texelFetch(uLGrid, ivec2(ci.x * 2 + 1, ci.y), 0);
  addLight(int(A.x * 255.0 + 0.5) - 1, P, N, V, spec, L, S);
  addLight(int(A.y * 255.0 + 0.5) - 1, P, N, V, spec, L, S);
  addLight(int(A.z * 255.0 + 0.5) - 1, P, N, V, spec, L, S);
  addLight(int(A.w * 255.0 + 0.5) - 1, P, N, V, spec, L, S);
  addLight(int(B.x * 255.0 + 0.5) - 1, P, N, V, spec, L, S);
  addLight(int(B.y * 255.0 + 0.5) - 1, P, N, V, spec, L, S);
  addLight(int(B.z * 255.0 + 0.5) - 1, P, N, V, spec, L, S);
  addLight(int(B.w * 255.0 + 0.5) - 1, P, N, V, spec, L, S);
  addLight(uLantern, P, N, V, spec, L, S);
  if (m == 9) L += vec3(uLook.w);
  vec3 col = base * L + S + emis;

  // ---- haze for the far world
  float dist = length(uCam - P);
  col = mix(col, uHazeCol, 1.0 - exp(-uHaze.x * max(dist - uHaze.y, 0.0)));

  // ---- fog of war
  float rev = fowAt(P.xy);
  float sw = texture(uNoise, P.xy * 0.018 + vec2(uTime * 0.003, uTime * 0.001)).r;
  float sw2 = texture(uNoise, P.xy * 0.05 - vec2(uTime * 0.006, 0.0)).g;
  vec3 fogc = uFowCol * (0.55 + uFowK.x * (sw * 1.2 + sw2 * 0.5));
  float r2 = smoothstep(0.0, 1.0, clamp(rev + (sw - 0.5) * 0.5 * rev * (1.0 - rev) * 4.0, 0.0, 1.0));
  col = mix(fogc, col, r2);
  col += uFowEdge * (r2 * (1.0 - r2) * 4.0) * uFowK.y * (0.4 + sw2);

  oCol = vec4(post(col), 1.0);
}`;

export const SKY_VS = /* glsl */ `#version 300 es
out vec2 vNdc;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 0.9999, 1.0);
}`;

export const SKY_FS = /* glsl */ `#version 300 es
${COMMON}
${POST}
in vec2 vNdc;
uniform mat4 uInvVP;
uniform vec3 uSunDir, uZenith, uHorizon, uSunGlow, uSkyline, uSkyWin, uVoid;
out vec4 oCol;
void main() {
  vec4 a = uInvVP * vec4(vNdc, -1.0, 1.0);
  vec4 b = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  float y = d.y;
  vec3 c = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.5, y), 0.55));
  vec3 sd = normalize(uSunDir);
  float s = max(dot(d, sd), 0.0);
  c += uSunGlow * (pow(s, 6.0) * 0.45 + pow(s, 60.0) * 1.2) * smoothstep(-0.1, 0.05, y);
  vec2 cp = d.xz / max(y + 0.08, 0.05);
  vec4 CT = texture(uNoise, cp * vec2(0.03, 0.08) + vec2(uTime * 0.0006, 0.0));
  float cl = CT.r * 0.6 + CT.g * 0.4;
  c = mix(c, c * 0.35 + uHorizon * 0.05, smoothstep(0.42, 0.78, cl) * smoothstep(0.0, 0.2, y));
  float az = atan(d.x, -d.z);
  float col = floor(az * 70.0);
  float hgt = 0.012 + 0.05 * pow(h12(vec2(col, 3.0)), 2.0) * (0.4 + 0.6 * texture(uNoise, vec2(az * 0.25, 0.5)).r);
  float col2 = floor(az * 130.0);
  float hgt2 = 0.01 + 0.025 * h12(vec2(col2, 9.0));
  if (y < hgt2) c = mix(c, uSkyline * 2.5 + uHorizon * 0.12, 0.85);
  if (y < hgt) {
    c = uSkyline;
    vec2 wc = floor(vec2(az * 900.0, y * 900.0));
    if (h12(wc) > 0.993) c += uSkyWin * 0.35;
  }
  if (y < 0.0) c = mix(c, uVoid, smoothstep(0.0, 0.08, -y));
  oCol = vec4(post(c), 1.0);
}`;

export const HALO_VS = /* glsl */ `#version 300 es
${COMMON}
layout(location=0) in vec3 aCenter;
layout(location=1) in vec2 aCorner;
layout(location=2) in vec4 aCol; // rgb, size
uniform mat4 uV; uniform mat4 uP;
out vec2 vUv; out vec3 vCol;
void main() {
  vec4 vc = uV * vec4(aCenter, 1.0);
  vc.z += aCol.w * 0.6;
  vc.xy += aCorner * aCol.w;
  vUv = aCorner;
  vCol = aCol.rgb * fowAt(aCenter.xy);
  gl_Position = uP * vc;
}`;

export const HALO_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vCol;
out vec4 oCol;
void main() {
  float r = length(vUv);
  float a = exp(-r * r * 5.0) * 0.8 + exp(-r * r * 40.0) * 0.6;
  a *= smoothstep(1.0, 0.7, r);
  oCol = vec4(vCol * a, 1.0);
}`;

export const CONE_VS = /* glsl */ `#version 300 es
${COMMON}
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec4 aCol; // rgb, alpha
layout(location=3) in float aLight;
uniform mat4 uVP; uniform vec3 uCam;
uniform float uLI[24];
out vec3 vCol; out float vA; out vec3 vN; out vec3 vV;
void main() {
  vN = aNrm; vV = normalize(uCam - aPos);
  int li = int(aLight + 0.5);
  vCol = aCol.rgb * uLI[li] * fowAt(aPos.xy);
  vA = aCol.a;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

export const CONE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vCol; in float vA; in vec3 vN; in vec3 vV;
uniform float uStrength;
out vec4 oCol;
void main() {
  float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
  oCol = vec4(vCol * vA * f * uStrength, 1.0);
}`;

export const PART_VS = /* glsl */ `#version 300 es
${COMMON}
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aSeed; // seed, kind
uniform mat4 uVP;
uniform float uPointScale;
uniform int uNL;
uniform vec4 uLP[24];
uniform vec4 uLC[24];
out vec3 vCol;
void main() {
  float s = aSeed.x;
  int kind = int(aSeed.y + 0.5);
  vec3 p = aPos;
  float size = 0.05;
  vec3 col = vec3(0.0);
  if (kind == 0) {
    p += vec3(sin(uTime * 0.21 + s * 40.0) * 0.7, sin(uTime * 0.13 + s * 90.0) * 0.5, cos(uTime * 0.17 + s * 60.0) * 0.6);
    for (int i = 0; i < 24; i++) {
      vec3 d = uLP[i].xyz - p;
      float x = dot(d, d) / (uLP[i].w * uLP[i].w);
      if (x < 1.0) col += uLC[i].rgb * (1.0 - x) * (1.0 - x) * 0.35;
    }
    size = 0.045;
  } else if (kind == 1) {
    float H = 14.0;
    p.y = mod(aPos.y - uTime * (0.35 + s * 0.3), H);
    p.x += sin(uTime * 0.4 + s * 50.0) * 1.2 + uTime * 0.25 * (s - 0.3);
    col = vec3(0.32, 0.27, 0.25) * (0.5 + s);
    size = 0.06;
  } else {
    float life = fract(uTime * (0.45 + s * 0.4) + s * 7.0);
    p.y += life * (2.2 + s * 1.5);
    p.x += sin(s * 50.0) * life * 0.8;
    p.z += cos(s * 70.0) * life * 0.6;
    col = vec3(3.0, 1.1, 0.25) * (1.0 - life) * (1.0 - life);
    size = 0.04;
  }
  vCol = col * fowAt(p.xy);
  gl_Position = uVP * vec4(p, 1.0);
  gl_PointSize = clamp(size * uPointScale / gl_Position.w, 1.0, 12.0);
}`;

export const PART_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vCol;
out vec4 oCol;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - d) * (1.0 - d);
  if (d > 1.0) discard;
  oCol = vec4(vCol * a, 1.0);
}`;
