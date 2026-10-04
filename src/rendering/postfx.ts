import {
  ColorMatrixFilter, Filter, GlProgram, Rectangle, RenderTexture, RendererType, Texture, defaultFilterVert,
  type Application, type Container, type FilterSystem, type RenderSurface,
} from 'pixi.js';
import { PerformanceMonitor, type QualityLevel } from '../utils/PerformanceMonitor';
import { TOPSOIL } from './layout';
import { nightLight } from './structure';
import { isLiteMode } from '../core/crashGuard';
import { isTouchDevice } from '../utils/device';

const BLOOM_SCALE = 0.25;
const QUALITY_KEY = 'lastbunker_gfx';
const BRIGHTNESS_KEY = 'lastbunker_bright';

/**
 * What each graphics level really changes. `res` caps the pixel density (1 = a pixel per CSS pixel) and `mp` caps the
 * pixels drawn per picture (megapixels), so a big tablet gets the same budget as a phone instead of three times the heat.
 * `msaa` smooths the edges of everything in the world (only below 1.75x: at phone densities the pixels are already finer
 * than the eye, and 4x samples of a 3x picture were what cooked phones on High), `passes` is the bloom blur, `grain` the
 * film grain, and `fps` is the picture rate while the player is touching / watching / idle.
 *
 * Sharpness comes from pixel density, heat from pixels x effects x pictures per second: so Medium (the phone default) keeps
 * a sharp 2x picture and saves on the effects and the idle picture rate, never on sharpness.
 */
export interface QualityProfile {
  res: number;
  mp: number;
  msaa: boolean;
  passes: number;
  grain: boolean;
  fps: [number, number, number];
}
export const QUALITY_PROFILE: Record<QualityLevel, QualityProfile> = {
  high: { res: 3, mp: 3.4, msaa: true, passes: 4, grain: true, fps: [60, 60, 30] },
  medium: { res: 2, mp: 1.8, msaa: false, passes: 2, grain: false, fps: [60, 30, 15] },
  low: { res: 1.5, mp: 0.9, msaa: false, passes: 0, grain: false, fps: [30, 20, 10] },
};

/** Pixel density for a level on this screen: the device's own density, capped by the level and by its pixel budget. */
export function targetResolution(level: QualityLevel): number {
  const p = QUALITY_PROFILE[level];
  const dpr = window.devicePixelRatio || 1;
  const css = Math.max(1, window.innerWidth * window.innerHeight);
  const budget = Math.sqrt((p.mp * 1e6) / css);
  return Math.max(1, Math.round(Math.min(dpr, p.res, budget) * 4) / 4);
}

export function storedQuality(): QualityLevel | null {
  try {
    const s = localStorage.getItem(QUALITY_KEY);
    return s === 'high' || s === 'medium' || s === 'low' ? s : null;
  } catch {
    return null;
  }
}

/** The level a session starts at: the player's pick, else lite mode, else by device (phones and small devices start at medium). */
export function startQuality(): QualityLevel {
  const stored = storedQuality();
  if (stored) return stored;
  if (isLiteMode()) return 'low';
  return isTouchDevice() || (navigator.hardwareConcurrency ?? 8) <= 4 ? 'medium' : 'high';
}

/**
 * Screen brightness (player setting): a gamma curve over the finished frame lifts the dark mid-tones, a faint floor keeps
 * shadows from going dead black, and white stays white. 'normal' is the original moody look. Playtest after playtest said
 * "the bunker is dark", so the default is one step up.
 */
export type Brightness = 'normal' | 'bright' | 'brighter';
export const BRIGHTNESS_LEVELS: Brightness[] = ['normal', 'bright', 'brighter'];
/** Gamma lift (1 - gamma) and black floor per level; scaled below per era and night, because the dark eras are the dark ones. */
const LIFT: Record<Brightness, [number, number]> = { normal: [0, 0], bright: [0.28, 0.02], brighter: [0.42, 0.035] };
/** The Remnant is the darkest look, the Undercity already glows: the same setting lifts them by very different amounts. */
const ERA_LIFT = [1, 0.85, 0.5, 0.35];

