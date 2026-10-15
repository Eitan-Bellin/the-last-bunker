/**
 * Prototype B (isometric 2:1 dimetric) - every tunable value lives here.
 * Units: "u" = one tile side in world space (x, y on the floor plane, z up). One storey = `storey` u.
 */
export const T = {
  /** Projection: a tile is `w` px wide and w/2 px tall; one vertical unit is `zUnit` px (cos 30 deg of the tile side). */
  tile: { w: 64, zUnit: 39.2 },
  /** Height of one level (storey) in u. */
  storey: 2.2,
  /** Height in u of each decorative stratum band below level 3 (mines, deep caves, core). */
  deepBand: 1.55,
  map: { nx: 46, ny: 28 },
  /** Painter's sort: key = x + y + zFactor * z (true camera depth for a 30 deg elevation); static geometry is chunked per `bucket` of key. */
  depth: { zFactor: 0.816, bucket: 0.5 },
  /** Automatic cutaway: rock in front of an open cell is lowered so a person standing there stays visible. */
  cut: { stub: 0.42, personH: 1.0, jitter: 0.22, quant: 0.06 },
  /** Face shading (multipliers of the base colour) and edge accents. */
  shade: {
    top: 1.0, left: 0.76, right: 0.54,
    rimColor: 0xf3dfb8, rimAlpha: 0.2, rimWidth: 1.1,
    aoAlpha: 0.42, aoHeight: 0.45,
    seamAlpha: 0.22,
  },
  /** Multiplies the number of procedural details (speckles, cracks, veins, crystals, debris). 0 = flat shapes. */
  detail: { density: Number(new URLSearchParams(location.search).get("detail") ?? 1) },
  color: {
    bgTop: 0x0b101c, bgBottom: 0x020305, coreGlowBg: 0x2a0d06,
    /** Strata 0..6: surface soil, upper shelter, service network, old metro, mines, deep caves, core. */
    strata: [0x6e5843, 0x7d705d, 0x606670, 0x48526a, 0x54412f, 0x352c47, 0x2b1411],
    strataSpeck: [0x9a8066, 0xa89a82, 0x8a929e, 0x6c7894, 0x7a5f44, 0x5a4a78, 0x5a2016],
    soil: 0x4e3626, ground: 0x6f665b, groundAlt: 0x5e5a52, deadGrass: 0x8b8452, ash: 0x9a948a,
    cutTop: [0x5c5148, 0x5f574c, 0x515760, 0x3f4659, 0x463729, 0x2e2740, 0x24110e],
    concrete: 0x7a766f, concreteDark: 0x625e58, grating: 0x5f656c, gratingLine: 0x3b3f45,
    metroTile: 0xbcb59c, metroGrout: 0x7f7a68, metroTrim: 0x2f6b5c, metroFloor: 0x4e5158,
    earth: 0x5e4b39, plank: 0x7f5e3d, rail: 0x9aa1aa, sleeper: 0x4a3a2c,
    rust: 0x8c4c2b, steel: 0x6f7884, steelDark: 0x454b54, hazardY: 0xd1a62b, hazardK: 0x1c1c1e,
    cave: 0x3b3150, crystal: 0x7af2ff, timber: 0x6b4c2e,
    railing: 0xa3a9b0, rope: 0x2a2622,
    sandbag: 0x8a7d5e, tarp: [0x9c3b2e, 0x2f6f73, 0x37507a, 0x7b6a2c],
    dwellings: [0x8d5b3b, 0x3f716b, 0x6b7079, 0x7d714a, 0x4b6b3f, 0x6c3c33],
    label: 0xeadfc6, labelDim: 0xa99f8a, strataLabel: 0xc8b89a,
  },
  /** Lighting: a multiply lightmap (darkness) plus additive glows on top. */
  light: {
    ambient: 0x2c3347,
    /** Lightmap render-texture resolution relative to the screen (0.5 = quarter the pixels). */
    mapScale: 0.5,
    poolGain: 1.0,
    /** Round "volume" light around the source so walls and people near a lamp are lit, not only the floor. */
    volGain: 0.6, volScale: 0.75,
    glowGain: 1.0, hazeGain: 0.32,
    flicker: 1.0,
    lamp: 0xffb562, sodium: 0xff9a3c, fire: 0xff7a2a, cool: 0xcfe6ff, moon: 0x7f95c8, sky: 0x8fa6dc,
    tv: 0x6fb2ff, grow: 0xd27aff, forge: 0xff5a1e, emergency: 0xff3326, lantern: 0xffd27a, crystal: 0x50e4ff,
    core: 0xff3a10,
  },
  fog: {
    color: 0x151b27, alpha: 0.78, blobCells: 3.3, drift: 0.22, driftSpeed: 0.12,
    /** A tap reveals fog cells whose screen centre is within this many screen px, plus this many cells around them. */
    tapRadiusPx: 64, revealCells: 2.3, fadeSeconds: 0.9,
    /** Faint light seen through the fog (the lantern past the rubble). */
    teaseAlpha: 0.32,
  },
  camera: {
    minZoom: 0.28, maxZoom: 2.6, wheelStep: 0.0016, dragThreshold: 6,
    friction: 5.5, maxFling: 2600, zoomEase: 14,
    startDesktop: { zoom: 0.62, x: 20, y: 11, z: -4.2 },
    startMobile: { zoom: 0.4, x: 13, y: 12, z: -4.4 },
  },
  people: {
    count: 8, walkSpeed: 1.55, stairSpeed: 1.0, idleMin: 1.5, idleMax: 6,
    height: 0.95, headlampEvery: 4, stepRate: 7.5,
    outfits: [0x8a6b4a, 0x52677a, 0x7d4b3a, 0x4f6a4a, 0x9c8a66, 0x6a5a7c, 0x3f5560, 0xa0703a],
    skins: [0xe0b08a, 0xc68e64, 0x9a6a48, 0xf0c8a4, 0x7a5236],
    hair: [0x2a1e16, 0x5a3a22, 0x111111, 0x8a8478, 0x6a4a2a],
  },
  particles: { embers: 22, sparks: 16, dust: 34, ash: 46, steam: 10 },
  vignette: { alpha: 0.72, inner: 0.42 },
  labels: { size: 15, minScale: 0.7, maxScale: 1.25 },
} as const;
