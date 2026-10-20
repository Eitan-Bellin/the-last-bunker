/**
 * The city layout as the renderer reads it (architecture C section 1.3, mirrored field for field).
 *
 * `Rect`, `StratumFrame` and `StratumId` come from C0's `src/world/types.ts`. The layout shapes (HubGeom, CityArea, Cavity, EdgeSite,
 * CityLayout) are not in it yet, so the renderer defines them here exactly as the spec does; the level-builder's
 * `src/world/model/cityLayout.ts` satisfies them structurally. When they move into `types.ts`, this file becomes re-exports.
 * Pure types, no runtime code.
 */
import type { Rect, StratumFrame, StratumId } from '../types';

export type { Rect, StratumFrame, StratumId };

export interface HubGeom {
  s: StratumId;
  floors: number[];
  rect: Rect;
  /** The vault's ceiling profile as a polyline (x, y pairs), for the back wall and the chandelier anchor. */
  vault: number[];
  balconies: { floor: number; side: 'w' | 'e'; x0: number; x1: number; y: number }[];
  stairs: { side: 'w' | 'e'; x: number; top: number; bottom: number }[];
  bridge?: { floor: number; x0: number; x1: number; y: number };
}

export type AreaKind = 'surface' | 'storey' | 'edge' | 'district' | 'gallery' | 'pocket';
export type AreaState = 'hidden' | 'glimpsed' | 'digging' | 'revealed';

export interface CityArea {
  id: string;
  kind: AreaKind;
  s: StratumId;
  /** Closed polygon, flat x, y pairs in world units. */
  poly: number[];
  state: AreaState;
  /** 0..1 while `digging`. */
  progress?: number;
  label?: { x: number; y: number; key: string };
}

export interface EdgeSite {
  id: string;
  floor: number;
  side: 'w' | 'e';
  x: number;
  y: number;
  block: 'act' | 'stability' | 'district' | 'ready' | 'digging';
  progress: number;
}

/** A hole cut into the rock. `back` says what stands behind it; 'none' opens onto the parallax planes. */
export interface Cavity { id: string; s: StratumId; poly: number[]; back: 'hub' | 'tile' | 'rock' | 'concrete' | 'none' }

export interface CityLayout {
  sig: string;
  frames: StratumFrame[];
  hubs: HubGeom[];
  cavities: Cavity[];
  areas: CityArea[];
  edges: EdgeSite[];
  bounds: Rect;
  strata: { s: StratumId; y0: number; y1: number }[];
}