/** What the composite needs from the renderer every frame. */
export interface PostView {
  era: number;
  /** 0..1 darkness of the bunker clock. */
  night: number;
  /** Milliseconds per picture the engine is aiming for right now. */
  target?: number;
}

/**
 * Vignette per era (gfx-p0 light, ported from the old CSS overlay): where the darkening starts (0 = centre,
 * 1 = screen corner) and how dark the corners get. The Remnant closes in, the Undercity opens up.
 */
// Softer than first tuned: the strong vignette ate the bunker's side rooms (playtest: "the bunker is really dark").
const VIGNETTE: [number, number][] = [[0.45, 0.4], [0.5, 0.32], [0.55, 0.26], [0.6, 0.2]];

/**
 * Cinematic post-processing, one composite pass over the world (gfx-p0 light).
 *
 * The world already renders into a filter texture for the era grade, so everything rides on that pass:
 * - bloom is extracted from the finished frame at quarter size (soft-knee threshold, coloured light weighted
 *   over white walls, Karis-averaged so single bright pixels don't sparkle), spread by a few Kawase passes and
 *   added back before the tone curve: no second render of the scene any more;
 * - the era grade (the renderer's colour matrix), a gentle filmic shoulder that rolls highlights off instead
 *   of clipping them, a faint split tone, and an underground night grade (unlit structure falls away, lamp-lit
 *   surfaces keep their light and warm up);
 * - vignette and film grain in-engine (luminance-weighted, ~1 CSS px, 24 fps), replacing the CSS overlays.
 *
 * Quality ladder: high = bloom (4 blur passes) + grain, medium = lighter bloom (2 passes) + grain, low = grade and vignette only.
 * WebGPU (not used today) keeps the plain colour matrix.
 */
export class PostFX {
  private app: Application;
  private world: Container;
  private grade: ColorMatrixFilter | null;
  private view: () => PostView;
  private composite: CompositeFilter | null = null;
  private frame = 0;
  private monitor = new PerformanceMonitor();
  private forced: QualityLevel | null = null;
  private applied: QualityLevel | null = null;
  private night = 0;
  private vignette: [number, number] = VIGNETTE[1];
  private tone: Brightness = 'bright';
  private area: Rectangle | null = null;
  private msaa = false;

  constructor(app: Application, world: Container, grade?: ColorMatrixFilter, view?: () => PostView) {
    this.app = app;
    this.world = world;
    this.grade = grade ?? (world.filters as Filter[] | null)?.find((f): f is ColorMatrixFilter => f instanceof ColorMatrixFilter) ?? null;
    this.view = view ?? (() => ({ era: 1, night: 0 }));
    this.forced = storedQuality();
    try {
      const tone = localStorage.getItem(BRIGHTNESS_KEY);
      if (tone === 'normal' || tone === 'bright' || tone === 'brighter') this.tone = tone;
    } catch {
      // no stored preference
    }
    // Phones and tablets, and small low-core devices, start at medium (cooler, longer battery). The monitor can lift desktops
    // to high by itself; a phone only gets high when the player picks it in the settings.
    this.monitor.quality = startQuality();
    if (isTouchDevice()) this.monitor.maxQuality = 'medium';
    this.monitor.checkBattery();
    if (app.renderer.type === RendererType.WEBGL) {
      this.composite = new CompositeFilter(this.screenSize());
      world.filters = [this.composite];
      window.addEventListener('resize', () => this.composite?.resize(this.screenSize()));
    }
  }

  get forcedQuality(): QualityLevel | null {
    return this.forced;
  }

  get quality(): QualityLevel {
    // Lite mode (the game was killed twice in an hour) means no bloom or grain until the player picks a level.
    return this.forced ?? (isLiteMode() ? 'low' : this.monitor.quality);
  }

  /**
   * The level the player picked, or the device's starting level on Auto. Sharpness and picture rate follow this one only:
   * the automatic frame-rate monitor may take the light effects down when the device struggles, but it must never make the
   * picture blurry or choppy behind the player's back.
   */
  get baseLevel(): QualityLevel {
    return this.forced ?? startQuality();
  }

