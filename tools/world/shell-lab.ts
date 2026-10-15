/**
 * [world:C1] Shell lab: the level-builder's view of "The City Below" without the game's renderer. It builds the vertical-slice state with
 * the engine (src/dev/cityScenario.ts), derives the real layout (buildCityLayout), mounts the tech-artist's CityRenderer (lightmap, fog,
 * parallax planes) and the shell (mountShell), and puts the painted rooms, a stand-in spine and corridor decks and a few walkers in it.
 *
 * Open: http://localhost:5177/tools/world/shell-lab.html?city  (&scenario=slice|slice-dig  &tier=high|medium|low|lite  &era=0..3
 *        &x= &y= &z=  &w=1600&h=900  &nofog  &nolight)
 * Console: window.__lab (goto(x, y, z), setTier(t), settle(), shot(name) -> store/world-redesign/shots/C1-L-<name>.png).
 */
import { Application, Assets, ColorMatrixFilter, Container, Graphics, Rectangle, Sprite, type Texture } from 'pixi.js';
import { CityRenderer, parallaxFromWorld, type ParallaxInfo, type RoomLightInput, type FloorRect } from '../../src/world/render/CityRenderer';
import { LIGHT, PEOPLE, STRATA, UNIFY } from '../../src/world/tokens';
import type { RenderTier } from '../../src/world/tokensRender';
import { __setProjectionForTests, buildingRect, roomRect, roomsEastX, roomsWestX, slotX } from '../../src/world/project';
import { buildSliceState, type CityScenarioId } from '../../src/dev/cityScenario';
import { buildCityLayout, laneY } from '../../src/world/model/cityLayout';
import { mountShell } from '../../src/world/render/shell/mountShell';
import { preloadWorldKit } from '../../src/art/worldKit';
import { SLICE_ASSETS } from '../../src/world/tokensAssets';
import { tile } from '../../src/world/render/shell/kit';
import { floorExtent } from '../../src/core/GameState';
import { ROOM_H, SHAFT_W, SLAB, floorTop } from '../../src/rendering/geom';
import { isDistrict, roomSlots } from '../../src/data/buildingDefs';

const q = new URLSearchParams(location.search);
__setProjectionForTests('city');

