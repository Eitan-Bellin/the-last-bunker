/**
 * City render lab: mounts CityRenderer on a fake CityLayout (surface, hub, vestibule, living district cavern, dark edge, dig face,
 * a hidden pocket and a hidden stratum-2 cavern) with painted rooms from public/art/rooms and walking dummy people, so the lighting,
 * fog, parallax and tiers can be tuned without the game.
 *
 * Open: http://localhost:5176/tools/world/render-lab.html  (?tier=high|medium|low|lite  &w=1600&h=900  &nest=0  &uv=area)
 * Console: window.__lab (stats(), goto(x, y, z), setTier(t), bench(frames), shot names).
 * worldContainer carries a ColorMatrixFilter like PostFX's composite, so the LightmapFilter runs NESTED, as it will in the game.
 */
import { Application, Assets, ColorMatrixFilter, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { CityRenderer, parallaxFromWorld, type ParallaxInfo, type RoomLightInput, type FloorRect } from '../../src/world/render/CityRenderer';
import type { CityArea, CityLayout, Cavity } from '../../src/world/render/layoutTypes';
import { LIGHT, STRATA, UNIFY, PEOPLE, type StratumId } from '../../src/world/tokens';
import type { RenderTier } from '../../src/world/tokensRender';
import type { PresetName } from '../../src/world/render/lighting';

const q = new URLSearchParams(location.search);
const FLOOR_H = 144, ROOM_H = 100, SLOT = 46;
const top = (f: number): number => f * FLOOR_H;
const bottom = (f: number): number => top(f) + ROOM_H;
const GROUND = -90;

// ------------------------------------------------------------------------------------------------------------------ fake layout

const rect = (x0: number, y0: number, x1: number, y1: number): number[] => [x0, y0, x1, y0, x1, y1, x0, y1];

const cavities: Cavity[] = [
  { id: 'c:hub', s: 1, back: 'hub', poly: [-170, 400, -170, 20, -120, -20, -40, -44, 30, -50, 100, -44, 180, -20, 230, 20, 230, 400] },
  { id: 'c:west', s: 1, back: 'concrete', poly: rect(-820, -6, -170, 250) },
  { id: 'c:vest', s: 1, back: 'tile', poly: rect(230, -6, 300, 394) },
  { id: 'c:district', s: 1, back: 'none', poly: [300, -6, 380, -40, 560, -62, 760, -52, 940, -32, 1012, 0, 1024, 200, 1012, 400, 300, 400] },
  { id: 'c:edge', s: 1, back: 'rock', poly: [1010, 290, 1120, 284, 1250, 296, 1262, 340, 1250, 394, 1010, 394] },
  { id: 'c:dig', s: 1, back: 'rock', poly: rect(-300, 432, 700, 520) },
  { id: 'c:pocket', s: 2, back: 'rock', poly: [380, 660, 460, 610, 600, 600, 700, 640, 720, 720, 620, 760, 460, 750, 390, 720] },
  { id: 'c:deep', s: 2, back: 'none', poly: [-700, 700, -500, 650, -200, 640, 60, 660, 100, 820, 40, 1000, -400, 1010, -690, 960] },
];

/** The union outline of the joined stratum-1 cavities (west storeys, hub, vestibule, district, edge tunnel). */
const S1_HOLE = [
  -820, -6, -170, -6, -120, -20, -40, -44, 30, -50, 100, -44, 180, -20, 230, -6, 300, -6, 380, -40, 560, -62, 760, -52, 940, -32,
  1012, 0, 1024, 200, 1012, 286, 1120, 284, 1250, 296, 1262, 340, 1250, 394, 1012, 394, 1012, 400, -170, 400, -170, 250, -820, 250,
];

const areas: CityArea[] = [
  { id: 'surface', kind: 'surface', s: 0, state: 'revealed', poly: rect(-1400, -700, 1800, GROUND) },
  { id: 'f:0', kind: 'storey', s: 1, state: 'revealed', poly: rect(-820, -50, 300, 120) },
  { id: 'f:1', kind: 'storey', s: 1, state: 'revealed', poly: rect(-820, 120, 300, 264) },
  { id: 'f:2', kind: 'storey', s: 1, state: 'revealed', poly: rect(-820, 264, 300, 410) },
  { id: 'd:living', kind: 'district', s: 1, state: 'revealed', poly: cavities[3].poly },
  { id: 'e:2:e', kind: 'edge', s: 1, state: 'glimpsed', poly: [1012, 280, 1300, 270, 1310, 410, 1012, 410] },
  { id: 'f:3', kind: 'storey', s: 1, state: 'glimpsed', poly: rect(-320, 420, 720, 540) },
  { id: 'p:2:cave', kind: 'pocket', s: 2, state: 'hidden', poly: [360, 650, 460, 590, 610, 580, 720, 630, 750, 730, 620, 780, 450, 770, 370, 730] },
  { id: 'f:4', kind: 'storey', s: 2, state: 'hidden', poly: [-720, 690, -500, 630, -200, 620, 80, 640, 120, 820, 60, 1020, -400, 1030, -710, 980] },
];

const layout: CityLayout = {
  sig: 'lab-1',
  frames: [{ s: 1, hubL: -170, hubR: 230, vestW: 0, vestE: 70, tunnel: 18 }],
  hubs: [{
    s: 1, floors: [0, 1, 2], rect: { x: -170, y: -50, w: 400, h: 450 }, vault: [-170, 20, 30, -50, 230, 20],
    balconies: [{ floor: 1, side: 'w', x0: -170, x1: 0, y: bottom(1) }, { floor: 1, side: 'e', x0: 58, x1: 230, y: bottom(1) }],
    stairs: [{ side: 'w', x: -120, top: bottom(0), bottom: bottom(2) }, { side: 'e', x: 190, top: bottom(0), bottom: bottom(2) }],
    bridge: { floor: 0, x0: -170, x1: 230, y: bottom(0) },
  }],
  cavities,
  areas,
  edges: [{ id: 'e:2:e', floor: 2, side: 'e', x: 1200, y: bottom(2), block: 'act', progress: 0 }],
  bounds: { x: -1400, y: -700, w: 3200, h: 2000 },
  strata: [{ s: 0, y0: -700, y1: GROUND }, { s: 1, y0: GROUND, y1: 576 }, { s: 2, y0: 576, y1: 1300 }],
};

// ------------------------------------------------------------------------------------------------------------------ rooms

interface LabRoom { id: string; art: string | null; f: number; slot: number; slots: number; state: RoomLightInput['state']; x0?: number }
const ROOMS: LabRoom[] = [
  { id: 'r1', art: 'quarters-1', f: 0, slot: 0, slots: 3, state: 'working', x0: 310 },
  { id: 'r2', art: 'canteen-1', f: 0, slot: 3, slots: 3, state: 'working', x0: 310 },
  { id: 'r3', art: 'medbay-1', f: 0, slot: 6, slots: 3, state: 'idle', x0: 310 },
  { id: 'r4', art: 'waterPump-1', f: 1, slot: 0, slots: 3, state: 'working', x0: 310 },
  { id: 'r5', art: 'farm-1', f: 1, slot: 3, slots: 3, state: 'working', x0: 310 },
  { id: 'r6', art: null, f: 1, slot: 6, slots: 3, state: 'ruin', x0: 310 },
  { id: 'r7', art: 'generator-1', f: 2, slot: 0, slots: 3, state: 'working', x0: 310 },
  { id: 'r8', art: 'workshop-1', f: 2, slot: 3, slots: 3, state: 'building', x0: 310 },
  { id: 'r9', art: 'laboratory-1', f: 2, slot: 6, slots: 3, state: 'unpowered', x0: 310 },
  { id: 'w1', art: 'storage-1', f: 0, slot: 0, slots: 3, state: 'working', x0: -800 },
  { id: 'w2', art: 'armory-1', f: 0, slot: 3, slots: 3, state: 'idle', x0: -800 },
  { id: 'w3', art: 'hydroponics-1', f: 1, slot: 0, slots: 3, state: 'working', x0: -800 },
  { id: 'w4', art: 'trainingRoom-1', f: 1, slot: 3, slots: 3, state: 'working', x0: -800 },
];
const roomRect = (r: LabRoom): { x: number; y: number; w: number; h: number } => ({ x: (r.x0 ?? 0) + r.slot * SLOT, y: top(r.f), w: r.slots * SLOT, h: ROOM_H });

// ------------------------------------------------------------------------------------------------------------------ boot

async function boot(): Promise<void> {
  const W = +(q.get('w') ?? 0) || undefined, H = +(q.get('h') ?? 0) || undefined;
  const app = new Application();
  await app.init({
    ...(W && H ? { width: W, height: H } : { resizeTo: window }),
    background: 0x07080a, antialias: false, autoDensity: true, preference: 'webgl',
    resolution: Math.min(2, +(q.get('dpr') ?? devicePixelRatio) || 1),
  });
  document.getElementById('stage')!.appendChild(app.canvas);
  const renderer = app.renderer;
  const tier0 = (q.get('tier') as RenderTier) || 'medium';
  const city = new CityRenderer({ renderer, tier: tier0, canvas: app.canvas, uvMode: q.get('uv') === 'area' ? 'area' : 'global' });
  const wc = new Container();
  wc.label = 'world';
  app.stage.addChild(wc);
  const grade = new ColorMatrixFilter({ resolution: 'inherit' });
  grade.brightness(1.04, false);
  let nest = q.get('nest') !== '0';
  wc.filters = nest ? [grade] : [];

  // Sky (the surface renderer's job in the game): a plain gradient above ground, outside the lit group.
  const sky = new Graphics();
  const S0 = STRATA[0].palette;
  for (let i = 0; i < 24; i++) {
    const t = i / 23;
    const y0 = -1600 + ((GROUND + 1600) * i) / 24;
    sky.rect(-3000, y0, 8000, (GROUND + 1600) / 24 + 0.5).fill(lerpHex(0x1a1216, S0.accent, t * t));
  }
  city.mount(wc);
  wc.addChildAt(sky, wc.getChildIndex(city.litGroup));

  // ---------------- play plane: cavity backs, rooms, rock with the cavities cut, structure, people
  const play = city.playLayer;
  const backs = new Graphics();
  for (const c of cavities) {
    if (c.back === 'none') continue;
    const P = STRATA[c.s].palette;
    const col = c.back === 'hub' ? P.built : c.back === 'tile' ? P.secondary : c.back === 'concrete' ? P.builtDark : P.rockDark;
    backs.poly(c.poly).fill(col);
  }
  // hub back: panels and pilasters; vestibule: tiles
  for (let x = -160; x < 230; x += 40) backs.rect(x, -10, 4, 410).fill({ color: STRATA[1].palette.builtDark, alpha: 0.5 });
  for (let y = 0; y < 394; y += 12) backs.rect(230, y, 70, 1).fill({ color: 0x000000, alpha: 0.25 });
  play.addChild(backs);

  const meta: Record<string, { lights?: { x: number; y: number; r: number; color: number; flicker: number }[] }> =
    await fetch('/art/meta.json').then(r => r.json()).catch(() => ({}));
  const roomInputs: RoomLightInput[] = [];
  const roomLayer = new Container();
  play.addChild(roomLayer);
  for (const r of ROOMS) {
    const rr = roomRect(r);
    if (r.art) {
      const tex: Texture = await Assets.load(`/art/rooms/${r.art}.webp`);
      const s = new Sprite(tex);
      s.position.set(rr.x, rr.y);
      s.width = rr.w;
      s.height = rr.h;
      if (r.state === 'building') s.alpha = 0.55;
      roomLayer.addChild(s);
    } else {
      const g = new Graphics();
      g.rect(rr.x, rr.y, rr.w, rr.h).fill(0x3a3430);
      for (let i = 0; i < 9; i++) g.poly([rr.x + i * 15, rr.y + rr.h, rr.x + i * 15 + 10, rr.y + rr.h - 20 - (i % 3) * 10, rr.x + i * 15 + 22, rr.y + rr.h]).fill(0x24201c);
      roomLayer.addChild(g);
    }
    // the alcove lip + outline (UNIFY.roomFrame / outline)
    const fr = new Graphics();
    fr.rect(rr.x, rr.y, rr.w, rr.h).stroke({ width: UNIFY.roomFrame.lip, color: UNIFY.roomFrame.lipColor });
    fr.rect(rr.x - 2, rr.y - 2, rr.w + 4, rr.h + 4).stroke({ width: UNIFY.outline.width, color: UNIFY.outline.color, alpha: UNIFY.outline.alpha });
    roomLayer.addChild(fr);
    roomInputs.push({ ...rr, id: r.id, state: r.state, lamps: r.art ? meta[`rooms/${r.art}`]?.lights : undefined, area: r.x0! > 0 ? 'd:living' : `f:${r.f}` });
  }
  const walk: FloorRect[] = [0, 1, 2].map(f => ({ x: -170, y: bottom(f) - PEOPLE.adultHeight, w: 470, h: PEOPLE.adultHeight, value: LIGHT.read.walkway }));
  city.setRooms(roomInputs, walk);

  // Rock: one band per stratum below ground, with the cavities cut, plus strata streaks so the light has something to show.
  // (Earcut breaks on holes that touch, so the adjoining stratum-1 cavities are cut as one outline.)
  const rock = new Graphics();
  const B = layout.bounds;
  rock.rect(B.x, GROUND, B.w, 576 - GROUND).fill(STRATA[1].palette.rock);
  rock.poly(S1_HOLE).cut();
  rock.poly(cavities[5].poly).cut();
  rock.rect(B.x, 576, B.w, B.y + B.h - 576).fill(STRATA[2].palette.rock);
  rock.poly(cavities[6].poly).cut();
  rock.poly(cavities[7].poly).cut();
  const streaks = new Graphics();
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    const x = layout.bounds.x + rnd() * layout.bounds.w, y = GROUND + rnd() * 1380;
    const s = y < 576 ? 1 : 2;
    const P = STRATA[s as StratumId].palette;
    if (cavities.some(c => c.s === s && inPoly(c.poly, x, y))) continue;
    streaks.ellipse(x, y, 10 + rnd() * 60, 2 + rnd() * 5).fill({ color: rnd() < 0.5 ? P.rockDark : P.rockRim, alpha: 0.25 + rnd() * 0.3 });
  }
  const rim = new Graphics();
  for (const c of cavities) rim.poly(c.poly).stroke({ width: UNIFY.cutEdge.rimWidth, color: STRATA[c.s].palette.rockRim, alpha: UNIFY.cutEdge.rimAlpha });
  play.addChild(rock, streaks, rim);

  // Structure: slabs under each storey, hub balconies, rails, the spine, edge rubble.
  const st = new Graphics();
  const P1 = STRATA[1].palette;
  for (const f of [0, 1, 2]) {
    st.rect(-820, bottom(f), 1840, 8).fill(P1.builtDark);
    st.rect(-820, bottom(f), 1840, 1.5).fill(P1.rockRim);
  }
  for (const f of [0, 1, 2]) for (let x = -170; x < 300; x += 14) st.rect(x, bottom(f) - 22, 1.5, 22).fill(P1.metal);
  st.rect(0, -60, 58, 470).fill({ color: 0x1c1a18, alpha: 0.85 });
  st.rect(26, -60, 6, 470).fill(P1.metal);
  st.poly([1180, 394, 1196, 330, 1220, 312, 1250, 300, 1262, 394]).fill(0x2a241e);
  for (let i = 0; i < 3; i++) st.moveTo(1150, 320 + i * 22).lineTo(1186, 330 + i * 20).stroke({ width: 2.5, color: P1.hazard });
  play.addChild(st);

  // People: walking capsules (tinted outfits), two with lanterns.
  const peopleLayer = new Container();
  play.addChild(peopleLayer);
  interface Walker { c: Container; x: number; y: number; x0: number; x1: number; v: number; light: number }
  const walkers: Walker[] = [];
  const outfits = [0x6b5a44, 0x4f5d4a, 0x5a4a5e, 0x6a4a3a, 0x48566a, 0x5e5a40];
  const lanes = [[-780, 280, 0], [-780, 280, 1], [-160, 1000, 0], [-160, 1000, 1], [-160, 1000, 2], [310, 1000, 2], [-160, 300, 0], [320, 980, 0], [320, 980, 1], [-780, 200, 0], [1040, 1170, 2], [-150, 220, 2]];
  for (let i = 0; i < lanes.length; i++) {
    const [x0, x1, f] = lanes[i];
    const c = new Container();
    const g = new Graphics();
    const sc = i % 5 === 4 ? PEOPLE.childScale : 1;
    const h = PEOPLE.adultHeight * sc;
    g.ellipse(0, 0, 9 * UNIFY.contactShadow.widthMul, UNIFY.contactShadow.height / 2).fill({ color: UNIFY.contactShadow.color, alpha: UNIFY.contactShadow.alpha });
    g.roundRect(-5, -h * 0.45, 4, h * 0.45, 2).fill(0x2a2622).roundRect(1, -h * 0.45, 4, h * 0.45, 2).fill(0x2a2622);
    g.roundRect(-7, -h * 0.82, 14, h * 0.42, 4).fill(outfits[i % outfits.length]);
    g.circle(0, -h * 0.9, h * 0.1).fill(0xc8a080);
    c.addChild(g);
    peopleLayer.addChild(c);
    const w: Walker = { c, x: x0 + ((x1 - x0) * ((i * 37) % 100)) / 100, y: bottom(f), x0, x1, v: (24 + (i * 7) % 20) * (i % 2 ? 1 : -1), light: 0 };
    if (i === 3 || i === 10) w.light = city.addLight({ x: w.x, y: w.y - 30, preset: 'lantern', kind: 'carried', dynamic: true });
    walkers.push(w);
  }

  // ---------------- lights that are not room lamps
  const L = (x: number, y: number, preset: PresetName, extra: Partial<Parameters<typeof city.addLight>[0]> = {}): number => city.addLight({ x, y, preset, kind: 'shell', ...extra });
  L(30, 10, 'chandelier', { kind: 'civic' });
  for (const [x, y] of [[-160, 40], [220, 40], [-160, 180], [220, 180], [-160, 320], [220, 320]]) L(x, y, 'wallLamp');
  for (let run = 0; run < 2; run++) {
    for (let i = 0; i < 12; i++) {
      const t = i / 11, x = -150 + t * 360, y = -20 + run * 70 + Math.sin(t * Math.PI) * 26;
      L(x, y, 'stringBulb', { kind: 'civic' });
    }
  }
  L(150, bottom(2) - 10, 'fireBarrel');
  L(265, 20, 'fluoroTube');
  L(265, 165, 'failingTube');
  L(265, 310, 'fluoroTube');
  L(880, -20, 'streetLamp', { kind: 'civic' });
  L(985, bottom(0) - 12, 'fireBarrel');
  for (let i = 0; i < 16; i++) { const t = i / 15; L(330 + t * 660, -30 + Math.sin(t * Math.PI) * 30, 'stringBulb', { kind: 'civic' }); }
  L(1040, 300, 'emergency');
  L(1150, bottom(2) - 6, 'lantern', { area: 'e:2:e' });
  L(1230, 340, 'teaseBeyond', { kind: 'tease', area: 'e:2:e' });
  L(560, 690, 'crystal', { kind: 'tease', area: 'p:2:cave', color: STRATA[5].tease });
  L(-400, 780, 'sodium', { area: 'f:4' });
  L(-100, 760, 'sodium', { area: 'f:4' });
  L(200, 470, 'floodlight', { area: 'f:3' });

  city.setLayout(layout);
  city.setEra(2, 0);

  // ---------------- camera
  const cam = { x: +(q.get('x') ?? 300), y: +(q.get('y') ?? 170), z: +(q.get('z') ?? 1) };
  const pi: ParallaxInfo = { cx: 0, cy: 0, z: 1, ox: 0, oy: 0, sw: 1, sh: 1 };
  const applyCam = (): void => {
    const sw = app.screen.width, sh = app.screen.height;
    wc.scale.set(cam.z);
    wc.position.set(sw / 2 - cam.x * cam.z, sh / 2 - cam.y * cam.z);
    parallaxFromWorld(pi, wc, sw, sh);
  };
  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  app.canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    cam.x = drag.cx - dx / cam.z;
    cam.y = drag.cy - dy / cam.z;
  });
  window.addEventListener('pointerup', e => {
    if (drag && !drag.moved) {
      const wx = (e.clientX - wc.x) / cam.z, wy = (e.clientY - wc.y) / cam.z;
      city.reveal(wx, wy);
      const a = city.areaAt(wx, wy);
      if (a && a.state !== 'revealed') city.setAreaState(a.id, 'revealed');
    }
    drag = null;
  });
  app.canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const wx = (e.clientX - wc.x) / cam.z, wy = (e.clientY - wc.y) / cam.z;
    cam.z = Math.max(0.32, Math.min(3, cam.z * Math.exp(-e.deltaY * 0.0016)));
    cam.x = wx - (e.clientX - app.screen.width / 2) / cam.z;
    cam.y = wy - (e.clientY - app.screen.height / 2) / cam.z;
  }, { passive: false });

  // ---------------- frame
  let t = 0;
  const step = (dt: number): void => {
    t += dt;
    for (const w of walkers) {
      w.x += w.v * dt;
      if (w.x < w.x0 || w.x > w.x1) { w.v = -w.v; w.x = Math.max(w.x0, Math.min(w.x1, w.x)); }
      w.c.position.set(w.x, w.y);
      w.c.scale.x = w.v < 0 ? -1 : 1;
      w.c.children[0].y = Math.abs(Math.sin(t * 8 + w.x0)) * -1.5;
      if (w.light) city.moveLight(w.light, w.x + (w.v < 0 ? -8 : 8), w.y - 30);
    }
    applyCam();
    city.update(pi, t, dt);
  };
  app.ticker.add(tk => step(Math.min(0.05, tk.deltaMS / 1000)));

  // ---------------- panel
  const btns = document.getElementById('btns')!, statsEl = document.getElementById('stats')!;
  const tiers: RenderTier[] = ['high', 'medium', 'low', 'lite'];
  const tierBtns = tiers.map(tr => {
    const b = document.createElement('button');
    b.textContent = tr;
    b.onclick = () => setTier(tr);
    btns.appendChild(b);
    return b;
  });
  const toggles: [string, () => boolean, () => void][] = [
    ['light', () => city.lightmapEnabled, () => { city.lightmapEnabled = !city.lightmapEnabled; }],
    ['fog', () => city.fogEnabled, () => { city.fogEnabled = !city.fogEnabled; }],
    ['nest', () => nest, () => { nest = !nest; wc.filters = nest ? [grade] : []; }],
  ];
  const togBtns = toggles.map(([name, get, flip]) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => { flip(); b.classList.toggle('on', get()); };
    b.classList.toggle('on', get());
    btns.appendChild(b);
    return b;
  });
  let uv: 'global' | 'area' = q.get('uv') === 'area' ? 'area' : 'global';
  const uvBtn = document.createElement('button');
  uvBtn.textContent = `uv:${uv}`;
  uvBtn.onclick = () => { uv = uv === 'global' ? 'area' : 'global'; city.setUvMode(uv); uvBtn.textContent = `uv:${uv}`; };
  btns.appendChild(uvBtn);
  const reset = document.createElement('button');
  reset.textContent = 're-fog';
  reset.onclick = () => { city.fog.clearBrushes(); city.setLayout({ ...layout, sig: layout.sig }); for (const a of areas) city.setAreaState(a.id, a.state); };
  btns.appendChild(reset);
  function setTier(tr: RenderTier): void {
    city.setTier(tr);
    tierBtns.forEach((b, i) => b.classList.toggle('on', tiers[i] === tr));
  }
  setTier(tier0);
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if ('1234'.includes(k)) setTier(tiers[+k - 1]);
    if (k === 'l') togBtns[0].click();
    if (k === 'f') togBtns[1].click();
    if (k === 'n') togBtns[2].click();
    if (k === 'm') uvBtn.click();
    if (k === 'h') document.getElementById('panel')!.classList.toggle('hidden');
  });
  let fps = 60;
  app.ticker.add(tk => { fps += (1000 / Math.max(1, tk.deltaMS) - fps) * 0.05; });
  setInterval(() => {
    const ls = city.lighting.stats, cs = city.backdrop.chunkStats;
    statsEl.textContent = `${fps.toFixed(0)} fps · ${city.quality} · z ${cam.z.toFixed(2)} · lights ${ls.drawn}/${ls.candidates} of ${city.lighting.count} · motes ${ls.motes} · floors ${ls.floors} · fog redraws ${city.fog.stats.redraws} · chunks far ${cs.far.built} back ${cs.back.built} · bakes ${city.stats.bakes} · cpu ${city.stats.updateMs.toFixed(2)} ms`;
  }, 250);

  // ---------------- measurement hooks
  const gl = (renderer as unknown as { gl: WebGL2RenderingContext }).gl;
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  async function gpuTime(n: number, fn: () => void): Promise<{ median: number; p95: number; n: number } | null> {
    if (!timer) return null;
    const qs: WebGLQuery[] = [];
    for (let i = 0; i < n; i++) {
      const qq = gl.createQuery()!;
      gl.beginQuery(timer.TIME_ELAPSED_EXT, qq);
      fn();
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      qs.push(qq);
      gl.flush();
      await new Promise(r => setTimeout(r, 0));
    }
    const out: number[] = [];
    for (let tries = 0; tries < 200 && out.length < qs.length; tries++) {
      await new Promise(r => setTimeout(r, 20));
      out.length = 0;
      for (const qq of qs) if (gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE)) out.push(gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6);
    }
    for (const qq of qs) gl.deleteQuery(qq);
    if (gl.getParameter(timer.GPU_DISJOINT_EXT)) console.warn('[lab] GPU disjoint during timing');
    out.sort((a, b) => a - b);
    return { median: out[Math.floor(out.length / 2)], p95: out[Math.floor(out.length * 0.95)], n: out.length };
  }
  function wallTime(n: number, fn: () => void): { median: number; p95: number } {
    const px = new Uint8Array(4);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      fn();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out.push(performance.now() - t0);
    }
    out.sort((a, b) => a - b);
    return { median: out[Math.floor(n / 2)], p95: out[Math.floor(n * 0.95)] };
  }
  const frame = (): void => { step(1 / 60); app.render(); };
  (window as unknown as Record<string, unknown>).__lab = {
    app, city, cam, layout,
    gl: () => {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), timer: !!timer, res: renderer.resolution, w: app.screen.width, h: app.screen.height };
    },
    goto(x: number, y: number, z: number) { cam.x = x; cam.y = y; cam.z = z; },
    setTier,
    settle() { applyCam(); city.backdrop.settle(pi); for (let i = 0; i < 4; i++) frame(); },
    stats: () => ({ lights: { ...city.lighting.stats, total: city.lighting.count }, fog: { ...city.fog.stats }, city: { ...city.stats }, chunks: city.backdrop.chunkStats }),
    /**
     * GPU cost of the lightmap at the current view: the light-texture pass alone, the whole frame with and without the LightmapFilter
     * (the difference is the filter's full-screen pass + the group's intermediate texture), and the fog's share of the frame.
     */
    async bench(n = 120) {
      app.ticker.stop();
      for (let i = 0; i < 30; i++) frame();
      const lightPass = await gpuTime(n, () => { step(1 / 60); city.renderLightmap(t); });
      const frameOn = await gpuTime(n, frame);
      city.lightmapEnabled = false;
      for (let i = 0; i < 5; i++) frame();
      const frameOff = await gpuTime(n, frame);
      city.lightmapEnabled = true;
      city.fogEnabled = false;
      for (let i = 0; i < 5; i++) frame();
      const frameNoFog = await gpuTime(n, frame);
      city.fogEnabled = true;
      const cpu: number[] = [];
      for (let i = 0; i < n; i++) { const t0 = performance.now(); step(1 / 60); cpu.push(performance.now() - t0); }
      cpu.sort((a, b) => a - b);
      const wall = timer ? null : { on: wallTime(n, frame) };
      app.ticker.start();
      return {
        tier: city.quality, view: { ...cam }, lights: { ...city.lighting.stats }, lightPass, frameOn, frameOff, frameNoFog,
        filterMs: frameOn && frameOff ? frameOn.median - frameOff.median : null,
        lightmapMs: lightPass && frameOn && frameOff ? lightPass.median + frameOn.median - frameOff.median : null,
        fogMs: frameOn && frameNoFog ? frameOn.median - frameNoFog.median : null,
        cpuUpdate: { median: cpu[n >> 1], p95: cpu[Math.floor(n * 0.95)] }, wall,
      };
    },
  };
}

function lerpHex(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

function inPoly(p: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    if (p[i + 1] > y !== p[j + 1] > y && x < ((p[j] - p[i]) * (y - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
  }
  return inside;
}

boot().catch(err => {
  document.getElementById('stats')!.textContent = `boot failed: ${err}`;
  console.error(err);
});
