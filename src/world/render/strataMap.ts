/**
 * [world:M2] The far-zoom strata map: a schematic cross-section "atlas" of the city, shown below CAMERA.zoom.far instead of the scene
 * (architecture section 5 LOD, M2). Fog-aware: it draws only what discovery has revealed.
 *
 *  - Strata as bands with their names (the reached ones), the next one as a hatched "?", deeper ones as darkness.
 *  - The spine (the lift shaft) as a line and each reached stratum's hub as a station node on it.
 *  - Dug storeys as lit strips, their rooms as windows in the trade colours (CATEGORY, shared with the classic map and roomClarity).
 *  - Districts and found pockets as shapes once revealed; glimpsed districts and pockets as "?" markers; hidden areas are not drawn.
 *  - Animated (MAP.animHz): the current dig as a pulsing front with its progress, wing and district digs, survivors as dots (density),
 *    crises, and the "new discovery" pins.
 *
 * Everything is placed through the city layout (project.ts frames, CityLayout areas, hubs and strata bands): no fixed offsets. Labels and
 * markers are counter-scaled to a constant screen size and the band names stick to the view's edge (the start edge of the reading
 * direction). Hebrew text has no letterSpacing, and a band's numeral and its name are separate Text objects (bidi-safe).
 *
 * Cost: one static Graphics built once per layout / rooms / locale (ahead of the switch, see MAP.prewarm), one small Graphics redrawn at
 * MAP.animHz while the map shows, and at most 8 labels. A tap is answered by `focusAt` (BunkerRenderer turns it into a camera move).
 */
import { Container, Graphics, Rectangle, RenderTexture, Sprite, Text, Texture, type Renderer } from 'pixi.js';
import type { BuildingInstance, GameState } from '../../core/GameState';
import { isDistrict } from '../../data/buildingDefs';
import { STRATA, strataReached, type StratumId } from '../../data/strata';
import { ROOM_H, SHAFT_W, SLOT_W, SURFACE_TOP, floorTop } from '../../rendering/geom';
import { hashString } from '../../rendering/draw';
import { CATEGORY, type CityMap, type MapFocus, type MapView } from '../../rendering/cityMap';
import { buildingRect, slotX } from '../project';
import { cityProgress } from '../model/cityLayout';
import { MAP, PINS } from '../tokensRender';
import { FogLayer } from './fog';
import type { CityArea, CityLayout } from './layoutTypes';

export interface StrataMapInput {
  state: GameState;
  layout: CityLayout;
  locale: string;
  rtl: boolean;
  /** The "new discovery" pins (CityHost's list; read at each redraw). */
  pins: () => readonly { id: string; x: number; y: number }[];
}

interface Band { s: StratumId; y0: number; y1: number; reached: boolean; next: boolean }
interface Label { root: Container; y0: number; y1: number; w: number; h: number; surface: boolean }
interface Mark { x: number; y: number }

type Box = { x0: number; y0: number; x1: number; y1: number };

function polyBox(p: readonly number[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < x0) x0 = p[i];
    if (p[i] > x1) x1 = p[i];
    if (p[i + 1] < y0) y0 = p[i + 1];
    if (p[i + 1] > y1) y1 = p[i + 1];
  }
  return { x0, y0, x1, y1 };
}

const ink = (s: number): number => MAP.ink[Math.max(0, Math.min(MAP.ink.length - 1, s))];

/** A horizontal dashed line (rects: one fill call for all of them). */
function dashH(g: Graphics, x0: number, x1: number, y: number, h: number, color: number, alpha: number): void {
  for (let x = x0; x < x1; x += MAP.dash + MAP.gap) g.rect(x, y - h / 2, Math.min(MAP.dash, x1 - x), h);
  g.fill({ color, alpha });
}

let markTex: Texture | null = null;

