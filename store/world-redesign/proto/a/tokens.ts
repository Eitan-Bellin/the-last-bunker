/**
 * Prototype A — "The City Below" as a deep 2.5D side cross-section.
 * EVERY tunable value of the prototype lives in this one object.
 * Colours are 0xRRGGBB, distances are world units (1 unit = 1 px at zoom 1).
 */
export const T = {
  seed: 7,

  world: {
    width: 3400,
    height: 1500,
    groundY: 320,          // the surface line
    rockRes: 0.6,          // resolution of the baked rock painting (fraction of world size)
  },

  /** Depth layers, back to front. p = parallax factor (1 = play plane). */
  layers: {
    sky:   { p: 0.15, fog: 0.0 },
    far:   { p: 0.40, fog: 0.72 },
    back:  { p: 0.68, fog: 0.48 },
    mid:   { p: 0.88, fog: 0.12 },
    play:  { p: 1.00, fog: 0.0 },
    fore:  { p: 1.32, fog: 0.0 },
    /** how much zoom affects a layer: layerScale = zoom ^ (p * zoomCoupling) */
    zoomCoupling: 1.0,
  },

  camera: {
    start: { x: 1640, y: 780 },
    startViewW: { desktop: 2300, phone: 900 },  // world width visible at start
    zoomMin: 0.32,
    zoomMax: 2.4,
    wheelStep: 0.0016,       // zoom per wheel delta unit (exponential)
    zoomEase: 14,            // how fast zoom follows its target (1/s)
    friction: 4.5,           // fling decay (1/s)
    maxFling: 4200,          // px/s
    dragThreshold: 6,        // screen px before a press becomes a drag
    tapMs: 320,
    margin: 140,             // how far past the world edge the camera may look
  },

  render: {
    maxDpr: { desktop: 1.5, phone: 1.25 },
    lightScale: 0.5,         // lightmap resolution relative to the screen
    lightScalePhone: 0.35,
    phoneDensity: 0.6,       // detail.density on phones
    phoneGrain: false,
    fogCell: 8,              // world units per fog-of-war texel
    antialias: false,
  },

  palette: {
    clear: 0x05060a,
    // sky
    skyTop: 0x2a1c18,
    skyMid: 0x8a4a22,
    skyHorizon: 0xd88a44,
    // rock strata (top → bottom) — the cut face of the earth
    soil: 0x4a3426,
    soilDark: 0x2c1f17,
    clay: 0x5e4a38,
    gravel: 0x55524c,
    sandstone: 0x6e5a40,
    slate: 0x34373e,
    slateDeep: 0x1f2228,
    rockRim: 0x9a8a72,       // light lip where the cut meets a cavity
    rockAO: 0x000000,
    // architecture
    concrete: 0x524e48,
    concreteDark: 0x45433f,
    concreteLight: 0x8f8a80,
    panel: 0x5a5e58,
    brass: 0xb08a4a,
    rust: 0x7a4a2c,
    steel: 0x5b636b,
    steelDark: 0x2e3439,
    wood: 0x6a4a30,
    tileGreen: 0x5d6b58,
    tileCream: 0x8d8670,
    hazard: 0xc89a2a,
    cloth: [0x7a3b2e, 0x3c5a6e, 0x8a7a3a, 0x5e6e4a, 0x6e4a6a, 0x9a6a3a],
    // people
    skin: [0xc49a7a, 0x9a6e52, 0x6e4a36, 0xd8b090],
    coat: [0x4a4f44, 0x5a4636, 0x3e4a56, 0x6a5a40, 0x55413c, 0x404548, 0x6b6250, 0x3d4a3e],
    // far depth
    farBase: 0x0c0f16,
    farHaze: 0x2a3446,
    backBase: 0x11141b,
    backHaze: 0x3a3a40,
    fogColor: 0x1a2130,       // the colour layers fade toward with depth
    fogOfWar: 0x030406,
    foreground: 0x040507,
    foreRim: 0x2a3444,
  },

  light: {
    /** ambient (lightmap clear colour) — what unlit rock looks like */
    ambient: 0x2b303c,
    /** vertical ambient ramp in world Y → colour (added on top of ambient) */
    ambientRamp: [
      { y: 0,    c: 0xffd2a0, a: 1.0 },
      { y: 300,  c: 0xd09068, a: 0.95 },
      { y: 420,  c: 0x4a3a30, a: 0.35 },
      { y: 700,  c: 0x1a1a20, a: 0.3 },
      { y: 1500, c: 0x000000, a: 0.0 },
    ],
    falloff: 2.2,            // light texture exponent (higher = tighter core)
    intensity: 1.0,          // global multiplier for all point lights
    glow: 0.55,              // additive halo strength on top of the lit scene
    flickerSpeed: 9,
    roomArtLightScale: 1.6,  // meta.json light radii → world radius multiplier
    roomAmbient: 0x40382f,   // fill light inside dwellings (keeps painted art readable)
    zoneAmbient: {
      hub: { c: 0x2a221c, a: 1 },
      corridor: { c: 0x1e2a26, a: 1 },
      district: { c: 0x3c3026, a: 1 },
      edge: { c: 0x0c1018, a: 1 },
    },
    colors: {
      warm: 0xffb066,
      amber: 0xffc27a,
      tungsten: 0xffd8a0,
      fire: 0xff7a2a,
      fluoro: 0xc8f0e0,
      cold: 0x6aa8ff,
      emergency: 0xff3a2a,
      bio: 0x4affc8,
      sky: 0xffb070,
      lantern: 0xffcc80,
    },
  },

  fog: {
    density: 0.92,           // alpha of unexplored darkness
    edgeBreath: 0.25,        // alpha of the soft breathing halo around the fog edge
    breathSpeed: 0.6,
    revealRadius: 190,       // world units revealed by a click
    revealTime: 0.9,         // seconds for a reveal to expand
    noiseAlpha: 0.5,         // mottling inside the fog
  },

  atmosphere: {
    dustCount: 140,
    dustAlpha: 0.35,
    sparkCount: 26,
    layerHaze: 0.22,         // alpha of the screen haze drawn between depth layers
    vignette: 0.62,
    grain: 0.05,
    cones: 0.16,             // light shaft alpha
    godRay: 0.32,            // sky light pouring down the entrance ramp
  },

  detail: {
    density: 1.0,            // 0.5 = phone-lite, 1 = full
    farStructures: 26,
    backStructures: 34,
    farLights: 140,
    backWindows: 120,
    rubble: 70,
    stalactites: 40,
    foreItems: 26,
  },

  people: {
    count: 9,
    height: 46,
    speed: 46,               // world units per second on flat ground
    stairSpeed: 0.62,        // multiplier on stairs/ramps
    idleMin: 1.5,
    idleMax: 6,
    stepHz: 2.1,
    lanternCarriers: 2,
  },
} as const;

export type Tokens = typeof T;
