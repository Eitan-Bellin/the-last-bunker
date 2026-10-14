/**
 * Perspective C (real 3D, angled camera) - every tunable value of the prototype lives here.
 * Units: metres, seconds, degrees, linear RGB 0..1 (the shader tone-maps at the end).
 */
export type RGB = [number, number, number];

export interface LightToken {
  id: string;
  pos: [number, number, number];
  color: RGB;
  intensity: number;
  radius: number;
  /** 0 = steady, 1 = fire-like, 2 = failing tube (rare drop-outs). */
  flicker: 0 | 1 | 2;
  /** Draw a soft halo sprite at the lamp. */
  halo: number;
  /** Optional downward light cone (length in metres). */
  cone?: number;
}

export const tokens = {
  render: {
    maxDprDesktop: 1.5,
    maxDprMobile: 1.25,
    antialiasDesktop: true,
    antialiasMobile: false,
    exposure: 1.25,
    saturation: 1.08,
    contrast: 1.04,
    vignette: 0.62,
    grain: 0.03,
    /** Mobile: also cap the drawing buffer at this many megapixels. */
    mobileMaxMegapixels: 0.9,
  },

  camera: {
    fovDeg: 30,
    /** Pitch above the horizon: closer zoom = lower, more cinematic; far zoom = higher, more map-like. */
    pitchNearDeg: 13,
    pitchFarDeg: 23,
    /** Default yaw: the camera sits slightly to the right, so the side walls of every room read as depth. */
    baseYawDeg: -10,
    yawLimitDeg: 25,
    distMin: 9,
    distMax: 135,
    /** Phones start framed to this world width (portrait screens see a narrow slice of a wide section). */
    startSpanMobile: 24,
    /** Desktop starts framed to this world width. */
    startSpanDesktop: 80,
    startTargetDesktop: { x: -3, y: -10 },
    startTargetMobile: { x: 12, y: -9 },
    /** The plane the camera orbits around and that picks hit (just behind the cut face). */
    focusZ: -4,
    bounds: { xMin: -78, xMax: 50, yMin: -30, yMax: 6 },
    wheelZoom: 0.0011,
    zoomSmoothing: 11,
    panFriction: 6.0,
    orbitDegPerPx: 0.22,
    keyYawDegPerSec: 40,
    dragThresholdPx: 6,
  },

  /** Exponential haze for things far beyond the focus plane (the ruined skyline, the far ground). */
  haze: { density: 0.02, color: [0.07, 0.04, 0.035] as RGB, startFactor: 0.9 },

  /** Darkness with depth: ambient goes from `surface` to `deep` between these heights. */
  depth: { darkStartY: -1.5, darkEndY: -20 },

  fow: {
    texelsPerM: 2,
    revealRadius: 8.5,
    revealSoft: 3.2,
    revealSeconds: 1.1,
    hint: 0.3,
    color: [0.026, 0.023, 0.024] as RGB,
    swirl: 0.45,
    edgeColor: [0.75, 0.42, 0.18] as RGB,
    edgeStrength: 0.004,
  },

  light: {
    ambientSurface: [0.13, 0.1, 0.11] as RGB,
    ambientDeep: [0.012, 0.013, 0.02] as RGB,
    /** Faint cool light on the cut face, so the section silhouette always reads. */
    sectionFill: [0.1, 0.095, 0.105] as RGB,
    sunDir: [-0.5, 0.42, 0.75] as [number, number, number],
    sunColor: [0.95, 0.46, 0.26] as RGB,
    skyFill: [0.07, 0.06, 0.08] as RGB,
    specular: 0.35,
    falloffK: 0.06,
    wrap: 0.1,
    haloSize: 1.0,
    haloStrength: 0.5,
    coneStrength: 0.085,
    /** People get a little self-light so they never vanish in the dark (readability). */
    figureLift: 0.05,
  },

  sky: {
    zenith: [0.035, 0.03, 0.05] as RGB,
    horizon: [0.62, 0.27, 0.13] as RGB,
    sunGlow: [1.4, 0.55, 0.22] as RGB,
    skyline: [0.03, 0.025, 0.03] as RGB,
    skylineWindow: [1.0, 0.55, 0.22] as RGB,
    voidColor: [0.008, 0.008, 0.011] as RGB,
  },

  /** Material base colours (linear). */
  palette: {
    strata: [
      { y: 0.5, c: [0.13, 0.1, 0.075] as RGB },
      { y: -1.5, c: [0.11, 0.09, 0.075] as RGB },
      { y: -6, c: [0.12, 0.1, 0.09] as RGB },
      { y: -12, c: [0.095, 0.085, 0.085] as RGB },
      { y: -19, c: [0.085, 0.07, 0.075] as RGB },
      { y: -26, c: [0.06, 0.055, 0.065] as RGB },
    ],
    caveWall: [0.2, 0.17, 0.15] as RGB,
    caveFloor: [0.17, 0.14, 0.11] as RGB,
    concreteCut: [0.26, 0.25, 0.24] as RGB,
    concreteWall: [0.36, 0.33, 0.3] as RGB,
    concreteFloor: [0.23, 0.21, 0.19] as RGB,
    corridorWall: [0.24, 0.29, 0.26] as RGB,
    tile: [0.45, 0.52, 0.5] as RGB,
    ash: [0.13, 0.11, 0.1] as RGB,
    metal: [0.26, 0.24, 0.22] as RGB,
    rust: [0.36, 0.17, 0.08] as RGB,
    safety: [0.75, 0.52, 0.08] as RGB,
    wood: [0.36, 0.23, 0.13] as RGB,
    tin: [0.36, 0.34, 0.31] as RGB,
    tinRed: [0.42, 0.18, 0.12] as RGB,
    tinTeal: [0.17, 0.3, 0.3] as RGB,
    cloth: [0.52, 0.16, 0.08] as RGB,
    plant: [0.12, 0.3, 0.08] as RGB,
    window: [2.6, 1.45, 0.6] as RGB,
    forge: [4.0, 1.4, 0.3] as RGB,
    crystalA: [0.25, 1.3, 1.6] as RGB,
    crystalB: [1.1, 0.35, 1.6] as RGB,
    metroGlow: [0.2, 0.9, 0.8] as RGB,
  },

  lights: [
    { id: 'fire', pos: [43.5, 1.1, -9.5], color: [1.0, 0.45, 0.15], intensity: 3.2, radius: 11, flicker: 1, halo: 1.3 },
    { id: 'hatch', pos: [39, 3.0, -4], color: [1.0, 0.25, 0.12], intensity: 1.6, radius: 7, flicker: 0, halo: 0.6 },
    { id: 'ramp', pos: [28.5, -1.25, -3.5], color: [1.0, 0.72, 0.45], intensity: 2.2, radius: 9, flicker: 2, halo: 0.7, cone: 3.4 },
    { id: 'chandelier', pos: [14, -3.6, -6], color: [1.0, 0.74, 0.46], intensity: 6.5, radius: 19, flicker: 0, halo: 1.8, cone: 12 },
    { id: 'l1lamp', pos: [6, -8.0, -11.3], color: [1.0, 0.62, 0.36], intensity: 2.2, radius: 8, flicker: 0, halo: 0.6 },
    { id: 'generator', pos: [19.5, -14.2, -8.8], color: [0.45, 1.0, 0.55], intensity: 1.4, radius: 6, flicker: 0, halo: 0.5 },
    { id: 'corr1', pos: [-2, -12.6, -3], color: [1.0, 0.8, 0.55], intensity: 2.4, radius: 8, flicker: 0, halo: 0.6, cone: 3.2 },
    { id: 'corr2', pos: [-10, -12.6, -3], color: [0.75, 0.85, 1.0], intensity: 1.8, radius: 7.5, flicker: 2, halo: 0.6, cone: 3.2 },
    { id: 'shack1', pos: [-18, -14.3, -4.4], color: [1.0, 0.6, 0.3], intensity: 1.7, radius: 6, flicker: 0, halo: 0.5 },
    { id: 'forge', pos: [-23.5, -14.6, -9], color: [1.0, 0.42, 0.12], intensity: 4.2, radius: 10, flicker: 1, halo: 1.1 },
    { id: 'platform', pos: [-35, -8.6, -10], color: [1.0, 0.7, 0.42], intensity: 2.6, radius: 10, flicker: 0, halo: 0.8, cone: 3.5 },
    { id: 'lookout', pos: [-17.5, -8.8, -12.6], color: [0.7, 0.85, 1.0], intensity: 2.2, radius: 10, flicker: 0, halo: 0.7, cone: 3 },
    { id: 'garden', pos: [-30, -13.6, -1.6], color: [1.0, 0.35, 0.85], intensity: 1.8, radius: 6, flicker: 0, halo: 0.6 },
    { id: 'metro', pos: [-62, -13.4, -4], color: [0.2, 1.0, 0.85], intensity: 2.4, radius: 13, flicker: 2, halo: 0.9 },
    { id: 'crystal', pos: [-26, -24.2, -4], color: [0.35, 0.9, 1.0], intensity: 2.8, radius: 9, flicker: 0, halo: 0.8 },
    { id: 'shack3', pos: [-37.5, -14.3, -3.9], color: [1.0, 0.62, 0.32], intensity: 1.5, radius: 6, flicker: 0, halo: 0 },
    { id: 'dig', pos: [-47.75, -15.2, -1.5], color: [1.0, 0.6, 0.3], intensity: 1.9, radius: 6.5, flicker: 1, halo: 0 },
    { id: 'crack', pos: [-53.2, -12.7, -3], color: [0.25, 0.95, 0.85], intensity: 1.6, radius: 6.5, flicker: 0, halo: 0.55 },
  ] as LightToken[],

  /** The lantern a survivor carries (the 16th light). */
  lantern: { color: [1.0, 0.66, 0.34] as RGB, intensity: 1.7, radius: 6, halo: 0.45 },

  people: {
    count: 8,
    speed: 1.3,
    stairSpeedFactor: 0.75,
    pauseMin: 1.5,
    pauseMax: 6,
    stride: 7.5,
    outfits: [
      [0.27, 0.29, 0.17], [0.42, 0.2, 0.1], [0.15, 0.2, 0.3], [0.33, 0.31, 0.28],
      [0.45, 0.36, 0.16], [0.2, 0.26, 0.25], [0.5, 0.48, 0.42], [0.3, 0.13, 0.12],
    ] as RGB[],
    trousers: [[0.1, 0.1, 0.11], [0.2, 0.17, 0.12], [0.13, 0.15, 0.2], [0.24, 0.22, 0.18]] as RGB[],
    skins: [[0.6, 0.42, 0.3], [0.45, 0.3, 0.2], [0.72, 0.53, 0.4], [0.3, 0.2, 0.14]] as RGB[],
  },

  detail: {
    /** Random rock jitter on natural caves (metres). Built rooms stay crisp. */
    caveJitter: 0.42,
    rubblePieces: 70,
    surfaceRubble: 60,
    dust: 240,
    ash: 260,
    sparks: 40,
    stringBulbs: 18,
    /** Multiplier for all particle counts on phones. */
    mobileParticles: 0.5,
  },

  labels: [
    { text: 'פתח הכניסה', pos: [37, 4.6, -4] },
    { text: 'האטריום', pos: [14, -1.2, -6] },
    { text: 'מסדרון השירות', pos: [-5, -11.2, -3] },
    { text: 'רובע המגורים', pos: [-28, -6.4, -7] },
    { text: 'המנהרה החסומה', pos: [-50, -11.4, -3] },
    { text: 'רציף המטרו הישן', pos: [-67, -10.4, -4] },
    { text: 'מערת הגבישים', pos: [-26, -20.6, -4] },
  ] as { text: string; pos: [number, number, number] }[],
};
