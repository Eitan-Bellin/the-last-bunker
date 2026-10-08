import { Rectangle } from 'pixi.js';
import type { BunkerRenderer } from '../rendering/BunkerRenderer';
import type { GameState } from '../core/GameState';
import { BUILDING_W, ROOM_H, ROOMS_X, SHAFT_W, SLOT_W, buildingX, floorTop, slotX } from '../rendering/layout';
import { ROW_X0, ROW_X1 } from '../rendering/surfaceRow'; // plan4:ST-16

interface Cam {
  id: string;
  /** World point to centre on and zoom relative to the fit-to-screen zoom; null when the bunker lacks the subject. */
  at: (s: GameState) => { x: number; y: number; z: number } | null;
}

/** The six fixed views of the graphics overhaul: every before/after pair is shot from exactly here. */
const CAMS: Cam[] = [
  { id: 'cam1-overview', at: () => ({ x: BUILDING_W / 2, y: floorTop(1), z: 1 }) },
  { id: 'cam2-floors-close', at: () => ({ x: ROOMS_X + SLOT_W * 3.5, y: floorTop(1) + ROOM_H / 2, z: 2.3 }) },
  { id: 'cam3-shaft-entrance', at: () => ({ x: SHAFT_W + 40, y: -10, z: 2.1 }) },
  {
    id: 'cam4-hall', at: s => {
      const h = s.buildings.find(b => b.type === 'atrium' || b.type === 'reactorHall');
      return h ? { x: ROOMS_X + (h.position.x + 1.5) * SLOT_W, y: floorTop(h.position.floor) + ROOM_H, z: 1.8 } : null;
    },
  },
  {
    id: 'cam5-district', at: s => {
      const d = s.buildings.find(b => b.type === 'cave' || b.type === 'lake' || b.type === 'metro');
      return d ? { x: buildingX(d) - 20, y: floorTop(d.position.floor) + ROOM_H / 2, z: 1.9 } : null;
    },
  },
  { id: 'cam6-deep', at: s => ({ x: ROOMS_X + SLOT_W * 6, y: floorTop(Math.max(0, s.currentFloors - 2)) + ROOM_H / 2, z: 2 }) },
  // [plan4:ST-16] the surface (gate-house) row, once it is open (or its ruin before: null there, the entrance view cam3 shows it)
  { id: 'cam7-surface', at: s => ({ x: s.layout?.surfaceOpen ? (ROW_X0 + ROW_X1) / 2 : -170, y: -60, z: s.layout?.surfaceOpen ? 1.05 : 1.5 }) },
  { id: 'cam8-surface-close', at: s => (s.layout?.surfaceOpen ? { x: ROW_X0 + (ROW_X1 - ROW_X0) * 0.62, y: -55, z: 2.4 } : null) }, // plan4:ST-16 two rooms of the row up close
  // [plan4:polish] a vent stack's exhaust on the surface (its mouth stands over the yard), and the end of a floor with a stairwell / vent stack column
  {
    id: 'cam9-vent', at: s => {
      const v = (s.layout?.infra ?? []).find(i => i.kind === 'ventStack');
      if (!v) return null;
      let x = slotX(v.x) + SLOT_W / 2;
      if (x > -110 && x < 176) x = x < 30 ? -128 : 184; // (as readInside places it)
      return { x, y: -45, z: 2 };
    },
  },
  // [plan4:polish] the first floors beside the shaft at walking zoom (an evacuation from a burning room is walked out toward the shaft)
  { id: 'cam11-evac', at: s => ({ x: ROOMS_X + 60, y: floorTop(1) + ROOM_H / 2, z: 1.6 }) },
  {
    id: 'cam10-column-end', at: s => {
      const c = (s.layout?.infra ?? []).find(i => i.kind === 'stairwell' || i.kind === 'ventStack');
      return c ? { x: slotX(c.x) - 30, y: floorTop(c.floor) + ROOM_H, z: 2.4 } : null;
    },
  },
];

/** Steps the renderer by hand, so shots work even in a background tab where requestAnimationFrame sleeps. */
let pump: (n: number) => Promise<void> = async () => {};

