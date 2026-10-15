/**
 * [world:C1] The shell's contract (see store/world-redesign/C1-L-notes.md): what `buildShell` hands the host.
 */
import type { Container } from 'pixi.js';
import type { LightInput } from '../lighting';
import type { Rect } from '../layoutTypes';
import type { RenderTier } from '../../tokensRender';

/** A shell light: exactly CityRenderer.addLight's input (src/world/render/lighting.ts LightInput). */
export type LightDef = LightInput;

/** One piece of the shell: what goes behind the rooms, what goes in front of them, and its lights. */
export interface ShellPiece {
  back?: Container;
  front?: Container;
  lights: LightDef[];
  /** Areas whose look follows a progress (dig faces, edge digs, district digs): id -> setter (0..1). */
  progress?: Record<string, (p: number) => void>;
}

export interface ShellOptions {
  /** The era (0..3): string lights from Colony (2) on, public-lamp share. Defaults to the state's era. */
  era?: number;
}

/** What `buildShell` returns. */
export interface ShellParts {
  /** Behind the rooms (undergroundHolder): cavity backs (vault wall, tiles, concrete), then the rock cut face with the cavities cut. */
  back: Container;
  /** In front of the rooms and the spine (shellFront): balconies, railings, stairs, bridge, chandelier, edge chokes, the dig face. */
  front: Container;
  /** Every shell light (CityRenderer.addLight each once per build; remove them before the next build). */
  lights: LightDef[];
  /** Per frame: streams the rock chunks around the view (world units) and shows only what is in it. */
  update(view: Rect, now: number): void;
  /** A dig or a district moved on: the rubble of `f:<n>`, `e:<f>:<side>` or `d:<kind>` follows progress p (0..1) without a rebuild. */
  setProgress(id: string, p: number): void;
  /** For the probe: chunks of rock built / shown. */
  readonly stats: { rockChunks: number; rockShown: number };
  destroy(): void;
}

export type ShellQuality = RenderTier;
