/**
 * The two seams between the render side of "The City Below" and the level-builder's model and shell (C-render-notes.md, Phase 2).
 *
 * 1. The layout provider: `(state) => CityLayout`. BunkerRenderer (behind `?city`) asks it for the layout whenever its signature
 *    changes. The default is the stub in `stubLayout.ts` (hub around the spine, floor strips, edges, the dig face), so the game runs
 *    end to end before `src/world/model/cityLayout.ts` lands. At merge the level-builder plugs in its own with one line:
 *        setCityLayoutProvider({ sig: cityLayoutSig, build: buildCityLayout });
 * 2. The shell mounter: builds the city shell (rock with its cavities, hub, vestibules, caverns, edges, dig face) into the holders the
 *    renderer hands it, in place of the classic `buildUnderground` / `buildCasing`. The default is null: the renderer keeps drawing
 *    the classic tower's underground (its rock and casing at the classic-frame offsets) so the picture is never empty. At merge:
 *        setShellMounter(mountShell);
 *
 * Both are module-level so the wiring is one import in `src/main.ts`/`app.ts` (or in the level-builder's own module) and the renderer
 * never imports the level-builder's files. Node-safe: types plus two variables.
 */
import type { Container } from 'pixi.js';
import type { GameState } from '../../core/GameState';
import type { AreaState, CityLayout, Rect } from './layoutTypes';
import type { RenderTier } from '../tokensRender';
import type { LightInput } from './lighting';
import { stubLayoutProvider } from './stubLayout';

/** Builds the layout from the game state. `sig` must change whenever `build` would return something different (geometry or area states). */
export interface CityLayoutProvider {
  sig(state: GameState): string;
  build(state: GameState): CityLayout;
}

let provider: CityLayoutProvider = stubLayoutProvider;

export function setCityLayoutProvider(p: CityLayoutProvider | null): void {
  provider = p ?? stubLayoutProvider;
}

export function cityLayoutProvider(): CityLayoutProvider {
  return provider;
}

/** What the shell mounter is given. The holders sit inside the lit group, so everything in them is multiplied by the lightmap. */
export interface ShellMountContext {
  state: GameState;
  layout: CityLayout;
  /**
   * Behind the rooms (rock, cavity backs, hub vault and walls): the host's own shell holder right after `undergroundHolder`, which
   * `rebuildStructure` never clears. Emptied (children destroyed) before every mount.
   */
  back: Container;
  /** In front of the rooms and the shaft, behind the people (balconies, rails, stairs, bridge, edge rubble, dig face). Emptied before every mount. */
  front: Container;
  era: number;
  tier: RenderTier;
  /** Adds a light to the city lightmap (shell lamps: vestibule tubes, hub chandelier, edge teases). Returns its id. */
  addLight(l: LightInput): number;
  removeLight(id: number): void;
  /** Fog state of one area (progress 0..1 while digging), for progress the layout signature leaves out. */
  setAreaState(id: string, state: AreaState, progress: number): void;
  /** Ask for a fresh mount on the next frame (e.g. real art replaced a stand-in that a texture cache had baked). */
  requestRebuild(): void;
}

/** What a mounted shell gives back: per-frame animation (optional) and its own teardown (lights it added included). */
export interface MountedShell {
  /** Per frame, before the city's update: `view` = the world rect on screen (rock chunk streaming). */
  update?(t: number, dt: number, view: Rect): void;
  /** About twice a second: digs and district construction move on without a new layout (fog states and rubble). */
  syncProgress?(state: GameState): void;
  destroy(): void;
}

export type ShellMounter = (ctx: ShellMountContext) => MountedShell | null;

let mounter: ShellMounter | null = null;

export function setShellMounter(m: ShellMounter | null): void {
  mounter = m;
}

export function shellMounter(): ShellMounter | null {
  return mounter;
}