  /** What the current level changes (see QUALITY_PROFILE): effects follow the live level, sharpness and rates the base level. */
  get profile(): QualityProfile {
    return { ...QUALITY_PROFILE[this.quality], res: QUALITY_PROFILE[this.baseLevel].res, fps: QUALITY_PROFILE[this.baseLevel].fps };
  }

  /** Player override from the settings menu (null = automatic). */
  setQuality(q: QualityLevel | null): void {
    this.forced = q;
    try {
      if (q) localStorage.setItem(QUALITY_KEY, q);
      else localStorage.removeItem(QUALITY_KEY);
    } catch {
      // preference won't persist
    }
  }

  /** Gamma and floor for this era: stronger in the dark eras and again at night, never past a lift of 0.5. */
  private toneFor(era: number): [number, number] {
    const [lift, floor] = LIFT[this.tone];
    const k = ERA_LIFT[Math.max(0, Math.min(ERA_LIFT.length - 1, era))] * (1 + 0.5 * this.night);
    return [1 - Math.min(0.5, lift * k), floor * Math.min(1.5, k)];
  }

  get brightness(): Brightness {
    return this.tone;
  }

  setBrightness(b: Brightness): void {
    this.tone = b;
    try {
      localStorage.setItem(BRIGHTNESS_KEY, b);
    } catch {
      // preference won't persist
    }
  }

  private lastResize = -1e9;

  /** Pixel density follows the level (at most one change every 8 s, so a wobbling frame rate cannot make the canvas flicker). */
  private applyResolution(level: QualityLevel, now: number): void {
    const want = targetResolution(level);
    const r = this.app.renderer;
    if (Math.abs(r.resolution - want) < 0.01 || now - this.lastResize < 8000) return;
    this.lastResize = now;
    r.resize(this.app.screen.width, this.app.screen.height, want);
  }

  private screenSize(): [number, number] {
    return [Math.max(16, Math.ceil(window.innerWidth)), Math.max(16, Math.ceil(window.innerHeight))];
  }

  /** Called once per frame after the scene has been updated. */
  update(now: number): void {
    const v = this.view();
    this.monitor.recordFrame(now, v.target);
    if (++this.frame % 60 === 0) this.monitor.update();
    const q = this.quality;
    // The clock's night already ramps; this only stops a forced jump (dev shots) from popping the grade.
    this.night += (v.night - this.night) * 0.2;
    if (Math.abs(v.night - this.night) < 0.002) this.night = v.night;
    nightLight.k = this.night;
    const c = this.composite;
    if (!c) return;
    // Someone replaced the world's filters: take the grade back over (theirs stay in front of it).
    const fl = this.world.filters as readonly Filter[] | null | undefined;
    if (!fl?.includes(c)) this.world.filters = [...(fl ?? []).filter(x => x !== this.grade), c];
    if (q !== this.applied) {
      this.applied = q;
      const p = QUALITY_PROFILE[q];
      c.passes = p.passes;
      // The world is drawn into the filter's texture, so smoothing its edges is a switch on the filter, changeable at any time.
      this.msaa = p.msaa;
    }
    // Edge smoothing only where pixels are coarse enough to show jaggies (desktops); on a sharp phone it was pure heat.
    const aa = this.msaa && this.app.renderer.resolution < 1.75 ? 'on' : 'off';
    if (c.antialias !== aa) c.antialias = aa;
    this.applyResolution(this.baseLevel, now);
    this.vignette = VIGNETTE[Math.max(0, Math.min(VIGNETTE.length - 1, v.era))];
    const t = this.world.localTransform;
    // Tell the filter where the screen is, so it does not measure the whole 3000-object world every frame to find out.
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const pad = 16 / t.a;
    (this.area ??= new Rectangle()).set(-t.tx / t.a - pad, -t.ty / t.d - pad, sw / t.a + 2 * pad, sh / t.d + 2 * pad);
    this.world.filterArea = this.area;
    c.setFrame({
      matrix: this.grade?.matrix as ArrayLike<number> | undefined,
      // Film grain is the costly part of the composite: full quality only.
      grain: QUALITY_PROFILE[q].grain ? 0.055 : 0,
      seed: Math.floor(now / 42) % 997,
      vignette: this.vignette,
      night: this.night,
      tone: this.toneFor(v.era),
      // Screen y where the underground starts (night only darkens below the topsoil).
      groundY: t.ty + t.d * (TOPSOIL - 30),
      groundH: Math.max(8, t.d * 40),
      resolution: this.app.renderer.resolution,
    });
  }
}

