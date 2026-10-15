/**
 * [world:C1] A minimal mount of the shell into a CityRenderer (the level-builder's own wiring; the tech-artist's BunkerRenderer
 * integration may call `buildShell` directly instead, see store/world-redesign/C1-L-notes.md).
 *
 *   const shell = mountShell(city, layout, state, { quality, back: undergroundHolder, front: shellFront });
 *   per frame:          shell.update();                 // rock chunks around the view (reads the play layer's transform)
 *   on a dig step:      shell.syncProgress(state);      // fog + rubble follow cityProgress(state), no rebuild
 *   on a new layout:    shell.rebuild(layout, state);   // when cityLayoutSig(state) changed
 *   shell.destroy();
 * Without `back` / `front`, it adds its own two holders to `city.playLayer`: the back at the bottom, the front on top (call
 * `bringFrontToTop()` after the host added its rooms if it mounts them later).
 */
import { Container, Point, type Renderer } from 'pixi.js';
import type { GameState } from '../../../core/GameState';
import { cityProgress } from '../../model/cityLayout';
import type { CityRenderer } from '../CityRenderer';
import type { CityLayout, Rect } from '../layoutTypes';
import type { RenderTier } from '../../tokensRender';
import { buildShell } from './index';
import type { ShellParts } from './types';

const P0 = new Point(), PA = new Point(), PB = new Point();

export interface ShellMountOptions {
  quality: RenderTier;
  back?: Container;
  front?: Container;
  era?: number;
  /** For the view rect (screen size); defaults to the city's own renderer. */
  renderer?: Renderer;
}

export interface ShellMount {
  readonly parts: ShellParts;
  readonly back: Container;
  readonly front: Container;
  update(view?: Rect, now?: number): void;
  syncProgress(state: GameState): void;
  rebuild(layout: CityLayout, state: GameState): void;
  bringFrontToTop(): void;
  destroy(): void;
}

export function mountShell(city: CityRenderer, layout: CityLayout, state: GameState, opts: ShellMountOptions): ShellMount {
  const ownBack = !opts.back, ownFront = !opts.front;
  const back = opts.back ?? new Container();
  const front = opts.front ?? new Container();
  if (ownBack) { back.label = 'shell:backHolder'; city.playLayer.addChildAt(back, 0); }
  if (ownFront) { front.label = 'shell:frontHolder'; city.playLayer.addChild(front); }
  const renderer = opts.renderer ?? (city as unknown as { renderer: Renderer }).renderer;
  let parts: ShellParts = buildShell(layout, state, opts.quality, { era: opts.era });
  let ids: number[] = [];
  const view: Rect = { x: 0, y: 0, w: 1, h: 1 };

  const attach = (): void => {
    back.addChild(parts.back);
    front.addChild(parts.front);
    ids = parts.lights.map(l => city.addLight(l));
  };
  const detach = (): void => {
    for (const id of ids) city.removeLight(id);
    ids = [];
    parts.back.parent?.removeChild(parts.back);
    parts.front.parent?.removeChild(parts.front);
    parts.destroy();
  };
  attach();

  return {
    get parts() { return parts; },
    back, front,
    update(v?: Rect, now: number = performance.now()) {
      if (!v) {
        // The screen rectangle in world units (toLocal walks the whole parent chain: render groups keep their own worldTransform).
        const a = back.toLocal(P0.set(0, 0), undefined, PA);
        const b = back.toLocal(P0.set(renderer.screen.width, renderer.screen.height), undefined, PB);
        view.x = Math.min(a.x, b.x);
        view.y = Math.min(a.y, b.y);
        view.w = Math.abs(b.x - a.x);
        view.h = Math.abs(b.y - a.y);
        v = view;
      }
      parts.update(v, now);
    },
    syncProgress(state: GameState) {
      for (const p of cityProgress(state)) {
        city.setAreaState(p.id, p.state, p.progress);
        parts.setProgress(p.id, p.progress);
      }
    },
    rebuild(next: CityLayout, state: GameState) {
      detach();
      parts = buildShell(next, state, opts.quality, { era: opts.era });
      attach();
    },
    bringFrontToTop() {
      if (ownFront) city.playLayer.addChild(front);
    },
    destroy() {
      detach();
      if (ownBack) back.destroy();
      if (ownFront) front.destroy();
    },
  };
}
