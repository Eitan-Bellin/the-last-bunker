/**
 * [world:C1 camera-nav] What the camera needs from the city layout (architecture 6.2): pure, Node-safe, no Pixi.
 *
 *  - bounds   where the camera may look: every revealed storey strip, edge stub, district and glimpsed / found pocket, down to the
 *             bottom of the deepest area that is not hidden (the dig face), plus CAMERA.pan.margin. The layout's own `bounds` carry a big
 *             dressing pad (sky, dark earth) and are too loose for the camera.
 *  - content  the whole dug city for the desktop home view: revealed storeys, edges, districts and the dig face, from the surface
 *             strip above (CAMERA.city.topY) to the dig face's bottom. Pockets are left out (they sit far beyond reach).
 *  - hub      the stratum-1 hub atrium with its two vestibules: the phone home view centres on it (the spine).
 */
import type { CityLayout, Rect } from '../render/layoutTypes';
import { polyBounds } from '../model/outline';
import { CAMERA } from '../tokens';

export interface CityCameraFrame {
  bounds: Rect;
  content: Rect;
  hub: Rect | null;
}

interface Box { x0: number; y0: number; x1: number; y1: number }

function grow(b: Box, p: readonly number[]): void {
  const q = polyBounds(p);
  if (q.x0 < b.x0) b.x0 = q.x0;
  if (q.x1 > b.x1) b.x1 = q.x1;
  if (q.y0 < b.y0) b.y0 = q.y0;
  if (q.y1 > b.y1) b.y1 = q.y1;
}

const toRect = (b: Box): Rect => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });

export function cityCameraFrame(layout: CityLayout): CityCameraFrame {
  const topY = CAMERA.city.topY;
  const content: Box = { x0: Infinity, y0: topY, x1: -Infinity, y1: 0 };
  const reach: Box = { x0: Infinity, y0: topY, x1: -Infinity, y1: 0 };
  for (const a of layout.areas) {
    if (a.state === 'hidden' || a.kind === 'surface') continue;
    const q = polyBounds(a.poly);
    // A glimpsed storey (the dig face) spans the whole world width: it counts for depth, not for width.
    const wide = a.kind === 'storey' && a.state === 'glimpsed';
    if (a.kind === 'pocket') { grow(reach, a.poly); continue; }
    if (wide) {
      content.y1 = Math.max(content.y1, q.y1);
      reach.y1 = Math.max(reach.y1, q.y1);
      continue;
    }
    grow(content, a.poly);
    grow(reach, a.poly);
  }
  for (const h of layout.hubs) {
    const F = layout.frames[h.s];
    const x0 = h.rect.x - (F?.vestW ?? 0), x1 = h.rect.x + h.rect.w + (F?.vestE ?? 0);
    content.x0 = Math.min(content.x0, x0); content.x1 = Math.max(content.x1, x1);
    reach.x0 = Math.min(reach.x0, x0); reach.x1 = Math.max(reach.x1, x1);
    content.y1 = Math.max(content.y1, h.rect.y + h.rect.h);
    reach.y1 = Math.max(reach.y1, h.rect.y + h.rect.h);
  }
  if (!isFinite(content.x0)) { content.x0 = layout.bounds.x; content.x1 = layout.bounds.x + layout.bounds.w; }
  if (!isFinite(reach.x0)) { reach.x0 = content.x0; reach.x1 = content.x1; }
  content.y0 = Math.min(content.y0, topY);
  reach.y0 = Math.min(reach.y0, topY);
  const m = CAMERA.pan.margin;
  const bounds = { x0: reach.x0 - m, y0: reach.y0, x1: reach.x1 + m, y1: reach.y1 + m * 0.5 };
  const h1 = layout.hubs.find(h => h.s === 1) ?? layout.hubs[0];
  let hub: Rect | null = null;
  if (h1) {
    const F = layout.frames[h1.s];
    hub = { x: h1.rect.x - (F?.vestW ?? 0), y: h1.rect.y, w: h1.rect.w + (F?.vestW ?? 0) + (F?.vestE ?? 0), h: h1.rect.h };
  }
  return { bounds: toRect(bounds), content: toRect(content), hub };
}
