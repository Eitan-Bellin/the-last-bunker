/**
 * [world:C2] Plugs the level-builder's model and shell into the renderer's two seams (citySeams.ts). Called once by BunkerRenderer
 * when it mounts the city (`?city` only, dev and prod); classic mode never calls it. The stub layout stays the fallback when the seams
 * are reset (`setCityLayoutProvider(null)`, `setShellMounter(null)`).
 *
 * The shell adapter: `buildShell(layout, state, tier, { era })` into the host's two shell holders, its lights into the city lightmap
 * (each keeps its `area` id, so hidden areas stay dark), the rock chunks streamed around the view every frame, and the dig / district
 * progress (`cityProgress`, which the layout signature leaves out) into the fog states and the rubble twice a second.
 */
import { buildCityLayout, cityLayoutSig, cityProgress } from '../model/cityLayout';
import { buildShell } from './shell';
import { onWorldKitLoaded } from '../../art/worldKit';
import type { Container } from 'pixi.js';
import type { Rect } from './layoutTypes';
import { setCityLayoutProvider, setShellMounter, type ShellMounter } from './citySeams';

const mountCityShell: ShellMounter = ctx => {
  const parts = buildShell(ctx.layout, ctx.state, ctx.tier, { era: Math.max(0, ctx.era) });
  ctx.back.addChild(parts.back);
  ctx.front.addChild(parts.front);
  const ids = parts.lights.map(l => ctx.addLight(l));
  const cull = cullList(parts.back, parts.front);
  let destroyed = false;
  // The rock chunks and shell pieces bake into texture caches (cacheAsTexture): a world-kit painting that arrives after a bake would leave the
  // stand-in baked in (seen in the game: plain rock around the storeys, banded rock beyond). Remount once the arrivals settle (800 ms).
  let timer = 0;
  const off = onWorldKitLoaded(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { if (!destroyed) ctx.requestRebuild(); }, 800);
  });
  return {
    update(_t, _dt, view) {
      parts.update(view, performance.now());
      cullTo(cull, view);
    },
    syncProgress(state) {
      for (const p of cityProgress(state)) {
        ctx.setAreaState(p.id, p.state, p.progress);
        parts.setProgress(p.id, p.progress);
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      off();
      window.clearTimeout(timer);
      for (const id of ids) ctx.removeLight(id);
      parts.destroy();
    },
  };
};

/**
 * Pixi draws what is visible, on screen or not, and the shell is mostly one sprite per piece (a vestibule tile is a TilingSprite, a draw call
 * each: 92 at e55 for the vestibules alone). Each piece's children are culled against the view (the rock streams its own chunks).
 */
interface Cullable { c: Container; x0: number; y0: number; x1: number; y1: number; on: boolean }
const CULL_PAD = 96;

function cullList(...roots: Container[]): Cullable[] {
  const out: Cullable[] = [];
  for (const root of roots) for (const piece of root.children) {
    if (piece.label === 'shell:rock') continue;
    for (const c of piece.children) {
      const b = c.getLocalBounds();
      const x0 = piece.x + c.x + b.minX * c.scale.x, x1 = piece.x + c.x + b.maxX * c.scale.x;
      const y0 = piece.y + c.y + b.minY * c.scale.y, y1 = piece.y + c.y + b.maxY * c.scale.y;
      out.push({ c, x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), on: true });
    }
  }
  return out;
}

function cullTo(list: Cullable[], v: Rect): void {
  const x0 = v.x - CULL_PAD, y0 = v.y - CULL_PAD, x1 = v.x + v.w + CULL_PAD, y1 = v.y + v.h + CULL_PAD;
  for (let i = 0; i < list.length; i++) {
    const k = list[i];
    const on = k.x1 > x0 && k.x0 < x1 && k.y1 > y0 && k.y0 < y1;
    if (on !== k.on) { k.on = on; k.c.renderable = on; }
  }
}

let installed = false;

export function installCityWorld(): void {
  if (installed) return;
  installed = true;
  setCityLayoutProvider({ sig: cityLayoutSig, build: buildCityLayout });
  setShellMounter(mountCityShell);
}
