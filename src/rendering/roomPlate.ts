import { CanvasTextMetrics, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { LABEL_SCREEN_PX, type LabelState } from './LabelScale';
import { ROOM_STATUS_COLOR, type RoomStatus } from './roomStatus';

/**
 * [clean:0] What the clean front puts on a room (store/playthrough/clean0/BRIEF.md, the prototype tools/viewproto.html):
 *   frame  a thin dark edge round the painting, so neighbouring rooms read as separate cards (static, always on)
 *   plate  the room's name at the bottom-start on a dark fade, and ONE status dot in the top-end corner (normal zoom only)
 * Built once per room view; the name text changes only when the locale / name changes or the zoom asks for a shorter cut, the dot only
 * when the status moves (a tint write). The sizes are screen sizes: the name is NAME_PX css px tall at any zoom (times the player's text
 * size), never wider than its own room (cut with an ellipsis, or left out when not even two letters fit).
 */

/** The calm tone between the rooms and floors of the clean front (the prototype's rock colour; the city shell's calm sheet, cityWiring.ts). */
export const CALM_COLOR = 0x161512;

/** Name height on the glass (css px) at the designed text size; the brief asks for at least 12 on a 375 px phone. */
const NAME_PX = 13;
/** Inset of the name and the dot from the room's edges, css px. */
const PAD_PX = 5;
/** World units of a room's side edges that the piers between rooms stand over (airyArt PIER_W up to 20, half on each room): the name stays clear of them. */
const PIER_INSET = 9;
/** Status dot radius, css px (the prototype's 14 px dot with its border). */
const DOT_PX = 5.5;
/** The dark fade under the name: from this share of the room's height down, to FADE_ALPHA at the floor. */
const FADE_FROM = 0.6;
const FADE_ALPHA = 0.78;
const FADE_STEPS = 8;

const nameStyle = new TextStyle({
  fontFamily: 'Rubik, sans-serif', fontSize: 10, fontWeight: '700', fill: 0xffffff,
  dropShadow: { color: 0x000000, alpha: 0.85, blur: 1.5, distance: 0.6, angle: Math.PI / 2 },
});

export interface RoomPlate {
  /** Static dark edge, mounted under the people. */
  frame: Graphics;
  /** Fade + name + dot: mounted in the label layer (over the structure in front of the rooms: piers, stair towers), placed on the room by the owner. */
  root: Container;
  name: Text;
  dot: Graphics;
  /** The whole name, and the budget (text units) the shown cut was made for. */
  full: string;
  budget: number;
  status: RoomStatus | '';
  w: number;
  h: number;
}

export function buildRoomPlate(w: number, h: number): RoomPlate {
  const frame = new Graphics();
  frame.rect(0.75, 0.75, w - 1.5, h - 1.5).stroke({ color: 0x050505, alpha: 0.85, width: 1.5 });
  frame.rect(2, 2, w - 4, h - 4).stroke({ color: 0x000000, alpha: 0.3, width: 1.5 });
  frame.eventMode = 'none';
  const root = new Container();
  root.eventMode = 'none';
  root.label = 'plate';
  // The fade: stepped bands (a gradient would be a texture of its own and break the room's batch).
  const fade = new Graphics();
  const y0 = h * FADE_FROM, step = (h - y0) / FADE_STEPS;
  for (let i = 0; i < FADE_STEPS; i++) {
    const t = (i + 1) / FADE_STEPS;
    fade.rect(0, y0 + i * step, w, step + 0.5).fill({ color: 0x000000, alpha: FADE_ALPHA * t * t });
  }
  const name = new Text({ text: '', style: nameStyle, resolution: Math.min(window.devicePixelRatio || 1, 2) * 2 });
  const dot = new Graphics();
  dot.circle(0, 0, DOT_PX).fill(0xffffff).stroke({ color: 0x000000, alpha: 0.65, width: 1.6 });
  root.addChild(fade, name, dot);
  return { frame, root, name, dot, full: '', budget: -1, status: '', w, h };
}

export function setPlateName(p: RoomPlate, name: string): void {
  if (p.full === name) return;
  p.full = name;
  p.budget = -1;
}

export function setPlateStatus(p: RoomPlate, s: RoomStatus): void {
  if (p.status === s) return;
  p.status = s;
  p.dot.tint = ROOM_STATUS_COLOR[s];
}

/** The longest cut of `full` (letters + an ellipsis) no wider than `budget` text units; '' when fewer than two letters fit. */
function cutToFit(full: string, budget: number): string {
  if (CanvasTextMetrics.measureText(full, nameStyle).width <= budget) return full;
  const chars = Array.from(full);
  let lo = 2, hi = chars.length - 1, best = '';
  while (lo <= hi) {
    const n = (lo + hi) >> 1;
    const s = `${chars.slice(0, n).join('').trimEnd()}…`;
    if (CanvasTextMetrics.measureText(s, nameStyle).width <= budget) { best = s; lo = n + 1; } else hi = n - 1;
  }
  return best;
}

/** Puts the plate at the screen size of the current zoom (LabelScale). Its visibility is the owner's (normal zoom, room on screen). */
export function stylePlate(p: RoomPlate, ls: LabelState, rtl: boolean): void {
  if (ls.mode !== 'full') return;
  const z = ls.zoom;
  // ls.k draws a 10-unit text LABEL_SCREEN_PX tall (with the player's text size); the name wants NAME_PX, and never more than a quarter of the room.
  const k = Math.min((ls.k * NAME_PX) / LABEL_SCREEN_PX, (p.h * 0.25) / 10);
  const pad = PAD_PX / z;
  const padX = Math.max(pad, PIER_INSET);
  const budget = (p.w - 2 * padX) / k;
  if (Math.abs(budget - p.budget) > Math.max(1, p.budget * 0.03)) {
    p.budget = budget;
    const s = cutToFit(p.full, budget);
    if (p.name.text !== s) p.name.text = s;
  }
  p.name.visible = p.name.text.length > 0;
  p.name.scale.set(k);
  p.name.anchor.set(rtl ? 1 : 0, 1);
  p.name.position.set(rtl ? p.w - padX : padX, p.h - pad * 0.7);
  const ds = 1 / z;
  p.dot.scale.set(ds);
  const r = DOT_PX * ds;
  // The dot sits in the top corner at the inline end (top-left in Hebrew, top-right in English), like the prototype's.
  p.dot.position.set(rtl ? padX + r : p.w - padX - r, pad + r);
}