/** The "?" marker: a ringed disc with a question mark, drawn once on a canvas and shared by every map (and kept for the session). */
function questionTexture(): Texture {
  if (markTex && !markTex.destroyed) return markTex;
  const n = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const c = cv.getContext('2d')!;
  c.fillStyle = 'rgba(6,16,30,0.92)';
  c.beginPath();
  c.arc(n / 2, n / 2, n / 2 - 3, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = 'rgba(154,200,255,0.85)';
  c.setLineDash([7, 5]);
  c.stroke();
  c.fillStyle = '#cfe6ff';
  c.font = '700 38px Rubik, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('?', n / 2, n / 2 + 2);
  markTex = Texture.from(cv);
  return markTex;
}

const DOT_TEX = 32;
let dotTex: Texture | null = null;

/** A soft white dot (survivors), drawn once on a canvas and tinted per sprite. */
function dotTexture(): Texture {
  if (dotTex && !dotTex.destroyed) return dotTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = DOT_TEX;
  const c = cv.getContext('2d')!;
  const gr = c.createRadialGradient(DOT_TEX / 2, DOT_TEX / 2, 0, DOT_TEX / 2, DOT_TEX / 2, DOT_TEX / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.55, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gr;
  c.fillRect(0, 0, DOT_TEX, DOT_TEX);
  dotTex = Texture.from(cv);
  return dotTex;
}

let warmRT: RenderTexture | null = null;

export interface StrataMap extends CityMap {
  frame: (v: MapView, t: number) => void;
  focusAt: (x: number, y: number) => MapFocus | null;
  /** One step of first-render work (tessellation, text textures) into a 1x1 target; true when all is warm. */
  warm: (renderer: Renderer) => boolean;
  destroy: () => void;
}

/** Builds the map for a layout (call again when the layout, the rooms or the locale change; see `strataMapKey`). */
export function buildStrataMap(inp: StrataMapInput): StrataMap {
  const { state, layout: L, locale, rtl } = inp;
  const loc = (locale === 'he' ? 'he' : 'en') as 'he' | 'en';
  const container = new Container();
  container.label = 'strataMap';
  container.alpha = 0;
  container.visible = false;
  // The map catches taps while it shows, so a tap on a lit window zooms to it instead of opening the room under the map.
  container.eventMode = 'static';
  const B = L.bounds;
  container.hitArea = new Rectangle(B.x - 4000, B.y - 4000, B.w + 8000, B.h + 8000);

  const reachedList = strataReached(state.currentFloors);
  const maxS = reachedList[reachedList.length - 1] ?? 0;
  const bands: Band[] = L.strata.map(b => ({ s: b.s, y0: b.y0, y1: b.y1, reached: reachedList.includes(b.s), next: b.s === maxS + 1 }));
  const n = Math.max(0, state.currentFloors | 0);
  const dugBottom = n > 0 ? floorTop(n) : 0;

  // ----------------------------------------------------------------------------------------------------------------- static
  // Three static pieces (bands; strips and rooms; shapes, spine and hubs), each its own render group, warmed one per frame (warm()).
  const pieces: Container[] = [];
  let g = new Graphics();
  const top = B.y, bottom = B.y + B.h, x0 = B.x, x1 = B.x + B.w;
  g.rect(x0, top, B.w, bottom - top).fill({ color: MAP.paper, alpha: MAP.paperAlpha });
  for (const b of bands) {
    if (b.s === 0) {
      g.rect(x0, top, B.w, Math.max(0, b.y1 - top)).fill({ color: ink(0), alpha: MAP.bandAlpha });
      continue;
    }
    const h = b.y1 - b.y0;
    if (h <= 0) continue;
    if (b.reached) g.rect(x0, b.y0, B.w, h).fill({ color: ink(b.s), alpha: b.s % 2 ? MAP.bandAlpha : MAP.bandAlpha + MAP.bandAltAlpha });
    else g.rect(x0, b.y0, B.w, h).fill({ color: b.next ? MAP.unknown : MAP.dark, alpha: 1 });
  }
  // The next stratum: a faint diagonal hatch, "known to be there".
  const next = bands.find(b => b.next);
  if (next && next.y1 > next.y0) {
    const H = next.y1 - next.y0;
    for (let x = x0 - H; x < x1; x += MAP.hatchStep) g.moveTo(Math.max(x0, x), next.y0 + Math.max(0, x0 - x)).lineTo(Math.min(x1, x + H), next.y0 + Math.min(H, x1 - x));
    g.stroke({ color: MAP.hatch, alpha: MAP.hatchAlpha, width: 2 });
  }
  // Blueprint grid over the known city (the surface to the deepest reached band).
  const reachedBottom = bands.filter(b => b.reached).reduce((m, b) => Math.max(m, b.y1), 0);
  for (let x = Math.ceil(x0 / MAP.grid) * MAP.grid; x < x1; x += MAP.grid) g.rect(x, top, 1.5, reachedBottom - top);
  g.fill({ color: MAP.gridColor, alpha: MAP.gridAlpha });
  // Seams between strata.
  for (const b of bands) {
    if (b.s < 2) continue;
    const prevReached = bands.find(o => o.s === b.s - 1)?.reached;
    g.rect(x0, b.y0 - MAP.seamW / 2, B.w, MAP.seamW).fill({ color: ink(b.reached ? b.s : b.s - 1), alpha: prevReached ? MAP.seamAlpha : MAP.seamAlpha * 0.25 });
  }
  g.rect(x0, -MAP.groundW / 2, B.w, MAP.groundW).fill({ color: MAP.ground, alpha: 0.8 });

  pieces.push(g);
  g = new Graphics();
  const byId = new Map<string, CityArea>();
  for (const a of L.areas) byId.set(a.id, a);
  const marks: Mark[] = [];

  // Galleries (dug): a dashed orange line.
  for (const a of L.areas) {
    if (a.kind !== 'gallery' || a.state !== 'revealed') continue;
    const b = polyBox(a.poly);
    dashH(g, b.x0, b.x1, (b.y0 + b.y1) / 2, 5, MAP.gallery, MAP.galleryAlpha);
  }
  // Dug storeys: lit strips.
  for (const a of L.areas) {
    if (a.kind !== 'storey' || a.state !== 'revealed') continue;
    const b = polyBox(a.poly);
    const f = Number(a.id.slice(2));
    const y = floorTop(f) + ROOM_H * MAP.stripInset, h = ROOM_H * (1 - 2 * MAP.stripInset);
    g.rect(b.x0, y, b.x1 - b.x0, h).fill({ color: ink(a.s), alpha: MAP.stripAlpha }).stroke({ color: ink(a.s), alpha: MAP.stripEdgeAlpha, width: 2 });
  }
  // Wing edges (glimpsed tunnels): a short dashed stub off the strip's end.
  for (const a of L.areas) {
    if (a.kind !== 'edge' || a.state === 'hidden') continue;
    const e = L.edges.find(x => x.id === a.id);
    if (!e) continue;
    const y = floorTop(e.floor) + ROOM_H * 0.5;
    const b = polyBox(a.poly);
    const xa = e.side === 'e' ? b.x0 + 6 : b.x1 - MAP.edgeLen - 6;
    dashH(g, xa, xa + MAP.edgeLen, y, 4, MAP.edge, 0.4);
  }
  // Rooms as windows.
  for (const bl of state.buildings) {
    if (isDistrict(bl.type) || (bl.isConstructing && bl.level === 1)) continue;
    const r = buildingRect(bl);
    const c = CATEGORY[bl.type] ?? MAP.roomDefault;
    const p = MAP.roomInset;
    g.roundRect(r.x + p, r.y + p + 2, r.w - 2 * p, r.h - 2 * p - 4, 4).fill({ color: c, alpha: MAP.roomFill }).stroke({ color: c, alpha: MAP.roomEdge, width: 2.5 });
  }
  for (const ru of state.ruins) {
    const x = slotX(ru.floor, ru.x);
    g.rect(x + 8, floorTop(ru.floor) + 14, ru.w * SLOT_W - 16, ROOM_H - 28).stroke({ color: MAP.ruin, alpha: 0.6, width: 2 });
  }
  pieces.push(g);
  g = new Graphics();
  // Districts and pockets: shapes once revealed, "?" when glimpsed, nothing when hidden.
  for (const a of L.areas) {
    if ((a.kind !== 'district' && a.kind !== 'pocket') || a.state === 'hidden') continue;
    const col = a.kind === 'pocket' ? MAP.pocket : CATEGORY[a.id.slice(2) as BuildingInstance['type']] ?? MAP.pocket;
    if (a.state === 'revealed') {
      g.poly(a.poly).fill({ color: col, alpha: MAP.districtFill }).stroke({ color: col, alpha: 0.7, width: 3 });
    } else if (a.state === 'digging') {
      g.poly(a.poly).stroke({ color: col, alpha: 0.45, width: 3 });
    } else {
      const b = polyBox(a.poly);
      marks.push(a.label ? { x: a.label.x, y: a.label.y + (a.kind === 'pocket' ? 30 : 40) } : { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
    }
  }
  // The spine: the lift shaft down to the deepest dug storey, dashed on into the dig.
  const sx = SHAFT_W / 2;
  g.rect(sx - MAP.spineGlowW / 2, SURFACE_TOP, MAP.spineGlowW, dugBottom - SURFACE_TOP).fill({ color: MAP.spine, alpha: 0.1 });
  g.rect(sx - MAP.spineW / 2, SURFACE_TOP, MAP.spineW, dugBottom - SURFACE_TOP).fill({ color: MAP.spine, alpha: MAP.spineAlpha });
  for (let y = dugBottom; y < dugBottom + ROOM_H; y += 22) g.rect(sx - MAP.spineW / 4, y, MAP.spineW / 2, 12);
  g.fill({ color: MAP.spine, alpha: MAP.spineAlpha * 0.6 });
  // Hubs: station nodes.
  for (const h of L.hubs) {
    if (!reachedList.includes(h.s)) continue;
    const cx = h.rect.x + h.rect.w / 2, cy = h.rect.y + Math.min(h.rect.h, ROOM_H * 2) / 2;
    g.circle(cx, cy, MAP.hubR + 10).fill({ color: ink(h.s), alpha: 0.12 });
    g.circle(cx, cy, MAP.hubR).fill({ color: MAP.paper, alpha: 1 }).stroke({ color: ink(h.s), alpha: 0.95, width: MAP.hubRing });
    g.circle(cx, cy, MAP.hubCore).fill({ color: ink(h.s), alpha: 0.95 });
  }
  if (next && next.y1 > next.y0) marks.push({ x: sx, y: (next.y0 + Math.min(next.y1, next.y0 + 4 * (ROOM_H + 44))) / 2 });
  pieces.push(g);
  for (const p of pieces) {
    p.isRenderGroup = true;
    container.addChild(p);
  }

  // ----------------------------------------------------------------------------------------------------------------- animated layer
  // Survivors are sprites of one dot texture (moved at MAP.animHz: no tessellation); the few digs, crises and pins are one Graphics.
  const dots = new Container();
  const dotTex = dotTexture();
  const dotPool: Sprite[] = [];
  const dyn = new Graphics();
  container.addChild(dots, dyn);

  // ----------------------------------------------------------------------------------------------------------------- markers, labels
  const markLayer = new Container();
  const qt = questionTexture();
  const markSprites: Sprite[] = [];
  for (const m of marks) {
    const s = new Sprite(qt);
    s.anchor.set(0.5);
    s.position.set(m.x, m.y);
    markLayer.addChild(s);
    markSprites.push(s);
  }
  container.addChild(markLayer);

  const labelLayer = new Container();
  const labels: Label[] = [];
  for (const b of bands) {
    if (!(b.reached || b.next)) continue;
    const root = new Container();
    const fs = MAP.labelFont;
    const badge = new Graphics();
    const num = new Text({ text: b.s === 0 ? '0' : String(b.s), style: { fontFamily: 'Rubik, sans-serif', fontSize: fs * 0.8, fontWeight: '700', fill: MAP.paper }, resolution: 2 });
    num.anchor.set(0.5);
    const name = new Text({
      text: b.reached ? STRATA[b.s]?.name[loc] ?? '' : '?',
      // No letterSpacing on Hebrew (it breaks the joining and the shaping); Latin gets a little air.
      style: { fontFamily: 'Rubik, sans-serif', fontSize: fs, fontWeight: '700', fill: b.reached ? MAP.labelText : MAP.labelUnknown, letterSpacing: loc === 'he' ? 0 : 1.5 },
      resolution: 2,
    });
    name.anchor.set(0, 0.5);
    const pad = fs * 0.4, br = fs * 0.62;
    const w = pad + br * 2 + pad + name.width + pad * 1.4, h = fs * 1.6;
    const pill = new Graphics();
    pill.roundRect(0, -h / 2, w, h, h / 2).fill({ color: MAP.labelBg, alpha: MAP.labelBgAlpha }).stroke({ color: ink(b.s), alpha: b.reached ? 0.8 : 0.35, width: 2 });
    // The badge leads in the reading direction: left of the name in LTR, right of it in RTL.
    const bx = rtl ? w - pad - br : pad + br;
    badge.circle(bx, 0, br).fill({ color: ink(b.s), alpha: b.reached ? 1 : 0.4 });
    num.position.set(bx, 1);
    name.position.set(rtl ? pad * 1.4 : pad + br * 2 + pad, 0);
    root.addChild(pill, badge, num, name);
    labelLayer.addChild(root);
    labels.push({ root, y0: b.s === 0 ? top : b.y0, y1: b.y1, w, h, surface: b.s === 0 });
  }
  container.addChild(labelLayer);

  // ----------------------------------------------------------------------------------------------------------------- per frame
  let zoom = 0.35;
  const frame = (v: MapView): void => {
    zoom = v.z;
    const k = MAP.labelPx / MAP.labelFont / v.z;
    const pad = MAP.labelPadPx / v.z;
    for (const l of labels) {
      l.root.scale.set(k);
      const lw = l.w * k, lh = l.h * k;
      // On the seam above the band (between two strata, over the service gallery, clear of the rooms), the surface's just above the
      // ground; sticky: held at the view's top (below the HUD) while the band is in view.
      // (Stratum 1's seam is the ground line, shared with the surface's label: it sits just below it.)
      const anchor = l.surface ? l.y1 - lh / 2 - pad : l.y0 === 0 ? lh / 2 + pad : l.y0;
      const y = Math.min(Math.max(anchor, v.y0 + v.insetTop + pad + lh / 2), l.y1 - lh / 2 - pad / 2);
      l.root.visible = l.y1 > v.y0 + v.insetTop && l.y0 < v.y1;
      l.root.position.set(rtl ? v.x1 - pad - lw : v.x0 + pad, y);
    }
    const ms = MAP.markPx / 64 / v.z;
    for (const s of markSprites) s.scale.set(ms);
  };

  const bById = new Map<string, BuildingInstance>();
  let bAt = -1;
  const animate = (s: GameState, t: number): void => {
    const d = dyn;
    d.clear();
    if (bAt !== s.buildings.length) {
      bAt = s.buildings.length;
      bById.clear();
      for (const b of s.buildings) bById.set(b.id, b);
    }
    const pulse = 0.5 + 0.5 * Math.sin(t * MAP.digPulse * Math.PI);
    // Construction and crises.
    for (const b of s.buildings) {
      if (!b.isConstructing) continue;
      const r = buildingRect(b);
      for (let dx = 8; dx < r.w - 8; dx += 14) d.rect(r.x + dx, r.y + r.h - 18, 8, 4);
    }
    d.fill({ color: MAP.dig, alpha: 0.5 + 0.4 * pulse });
    for (const inc of s.incidents ?? []) {
      const b = inc.buildingId ? bById.get(inc.buildingId) : undefined;
      if (!b) continue;
      const r = buildingRect(b);
      d.roundRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 6).stroke({ color: MAP.crisis, alpha: 0.35 + 0.6 * (Math.sin(t * 8) > 0 ? 1 : 0.2), width: 5 });
    }
    // Digs: the floor dig front, wing digs, districts under construction.
    const prog = cityProgress(s);
    const fArea = byId.get(`f:${n}`);
    if (fArea) {
      const cav = L.cavities.find(c => c.id === `c:dig:${n}`);
      const bx = cav ? polyBox(cav.poly) : polyBox(fArea.poly);
      const fp = prog.find(p => p.id === `f:${n}`);
      const y = floorTop(n) + 10;
      d.rect(bx.x0, y - 3, bx.x1 - bx.x0, 6).fill({ color: MAP.dig, alpha: 0.25 + 0.5 * pulse });
      if (fp) {
        const w = (bx.x1 - bx.x0) * Math.max(0, Math.min(1, fp.progress));
        d.rect(bx.x0, y + 10, bx.x1 - bx.x0, MAP.digBarH).fill({ color: MAP.paper, alpha: 0.9 }).stroke({ color: MAP.dig, alpha: 0.6, width: 2 });
        d.rect(bx.x0, y + 10, w, MAP.digBarH).fill({ color: MAP.dig, alpha: 0.9 });
        d.circle(bx.x0 + w, y + 10 + MAP.digBarH / 2, 14 + 8 * pulse).fill({ color: MAP.dig, alpha: 0.25 });
      }
    }
    for (const p of prog) {
      if (p.id.startsWith('f:')) continue;
      const a = byId.get(p.id);
      if (!a) continue;
      const at = a.label ?? (() => { const b = polyBox(a.poly); return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }; })();
      d.circle(at.x, at.y + 30, 22 + 10 * pulse).stroke({ color: MAP.dig, alpha: 0.35 + 0.4 * pulse, width: 4 });
      d.rect(at.x - 40, at.y + 62, 80, 9).fill({ color: MAP.paper, alpha: 0.9 });
      d.rect(at.x - 40, at.y + 62, 80 * Math.max(0, Math.min(1, p.progress)), 9).fill({ color: MAP.dig, alpha: 0.9 });
    }
    // Survivors: dots drifting in their rooms (the density of the city).
    let nd = 0;
    for (const sv of s.survivors) {
      if (sv.isOnMission) continue;
      const b = (sv.assignedBuildingId && bById.get(sv.assignedBuildingId)) || null;
      const seed = hashString(sv.id);
      let px: number, py: number;
      if (b) {
        const r = buildingRect(b);
        const k = 0.5 + 0.5 * Math.sin(t * (0.3 + (seed % 5) * 0.08) + seed);
        px = r.x + 12 + (r.w - 24) * k;
        py = r.y + r.h - 16 - (seed % 3) * 7;
      } else {
        // Idle people gather round the first hub (on its balconies).
        const h = L.hubs[0];
        const hx0 = h ? h.rect.x : 0, hw = h ? h.rect.w : SHAFT_W;
        px = hx0 + 8 + ((seed % 97) / 97) * (hw - 16);
        py = floorTop(seed % Math.max(1, Math.min(4, n))) + ROOM_H - 14;
      }
      let sp = dotPool[nd];
      if (!sp) {
        sp = new Sprite(dotTex);
        sp.anchor.set(0.5);
        sp.tint = MAP.dot;
        sp.alpha = 0.92;
        dotPool.push(sp);
        dots.addChild(sp);
      }
      sp.visible = true;
      sp.position.set(px, py);
      sp.scale.set(((sv.child ? MAP.dotChildR : MAP.dotR) * 2) / DOT_TEX);
      nd++;
    }
    for (let i = nd; i < dotPool.length; i++) dotPool[i].visible = false;
    // New-discovery pins (the scene's pins are hidden under the map).
    const pr = MAP.pinPx / zoom;
    for (const p of inp.pins()) {
      const y = p.y - pr * 2.2;
      d.poly([p.x, y - pr, p.x + pr, y, p.x, y + pr, p.x - pr, y]).fill({ color: PINS.color, alpha: 1 });
      d.circle(p.x, y, pr * (1.6 + 0.8 * pulse)).stroke({ color: PINS.color, alpha: 0.7 * (1 - pulse) + 0.2, width: pr * 0.35 });
    }
  };

  // ----------------------------------------------------------------------------------------------------------------- taps
  const focusAt = (x: number, y: number): MapFocus | null => {
    const near = MAP.tapPx / zoom;
    for (const m of marks) if (Math.abs(m.x - x) < near && Math.abs(m.y - y) < near) return { x: m.x, y: m.y, kind: 'place' };
    for (const p of inp.pins()) if (Math.abs(p.x - x) < near && Math.abs(p.y - y) < near * 1.6) return { x: p.x, y: p.y, kind: 'place' };
    for (let i = L.areas.length - 1; i >= 0; i--) {
      const a = L.areas[i];
      if (a.state === 'hidden' || a.kind === 'surface' || !FogLayer.contains(a, x, y)) continue;
      const b = polyBox(a.poly);
      if (a.kind === 'storey') {
        const f = Number(a.id.slice(2));
        if (a.state !== 'revealed') return { x: Math.max(b.x0, Math.min(b.x1, x)), y: floorTop(f) + ROOM_H / 2, kind: 'place' };
        return { x: Math.max(b.x0, Math.min(b.x1, x)), y: floorTop(f) + ROOM_H / 2, kind: 'place' };
      }
      if (a.kind === 'gallery') return { x, y: (b.y0 + b.y1) / 2, kind: 'place' };
      return a.label ? { x: a.label.x, y: a.label.y + 40, kind: 'place' } : { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, kind: 'place' };
    }
    const band = bands.find(b => y >= (b.s === 0 ? -Infinity : b.y0) && y < b.y1);
    if (band && band.reached) return { x, y, kind: 'band' };
    // Below what is known: the dig front.
    return { x: sx + ROOM_H, y: floorTop(n) + ROOM_H / 2, kind: 'place' };
  };

  // ----------------------------------------------------------------------------------------------------------------- warm-up
  // The first picture of a Graphics tessellates it and the first of a Text draws its texture: about 10 ms for the whole map at e55. The
  // host calls warm() once per frame while the map is not shown yet, so that work is spread over a few frames before the switch.
  const steps: (() => void)[] = [...pieces.map(p => () => warmOne(p)), ...labels.map(l => () => warmOne(l.root)), () => { warmOne(markLayer); }, () => { animate(state, 0); warmOne(dots); warmOne(dyn); }];
  let step = 0;
  let warmR: Renderer | null = null;
  const warmOne = (c: Container): void => {
    if (!warmR) return;
    warmRT ??= RenderTexture.create({ width: 1, height: 1 });
    const vis = c.visible;
    c.visible = true;
    warmR.render({ container: c, target: warmRT, clear: false });
    c.visible = vis;
  };
  const warm = (r: Renderer): boolean => {
    if (step >= steps.length) return true;
    warmR = r;
    steps[step++]();
    return step >= steps.length;
  };

  return {
    container,
    animate: (s, t) => animate(s, t),
    frame: (v, _t) => frame(v),
    focusAt,
    warm,
    destroy: () => container.destroy({ children: true }),
  };
}

/** What the map's static part depends on besides the layout object itself: rooms (count, still being built) and the locale. */
export function strataMapKey(state: GameState, locale: string): string {
  let c = 0;
  for (const b of state.buildings) if (b.isConstructing && b.level === 1) c++;
  return `${locale}|${state.currentFloors}|${state.buildings.length}|${c}|${state.ruins.length}`;
}
