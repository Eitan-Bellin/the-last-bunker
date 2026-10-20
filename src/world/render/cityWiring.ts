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
import { Graphics, type Container } from 'pixi.js';
import type { Rect } from './layoutTypes';
import { SHELL_RENDER } from '../tokensRender';
import { setCityLayoutProvider, setShellMounter, type ShellMounter } from './citySeams';
import { GFX } from '../../rendering/gfxFeatures';
import { labelState } from '../../rendering/LabelScale';
import { CALM_COLOR } from '../../rendering/roomPlate';
import { polyBounds } from '../model/outline';
import type { CityLayout } from './layoutTypes';

/** [clean:0] The calm sheet's opacity, and the shell dressing it replaces at normal zoom (CALM_COLOR: the clean front's own token, roomPlate.ts). */
const CALM_ALPHA = 1;
const CALM_PAD = 2400;
const CLEAN_HIDE = new Set(['caverns:front']);

/**
 * [clean:0] One flat dark sheet over the whole shell back (cavity backs, rock cut face, strata), under the rooms: at normal zoom the eye rests
 * on the paintings, not on tile, rock and timber. The lightmap still lights it round the lamps. Shown only while the room names show
 * (LabelScale 'full'); farther out the strata and the shell come back.
 */
function buildCalm(layout: CityLayout): Graphics {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of layout.cavities) {
    const b = polyBounds(c.poly);
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
  }
  const g = new Graphics();
  g.label = 'shell:calm';
  g.eventMode = 'none';
  if (isFinite(x0)) g.rect(x0 - CALM_PAD, y0 - 8, x1 - x0 + 2 * CALM_PAD, y1 - y0 + 8 + CALM_PAD).fill({ color: CALM_COLOR, alpha: CALM_ALPHA });
  return g;
}

const mountCityShell: ShellMounter = ctx => {
  const parts = buildShell(ctx.layout, ctx.state, ctx.tier, { era: Math.max(0, ctx.era) });
  ctx.back.addChild(parts.back);
  ctx.front.addChild(parts.front);
  // [clean:0] The calm sheet (not built with `?gx=-clean`) and the dressing it hides at normal zoom (cave timber, ledges and stalactites).
  const calm = GFX.clean ? buildCalm(ctx.layout) : null;
  if (calm) ctx.back.addChild(calm);
  const dressing = GFX.clean ? parts.front.children.filter(c => CLEAN_HIDE.has(c.label)) : [];
  let calmOn: boolean | null = null;
  // [clean:0] Under the calm sheet the shell's fixtures are not drawn, so their lamps keep only the light they throw (no floating halos or cones).
  const ids = parts.lights.map(l => ctx.addLight(GFX.clean ? { ...l, halo: 0, cone: 0 } : l));
  batchOrder(parts.back, parts.front);
  if (ctx.state.currentFloors <= SHELL_RENDER.forceBatchMaxFloors) forceBatch(parts.back, parts.front); // [world:M1] small shells only (see SHELL_RENDER)
  const cull = cullList(parts.back, parts.front);
  let destroyed = false;
  // The rock chunks bake into texture caches (cacheAsTexture): a world-kit painting that arrives after a bake would leave the stand-in baked in
  // (seen in the game: plain rock around the storeys, banded rock beyond). Once the arrivals settle (800 ms) the rock chunks are dropped and
  // rebuild near the view; the other pieces swap their stand-ins by themselves (worldKit pendingSprites).
  let timer = 0;
  const off = onWorldKitLoaded(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { if (!destroyed) parts.refreshRock(); }, 800);
  });
  return {
    update(_t, _dt, view) {
      if (calm) {
        const on = labelState.mode === 'full';
        if (on !== calmOn) {
          calmOn = on;
          calm.visible = on;
          parts.back.visible = !on; // [perf] the sheet is opaque: what lies under it is not drawn at all (fewer draw calls than before)
          for (const d of dressing) d.visible = !on;
        }
      }
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

/**
 * Draw-call order: inside each shell piece the children alternate blend modes (a vestibule tile, its multiply grain, the next tile...), and a
 * blend change breaks the batch, so each vestibule cost two draw calls. Per piece the children are regrouped, stably: normal first, then
 * multiply, then the rest (add). Pieces do not overlap each other much, and grain and glow are meant to lie over what they shade.
 */
function batchOrder(...roots: Container[]): void {
  const rank = (c: Container): number => (c.blendMode === 'multiply' ? 1 : c.blendMode === 'normal' || c.blendMode === 'inherit' || !c.blendMode ? 0 : 2);
  for (const root of roots) for (const piece of root.children) {
    if (piece.label === 'shell:rock' || piece.children.length < 3) continue;
    const kids = piece.children.slice();
    const sorted = kids.map((c, i) => ({ c, i, r: rank(c) })).sort((a, b) => a.r - b.r || a.i - b.i);
    if (sorted.every((k, i) => k.i === i)) continue;
    piece.removeChildren();
    for (const k of sorted) piece.addChild(k.c);
  }
}

/**
 * Pixi batches a Graphics only under 200 vertices ('auto'); a bigger one is drawn on its own AND breaks the batch around it. The shell's
 * vector dressing (an edge's tunnel floors and plates, the hub's posts and props, pocket cracks) is a handful of Graphics of 300-5000
 * vertices each: on a fresh game they cost ~24 draw calls at the overview. They are static (built once per layout), so they join the
 * batcher: their vertices are copied when the play group's draw list is rebuilt, not every frame. Same shader, same pixels.
 */
function forceBatch(...roots: Container[]): void {
  const walk = (o: Container): void => {
    if (o.label === 'shell:rock') return; // (cached chunks: one sprite each)
    if (o instanceof Graphics && o.context.batchMode === 'auto') o.context.batchMode = 'batch';
    for (const c of o.children) walk(c);
  };
  for (const r of roots) walk(r);
}

let installed = false;

export function installCityWorld(): void {
  if (installed) return;
  installed = true;
  setCityLayoutProvider({ sig: cityLayoutSig, build: buildCityLayout });
  setShellMounter(mountCityShell);
}