async function boot(): Promise<void> {
  const W = +(q.get('w') ?? 0) || undefined, H = +(q.get('h') ?? 0) || undefined;
  const app = new Application();
  await app.init({
    ...(W && H ? { width: W, height: H } : { resizeTo: window }),
    background: 0x07080a, antialias: false, autoDensity: true, preference: 'webgl',
    resolution: Math.min(2, +(q.get('dpr') ?? devicePixelRatio) || 1),
  });
  document.getElementById('stage')!.appendChild(app.canvas);
  await preloadWorldKit(SLICE_ASSETS).catch(() => undefined);
  const renderer = app.renderer;
  const tier0 = (q.get('tier') as RenderTier) || 'medium';
  const city = new CityRenderer({ renderer, tier: tier0, canvas: app.canvas });
  const wc = new Container();
  wc.label = 'world';
  app.stage.addChild(wc);
  const grade = new ColorMatrixFilter({ resolution: 'inherit' });
  grade.brightness(1.04, false);
  wc.filters = [grade];

  // ---------------- state and layout
  const scenario = (q.get('scenario') as CityScenarioId) || 'slice';
  const state = buildSliceState(scenario);
  const era = q.has('era') ? +q.get('era')! : state.era;
  const layout = buildCityLayout(state);

  // Sky (the surface renderer's in the game): a plain dusk gradient above ground, outside the lit group.
  const sky = new Graphics();
  const S0 = STRATA[0].palette;
  for (let i = 0; i < 24; i++) {
    const t = i / 23, y0 = -900 + (900 * i) / 24;
    sky.rect(-4000, y0, 9000, 900 / 24 + 0.5).fill(lerpHex(0x1a1216, S0.accent, t * t));
  }
  sky.rect(-4000, -12, 9000, 12).fill(0x2c1f17);
  city.mount(wc);
  wc.addChildAt(sky, wc.getChildIndex(city.litGroup));

  // ---------------- play plane: shell back, rooms, spine, corridors, shell front, people
  const play = city.playLayer;
  const shellBack = new Container(), roomLayer = new Container(), spine = new Container(), corridors = new Container(), shellFront = new Container(), people = new Container();
  play.addChild(shellBack, roomLayer, spine, corridors, shellFront, people);
  const shell = mountShell(city, layout, state, { quality: tier0, back: shellBack, front: shellFront, era, renderer });

  const meta: Record<string, { lights?: { x: number; y: number; r: number; color: number; flicker: number }[] }> =
    await fetch('/art/meta.json').then(r => r.json()).catch(() => ({}));
  const roomInputs: RoomLightInput[] = [];
  for (const b of state.buildings) {
    if (b.position.floor < 0 || isDistrict(b.type)) continue;
    const rr = buildingRect(b);
    const art = `${b.type}-1`;
    let tex: Texture | null = null;
    try { tex = await Assets.load(`/art/rooms/${art}.webp`); } catch { tex = null; }
    if (tex) {
      const s = new Sprite(tex);
      s.position.set(rr.x, rr.y);
      s.width = rr.w;
      s.height = rr.h;
      roomLayer.addChild(s);
    } else {
      roomLayer.addChild(new Graphics().rect(rr.x, rr.y, rr.w, rr.h).fill(0x3a3430));
    }
    frame(roomLayer, rr);
    const working = b.assignedSurvivorIds.length > 0;
    roomInputs.push({ ...rr, id: b.id, state: working ? 'working' : 'idle', lamps: meta[`rooms/${art}`]?.lights, area: `f:${b.position.floor}` });
  }
  for (const r of state.ruins) {
    if (r.floor < 0) continue;
    const rr = roomRect(r.floor, r.x, r.w);
    const g = new Graphics();
    g.rect(rr.x, rr.y, rr.w, rr.h).fill(r.flooded ? 0x1c2a30 : 0x2e2824);
    for (let i = 0; i < rr.w / 14; i++) g.poly([rr.x + i * 14, rr.y + rr.h, rr.x + i * 14 + 9, rr.y + rr.h - 18 - (i % 3) * 9, rr.x + i * 14 + 20, rr.y + rr.h]).fill(0x1e1a18);
    if (r.flooded) g.rect(rr.x, rr.y + rr.h - 24, rr.w, 24).fill({ color: 0x2a5866, alpha: 0.6 });
    roomLayer.addChild(g);
    frame(roomLayer, rr);
    roomInputs.push({ ...rr, id: r.id, state: 'ruin', area: `f:${r.floor}` });
  }
  // Empty bays: a darker recess with the bay grid (the game's buildBays).
  for (let f = 0; f < state.currentFloors; f++) {
    const e = floorExtent(state, f);
    for (let s = -e.w; s < e.e; s++) {
      if (state.buildings.some(b => b.position.floor === f && s >= b.position.x && s < b.position.x + roomSlots(b.type))) continue;
      if (state.ruins.some(r => r.floor === f && s >= r.x && s < r.x + r.w)) continue;
      const rr = roomRect(f, s, 1);
      roomLayer.addChild(new Graphics().rect(rr.x + 2, rr.y + 4, rr.w - 4, rr.h - 4).fill({ color: 0x0c0a09, alpha: 0.5 }).rect(rr.x, rr.y + rr.h - 6, rr.w, 6).fill(0x2a2420));
    }
  }
  const walk: FloorRect[] = [];
  for (let f = 0; f < state.currentFloors; f++) {
    const e = floorExtent(state, f);
    const x0 = e.w > 0 ? slotX(f, -e.w) : roomsWestX(f) - 40, x1 = slotX(f, e.e);
    walk.push({ x: x0, y: laneY(f) - PEOPLE.adultHeight, w: x1 - x0, h: PEOPLE.adultHeight + 8, value: LIGHT.read.walkway });
  }
  city.setRooms(roomInputs, walk);

  // A stand-in spine: two guide rails and the car (the tech-artist's shaft `spineOnly` in the game).
  const sg = new Graphics();
  const top = floorTop(0) - 40, bot = floorTop(state.currentFloors - 1) + ROOM_H + SLAB;
  for (const x of [6, SHAFT_W - 9]) sg.rect(x, top, 3, bot - top).fill(0x4a4844).rect(x, top, 1, bot - top).fill(0x8a8478);
  sg.rect(2, floorTop(1) + 8, SHAFT_W - 4, ROOM_H - 2).fill(0x2a2826).stroke({ width: 1.5, color: UNIFY.outline.color });
  for (let x = 6; x < SHAFT_W - 4; x += 6) sg.rect(x, floorTop(1) + 12, 1.2, ROOM_H - 10).fill(0x6a6458);
  spine.addChild(sg);
  // Corridor decks in front of the rooms (frontChunks in the game).
  for (let f = 0; f < state.currentFloors; f++) {
    const e = floorExtent(state, f);
    const x0 = roomsEastX(f), x1 = slotX(f, e.e);
    corridors.addChild(new Graphics().rect(x0, floorTop(f) + ROOM_H, x1 - x0, SLAB).fill(0x24201c));
    corridors.addChild(tile('deck', x0, laneY(f), x1 - x0, 32));
    corridors.addChild(tile('railing', x0, laneY(f) - 24, x1 - x0, 24, { stratum: 1 }));
  }

  // Walkers: capsules on the lanes and balconies, two with lanterns.
  interface Walker { c: Container; x: number; y: number; x0: number; x1: number; v: number; light: number }
  const walkers: Walker[] = [];
  const outfits = [0x6b5a44, 0x4f5d4a, 0x5a4a5e, 0x6a4a3a, 0x48566a, 0x5e5a40];
  const lanes: [number, number, number][] = [[-50, 110, 0], [60, 600, 0], [-50, 110, 1], [160, 700, 1], [-50, 110, 2], [160, 380, 2], [-40, 120, 2], [200, 500, 0]];
  lanes.forEach(([x0, x1, f], i) => {
    const c = new Container();
    const g = new Graphics();
    const h = PEOPLE.adultHeight;
    g.ellipse(0, 0, 9 * UNIFY.contactShadow.widthMul, UNIFY.contactShadow.height / 2).fill({ color: 0x000000, alpha: UNIFY.contactShadow.alpha });
    g.roundRect(-5, -h * 0.45, 4, h * 0.45, 2).fill(0x2a2622).roundRect(1, -h * 0.45, 4, h * 0.45, 2).fill(0x2a2622);
    g.roundRect(-7, -h * 0.82, 14, h * 0.42, 4).fill(outfits[i % outfits.length]);
    g.circle(0, -h * 0.9, h * 0.1).fill(0xc8a080);
    c.addChild(g);
    people.addChild(c);
    const w: Walker = { c, x: x0 + ((x1 - x0) * ((i * 37) % 100)) / 100, y: laneY(f), x0, x1, v: (20 + (i * 7) % 18) * (i % 2 ? 1 : -1), light: 0 };
    if (i === 3) w.light = city.addLight({ x: w.x, y: w.y - 30, preset: 'lantern', kind: 'carried', dynamic: true });
    walkers.push(w);
  });

  city.setLayout(layout);
  city.setEra(era, 0);
  shell.syncProgress(state);
  if (q.has('nofog')) city.fogEnabled = false;
  if (q.has('nolight')) city.lightmapEnabled = false;

  // ---------------- camera
  const cam = { x: +(q.get('x') ?? 200), y: +(q.get('y') ?? 330), z: +(q.get('z') ?? 0.9) };
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
      const a = city.areaAt(wx, wy);
      if (a && a.state !== 'revealed') { city.reveal(wx, wy); city.setAreaState(a.id, 'revealed'); }
    }
    drag = null;
  });
  app.canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const wx = (e.clientX - wc.x) / cam.z, wy = (e.clientY - wc.y) / cam.z;
    cam.z = Math.max(0.3, Math.min(3, cam.z * Math.exp(-e.deltaY * 0.0016)));
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
      if (w.light) city.moveLight(w.light, w.x + (w.v < 0 ? -8 : 8), w.y - 30);
    }
    applyCam();
    shell.update();
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
  function setTier(tr: RenderTier): void {
    city.setTier(tr);
    tierBtns.forEach((b, i) => b.classList.toggle('on', tiers[i] === tr));
  }
  setTier(tier0);
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if ('1234'.includes(k)) setTier(tiers[+k - 1]);
    if (k === 'l') city.lightmapEnabled = !city.lightmapEnabled;
    if (k === 'f') city.fogEnabled = !city.fogEnabled;
    if (k === 'h') document.getElementById('panel')!.classList.toggle('hidden');
  });
  let fps = 60;
  app.ticker.add(tk => { fps += (1000 / Math.max(1, tk.deltaMS) - fps) * 0.05; });
  setInterval(() => {
    const ls = city.lighting.stats;
    statsEl.textContent = `${fps.toFixed(0)} fps · ${city.quality} · ${scenario} · era ${era} · z ${cam.z.toFixed(2)} · x ${cam.x.toFixed(0)} y ${cam.y.toFixed(0)} · lights ${ls.drawn}/${ls.candidates} of ${city.lighting.count} · rock ${shell.parts.stats.rockShown}/${shell.parts.stats.rockChunks} · cpu ${city.stats.updateMs.toFixed(2)} ms`;
  }, 250);

  const frameNow = (): void => { step(1 / 60); app.render(); };
  (window as unknown as Record<string, unknown>).__lab = {
    app, city, cam, layout, state, shell,
    goto(x: number, y: number, z: number) { cam.x = x; cam.y = y; cam.z = z; },
    setTier,
    settle() { applyCam(); city.backdrop.settle(pi); for (let i = 0; i < 40; i++) frameNow(); },
    async shot(name: string) {
      applyCam();
      city.backdrop.settle(pi);
      for (let i = 0; i < 40; i++) frameNow();
      const canvas = app.renderer.extract.canvas({ target: app.stage, resolution: 1, frame: new Rectangle(0, 0, app.screen.width, app.screen.height) }) as HTMLCanvasElement;
      const blob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/png'));
      await fetch(`/__store/save/store/world-redesign/shots/C1-L-${name}.png`, { method: 'POST', body: blob });
      return `${name} ${(blob.size / 1024).toFixed(0)} KB`;
    },
  };
}

/** The room alcove: a concrete lip and the shared outline (UNIFY.roomFrame / outline), as the game draws it. */
function frame(into: Container, rr: { x: number; y: number; w: number; h: number }): void {
  const fr = new Graphics();
  fr.rect(rr.x, rr.y, rr.w, rr.h).stroke({ width: UNIFY.roomFrame.lip, color: UNIFY.roomFrame.lipColor });
  fr.rect(rr.x - 2, rr.y - 2, rr.w + 4, rr.h + 4).stroke({ width: UNIFY.outline.width, color: UNIFY.outline.color, alpha: UNIFY.outline.alpha });
  into.addChild(fr);
}

function lerpHex(a: number, b: number, t: number): number {
  const f = (s: number) => Math.round(((a >> s) & 255) + ((((b >> s) & 255) - ((a >> s) & 255)) * t));
  return (f(16) << 16) | (f(8) << 8) | f(0);
}

boot().catch(err => {
  document.getElementById('stats')!.textContent = `boot failed: ${err}`;
  console.error(err);
});