/** Fullscreen-quad vertex for passes that write a whole texture of a different size than their input. */
const FIT_VERT = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
  vec2 p = aPosition * 2.0 - 1.0;
  p.y *= uOutputTexture.z;
  gl_Position = vec4(p, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;

/** Bright-pass + 4-tap downsample: soft knee, coloured light over white walls, Karis weights against sparkle. */
const EXTRACT_FRAG = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uInputClamp;
uniform vec4 uBright;

vec3 tap(vec2 uv) {
  vec4 c = texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
  vec3 rgb = c.rgb;
  float br = max(rgb.r, max(rgb.g, rgb.b));
  float knee = uBright.y;
  float soft = clamp(br - uBright.x + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 0.0001);
  float k = max(soft, br - uBright.x) / max(br, 0.0001);
  float sat = (br - min(rgb.r, min(rgb.g, rgb.b))) / max(br, 0.0001);
  k *= mix(uBright.z, 1.0, smoothstep(0.06, 0.45, sat));
  return rgb * k;
}

void main(void) {
  vec2 o = uInputSize.zw * 1.5;
  vec3 a = tap(vTextureCoord + vec2(-o.x, -o.y));
  vec3 b = tap(vTextureCoord + vec2(o.x, -o.y));
  vec3 c = tap(vTextureCoord + vec2(-o.x, o.y));
  vec3 d = tap(vTextureCoord + vec2(o.x, o.y));
  vec4 w = 1.0 / (1.0 + vec4(dot(a, vec3(0.333)), dot(b, vec3(0.333)), dot(c, vec3(0.333)), dot(d, vec3(0.333))));
  vec3 sum = (a * w.x + b * w.y + c * w.z + d * w.w) / (w.x + w.y + w.z + w.w);
  finalColor = vec4(sum, 1.0);
}`;

/** One Kawase blur pass: four bilinear taps at (offset + 0.5) texels. */
const KAWASE_FRAG = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uOffset;
void main(void) {
  vec2 o = uInputSize.zw * (uOffset + 0.5);
  vec3 s = texture(uTexture, vTextureCoord + vec2(-o.x, -o.y)).rgb;
  s += texture(uTexture, vTextureCoord + vec2(o.x, -o.y)).rgb;
  s += texture(uTexture, vTextureCoord + vec2(-o.x, o.y)).rgb;
  s += texture(uTexture, vTextureCoord + vec2(o.x, o.y)).rgb;
  finalColor = vec4(s * 0.25, 1.0);
}`;

const COMPOSITE_FRAG = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uBloom;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform float uColorMatrix[20];
uniform vec4 uScreen;
uniform vec4 uLook;
uniform vec4 uNight;
uniform vec4 uTone;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main(void) {
  vec4 src = texture(uTexture, vTextureCoord);
  float a = src.a;
  vec3 c = a > 0.0 ? src.rgb / a : vec3(0.0);
  highp vec2 sp = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
  vec2 uv = sp * uScreen.zw;

  // Light first: bloom adds before the tone curve, so it can glow but never paint a room white.
  c += texture(uBloom, vTextureCoord * uInputSize.xy / uOutputFrame.zw).rgb * uLook.x;

  // Era grade: the renderer's colour matrix.
  vec3 g;
  g.r = uColorMatrix[0] * c.r + uColorMatrix[1] * c.g + uColorMatrix[2] * c.b + uColorMatrix[3] * a + uColorMatrix[4];
  g.g = uColorMatrix[5] * c.r + uColorMatrix[6] * c.g + uColorMatrix[7] * c.b + uColorMatrix[8] * a + uColorMatrix[9];
  g.b = uColorMatrix[10] * c.r + uColorMatrix[11] * c.g + uColorMatrix[12] * c.b + uColorMatrix[13] * a + uColorMatrix[14];
  c = max(g, 0.0);

  // Underground at night: unlit concrete and corridors sink cold, lamp-lit surfaces hold and turn warm.
  float under = smoothstep(uNight.y, uNight.y + uNight.w, sp.y);
  float night = uNight.x * under;
  if (night > 0.001) {
    float l = luma(c);
    // Kept mild so night reads as mood, not as the screen going dark (playtest: "suddenly turns dark").
    // The bunker runs on lamps, not on the sun: night underground is a colour mood only, never a brightness drop
    // (playtests twice: "the bunker turns dark at night"). Shadows cool a touch, lamp-lit areas warm a touch.
    float lit = smoothstep(0.03, 0.28, l);
    vec3 dark = c * vec3(0.96, 0.97, 1.03);
    vec3 warm = c * vec3(1.04, 1.0, 0.92);
    c = mix(c, mix(dark, warm, lit), night);
  }

  // Player brightness: gamma lifts the dark mid-tones (white stays white), the floor keeps shadows from going dead black.
  c = pow(c, vec3(uTone.x)) * (1.0 - uTone.y) + uTone.y;
  // Small exposure lift: the painted rooms are dark by design, the shoulder below keeps the lift from clipping.
  c *= 1.12;
  // Filmic shoulder: highlights roll off (and desaturate a touch) instead of clipping flat.
  vec3 over = max(c - 0.8, 0.0);
  c = min(c, 0.8) + 0.2 * (1.0 - exp(-over * 5.0));
  // Faint split tone: cool shadows, warm highlights.
  float l2 = luma(c);
  c += vec3(-0.010, 0.002, 0.018) * (1.0 - smoothstep(0.0, 0.4, l2)) + vec3(0.016, 0.006, -0.014) * smoothstep(0.55, 1.0, l2);

  // Vignette (elliptical, fitted to the screen).
  vec2 d = (uv - vec2(0.5, 0.53)) * 1.4142;
  float v = smoothstep(uLook.y, 1.15, length(d));
  c *= 1.0 - uLook.z * v * (0.6 + 0.4 * v);

  // Film grain: soft ~1 CSS px grains, strongest in the mid-tones, re-seeded 24 times a second.
  if (uScreen.y > 0.0 && uLook.w > 0.0) {
    vec2 gp = sp * 0.8 + uNight.z * vec2(37.0, 17.0);
    float n = vnoise(gp) + vnoise(gp * 1.9 + 11.0) * 0.6 - 0.8;
    float m = 0.35 + 2.2 * l2 * (1.0 - l2);
    c += n * uLook.w * m;
  }

  c = clamp(c, 0.0, 1.0);
  finalColor = vec4(c * a, a);
}`;

/** The world's one filter: runs the bloom passes into its own small targets, then composites. */
class CompositeFilter extends Filter {
  passes = 4;
  private extract: Filter;
  private kawase: Filter[];
  private rtA: RenderTexture;
  private rtB: RenderTexture;
  private uni: { uScreen: Float32Array; uLook: Float32Array; uNight: Float32Array; uTone: Float32Array; uColorMatrix: Float32Array };

  constructor(screen: [number, number]) {
    const bw = Math.max(8, Math.ceil(screen[0] * BLOOM_SCALE));
    const bh = Math.max(8, Math.ceil(screen[1] * BLOOM_SCALE));
    const rtA = RenderTexture.create({ width: bw, height: bh, resolution: 1 });
    const rtB = RenderTexture.create({ width: bw, height: bh, resolution: 1 });
    const identity = new Float32Array([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: COMPOSITE_FRAG, name: 'bunker-composite' }),
      resources: {
        compositeUniforms: {
          uColorMatrix: { value: identity, type: 'f32', size: 20 },
          uScreen: { value: new Float32Array([screen[0], screen[1], 1 / screen[0], 1 / screen[1]]), type: 'vec4<f32>' },
          // x bloom strength, y vignette start, z vignette strength, w grain
          uLook: { value: new Float32Array([0.85, 0.4, 0.5, 0.05]), type: 'vec4<f32>' },
          // x night, y ground screen-y, z grain seed, w ground ramp height
          uNight: { value: new Float32Array([0, 0, 0, 40]), type: 'vec4<f32>' },
          // x gamma, y floor
          uTone: { value: new Float32Array([1, 0, 0, 0]), type: 'vec4<f32>' },
        },
        uBloom: rtA.source,
      },
    });
    // Pixi filters render at resolution 1 unless told otherwise: the whole world used to be drawn at one pixel per CSS pixel
    // and stretched to the screen, which is what made the game blurry on every phone at every quality level.
    this.resolution = 'inherit';
    this.rtA = rtA;
    this.rtB = rtB;
    const u = this.resources.compositeUniforms.uniforms;
    this.uni = { uScreen: u.uScreen, uLook: u.uLook, uNight: u.uNight, uTone: u.uTone, uColorMatrix: u.uColorMatrix };
    this.extract = new Filter({
      glProgram: GlProgram.from({ vertex: FIT_VERT, fragment: EXTRACT_FRAG, name: 'bunker-bloom-extract' }),
      // x threshold, y knee, z weight of white (uncoloured) light
      resources: { brightUniforms: { uBright: { value: new Float32Array([0.74, 0.2, 0.4, 0]), type: 'vec4<f32>' } } },
    });
    // Separate filters per pass: each keeps its own offset uniform (no re-upload between draws).
    this.kawase = [0, 1, 2, 3].map(i => new Filter({
      glProgram: GlProgram.from({ vertex: FIT_VERT, fragment: KAWASE_FRAG, name: 'bunker-kawase' }),
      resources: { kawaseUniforms: { uOffset: { value: i, type: 'f32' } } },
    }));
  }

  resize(screen: [number, number]): void {
    const bw = Math.max(8, Math.ceil(screen[0] * BLOOM_SCALE));
    const bh = Math.max(8, Math.ceil(screen[1] * BLOOM_SCALE));
    this.rtA.source.resize(bw, bh, 1);
    this.rtB.source.resize(bw, bh, 1);
    this.uni.uScreen.set([screen[0], screen[1], 1 / screen[0], 1 / screen[1]]);
    this.resources.compositeUniforms.update();
  }

  setFrame(f: {
    matrix?: ArrayLike<number>; grain: number; seed: number; vignette: [number, number]; night: number;
    tone: [number, number]; groundY: number; groundH: number; resolution: number;
  }): void {
    const u = this.uni;
    u.uTone[0] = f.tone[0];
    u.uTone[1] = f.tone[1];
    if (f.matrix && f.matrix.length >= 20) for (let i = 0; i < 20; i++) u.uColorMatrix[i] = f.matrix[i];
    u.uLook[0] = this.passes > 0 ? (this.passes >= 4 ? 0.85 : 0.75) : 0;
    u.uLook[1] = f.vignette[0];
    u.uLook[2] = f.vignette[1];
    u.uLook[3] = f.grain;
    u.uNight[0] = f.night;
    u.uNight[1] = f.groundY;
    u.uNight[2] = f.seed;
    u.uNight[3] = f.groundH;
    this.resources.compositeUniforms.update();
  }

  apply(filterManager: FilterSystem, input: Texture, output: RenderSurface, clearMode: boolean): void {
    if (this.passes > 0) {
      filterManager.applyFilter(this.extract, input, this.rtA, true);
      let src = this.rtA;
      let dst = this.rtB;
      // Wider steps when fewer passes, so medium spreads about as far.
      const step = this.passes >= 4 ? 1 : 2;
      for (let i = 0; i < this.passes; i++) {
        filterManager.applyFilter(this.kawase[Math.min(3, i * step)], src, dst, true);
        [src, dst] = [dst, src];
      }
      if (this.resources.uBloom !== src.source) this.resources.uBloom = src.source;
    }
    filterManager.applyFilter(this, input, output, clearMode);
  }
}