/**
 * Dev-only: `__cam(id)` jumps to a fixed view, `__compare(tag)` shoots all six into store/compare/<tag>/,
 * `__perf()` measures the render cost. Never included in production builds.
 */
export function installCamShots(renderer: BunkerRenderer, getState: () => GameState): void {
  const w = window as unknown as Record<string, unknown>;
  pump = async (n: number) => {
    // A background tab runs at ~1 fps, so the frame-rate monitor would drop to low quality (no bloom):
    // pin high quality in memory for the shot (nothing is written to storage).
    const fx = (renderer as unknown as { postfx?: { forced: string | null } }).postfx;
    if (fx) fx.forced = 'high';
    // `window.__forceNight = 0` (day) .. 1 (night) holds the clock for comparable shots.
    const forceNight = (window as unknown as { __forceNight?: number }).__forceNight;
    for (let i = 0; i < n; i++) {
      if (typeof forceNight === 'number') renderer.setNight(forceNight);
      renderer.render(getState(), 1 / 60, 1);
      renderer.app.renderer.render(renderer.app.stage);
      await new Promise(r => setTimeout(r, 16));
    }
  };
  const frames = (n: number) => pump(n);
  w.__cam = (id: string) => {
    const at = CAMS.find(c => c.id.startsWith(id))?.at(getState());
    if (at) renderer.devCamera(at.x, at.y, at.z);
    return !!at;
  };
  w.__compare = async (tag = 'before') => {
    const saved: string[] = [];
    for (const cam of CAMS) {
      const at = cam.at(getState());
      if (!at) continue;
      renderer.devCamera(at.x, at.y, at.z);
      await frames(20);
      const app = renderer.app;
      const canvas = app.renderer.extract.canvas({
        target: app.stage, resolution: 1, frame: new Rectangle(0, 0, app.screen.width, app.screen.height),
      }) as HTMLCanvasElement;
      const blob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/png'));
      await fetch(`/__store/save/store/compare/${tag}/${cam.id}.png`, { method: 'POST', body: blob });
      saved.push(`${cam.id} ${(blob.size / 1024).toFixed(0)}KB`);
    }
    return saved;
  };
  /**
   * [plan4:X-5] For tools/compare/run.mjs: the ids of the fixed views, and one view as a base64 PNG (no upload to the dev server), at the given
   * pixel density (default: the screen's). Resolves null when the bunker lacks the subject of that view.
   */
  w.__camIds = CAMS.map(c => c.id);
  w.__camPng = async (id: string, resolution = window.devicePixelRatio || 1, settleFrames = 20) => {
    const cam = CAMS.find(c => c.id.startsWith(id));
    const at = cam?.at(getState());
    if (!cam || !at) return null;
    renderer.devCamera(at.x, at.y, at.z);
    await frames(settleFrames);
    const app = renderer.app;
    const canvas = app.renderer.extract.canvas({
      target: app.stage, resolution, frame: new Rectangle(0, 0, app.screen.width, app.screen.height),
    }) as HTMLCanvasElement;
    return { id: cam.id, w: canvas.width, h: canvas.height, png: canvas.toDataURL('image/png').split(',')[1] };
  };
  /** One extra view at any world point, saved next to the fixed six. */
  w.__shotAt = async (x: number, y: number, z: number, name: string, tag = 'before') => {
    renderer.devCamera(x, y, z);
    await frames(20);
    const app = renderer.app;
    const canvas = app.renderer.extract.canvas({
      target: app.stage, resolution: 1, frame: new Rectangle(0, 0, app.screen.width, app.screen.height),
    }) as HTMLCanvasElement;
    const blob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/png'));
    await fetch(`/__store/save/store/compare/${tag}/${name}.png`, { method: 'POST', body: blob });
    return `${name} ${(blob.size / 1024).toFixed(0)}KB`;
  };
  w.__perf = async () => {
    const app = renderer.app;
    await frames(10);
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) app.renderer.render(app.stage);
    const gl = (app.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
    gl?.finish();
    return { msPerFrame: +((performance.now() - t0) / 60).toFixed(2), screen: `${app.screen.width}x${app.screen.height}`, res: app.renderer.resolution };
  };
}
