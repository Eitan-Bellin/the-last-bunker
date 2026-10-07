import { Rectangle } from 'pixi.js';
import type { BunkerRenderer } from '../rendering/BunkerRenderer';
import type { GameState } from '../core/GameState';

/**
 * [plan4:ST-11/13/14/15/17] Dev-only helpers of the Structure-Render work (never in production builds):
 *  - `__shotPngAt(x, y, zoomRel, resolution?, frames?)` a view at any world point as a base64 PNG (the fixed views of camShots cannot reach a wing)
 *  - `__setInfra(items)` replaces `state.layout.infra` (bulkheads, stairwells, vent stacks) to look at them before the build flow exists
 *  - `__setDoor('floor:boundaryX', 'open'|'closed'|'sealed')` sets one bulkhead's state
 */
export function installStructureDev(renderer: BunkerRenderer, getState: () => GameState): void {
  const w = window as unknown as Record<string, unknown>;
  w.__shotPngAt = async (x: number, y: number, zoomRel: number, resolution = window.devicePixelRatio || 1, frames = 20) => {
    renderer.devCamera(x, y, zoomRel);
    const fx = (renderer as unknown as { postfx?: { forced: string | null } }).postfx;
    if (fx) fx.forced = 'high';
    const forceNight = (window as unknown as { __forceNight?: number }).__forceNight;
    for (let i = 0; i < frames; i++) {
      if (typeof forceNight === 'number') renderer.setNight(forceNight);
      renderer.render(getState(), 1 / 60, 1);
      renderer.app.renderer.render(renderer.app.stage);
      await new Promise(r => setTimeout(r, 16));
    }
    const app = renderer.app;
    const canvas = app.renderer.extract.canvas({
      target: app.stage, resolution, frame: new Rectangle(0, 0, app.screen.width, app.screen.height),
    }) as HTMLCanvasElement;
    return canvas.toDataURL('image/png').split(',')[1];
  };
  w.__setInfra = (items: GameState['layout']['infra']): boolean => {
    getState().layout.infra = items;
    return true;
  };
  w.__setDoor = (key: string, value: 'open' | 'closed' | 'sealed' | null): boolean => {
    const doors = getState().layout.doors;
    if (value === null) delete doors[key];
    else doors[key] = value;
    return true;
  };
}
