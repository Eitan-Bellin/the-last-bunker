import { el, setRich } from './dom';
import { i18n } from '../i18n/I18nManager';
import { haptic } from '../utils/haptics';
import { getHudInsets } from '../utils/hudInsets';
import { MS, PX } from './kit';
import { LONG_PRESS_SLOP } from './kit/tokens';
import type { GameState, IncidentKind } from '../core/GameState';
import type { BunkerRenderer } from '../rendering/BunkerRenderer';
import { SHAFT_W, SURFACE_TOP } from '../rendering/geom';

/**
 * [ux-redesign W3b] Off-screen event arrows. When a fire, a disaster or a raid at the gate (danger), or a room with something waiting
 * (just built, upgraded or restored, a bonus bubble: ready) is outside the visible band (between the HUD and the nav), a small chip sits
 * on the screen edge pointing at it. A tap glides the camera there (the renderer's focus API) and the chip goes away.
 *
 * DOM only: the renderer is read through its public API (worldContainer transform, roomRect, hasBubble, focusOn), never edited.
 * Updates at UPDATE_MS (about 4 Hz), not every frame, and writes to the DOM only when a chip's place, kind or label changed.
 */

/** About 4 updates a second. Logic timing (when to look), not motion: stays a constant, not a token. */
export const UPDATE_MS = 250;
/** At most this many arrows at once (danger first). */
const MAX_ARROWS = 3;
/** A "ready" marker the player never looked at is forgotten after this long. */
const READY_TTL_MS = 90_000;
/** After a tap the arrow for that target stays away this long, so the glide there does not bring it back on the way. */
const TAP_QUIET_MS = 4_000;
/** More rooms than this appearing in one look is a loaded save, not a finished room: no "ready" arrows for them. */
const REBASE_AT = 4;
/** Extra px between an arrow's hit area and the band's edge (room for the wedge that points out of the chip). */
const EDGE_PAD = 8;

export type ArrowTone = 'danger' | 'ready';

interface Target {
  key: string;
  tone: ArrowTone;
  icon: string;
  label: string;
  /** World rectangle. */
  x: number; y: number; w: number; h: number;
}

export interface EdgeArrowsHost {
  renderer: BunkerRenderer;
  getState: () => GameState;
  /** True while something covers the bunker (a sheet, a dialog, placement, the tour, a story scene): no arrows then. */
  blocked: () => boolean;
  /** A click sound for the tap (the game's own audio). */
  click?: () => void;
}

const INCIDENT_ICON: Record<IncidentKind, string> = { fire: 'fire', flood: 'wave', blackout: 'plug', roaches: 'bug', breach: 'skull' };

interface Chip { btn: HTMLButtonElement; sig: string; key: string }

export class EdgeArrows {
  private readonly layer = el('div', 'edge-layer');
  private readonly chips: Chip[] = [];
  private timer = 0;
  /** Building id → was it under construction at the last look (to notice "done"). */
  private building = new Map<string, boolean>();
  private based = false;
  /** Ready markers: key → { id, icon, label, until }. */
  private ready = new Map<string, { id: string; icon: string; label: string; until: number }>();
  private quiet = new Map<string, number>();
  private layerShown = false;

  private readonly host: EdgeArrowsHost;

  constructor(host: EdgeArrowsHost) {
    this.host = host;
    this.layer.setAttribute('aria-live', 'off');
    this.layer.hidden = true;
    document.body.appendChild(this.layer);
  }

  start(): void {
    if (this.timer) return;
    this.timer = window.setInterval(() => this.update(), UPDATE_MS);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  /** One look: what is happening, what of it is off screen, and the chips for the top MAX_ARROWS. */
  update(): void {
    if (document.hidden) return;
    const state = this.host.getState();
    const now = Date.now();
    this.trackReady(state, now);
    if (this.host.blocked()) { this.showLayer(false); return; }
    const view = this.viewBand();
    const r = this.host.renderer;
    const wc = r.worldContainer;
    const z = wc.scale.x || 1;
    const picks: { t: Target; sx: number; sy: number; d: number }[] = [];
    for (const t of this.targets(state)) {
      if ((this.quiet.get(t.key) ?? 0) > now) continue;
      // World → canvas px (the container's own transform: correct whatever the camera does), then → page px.
      const x0 = view.ox + (wc.x + t.x * z) * view.k, x1 = view.ox + (wc.x + (t.x + t.w) * z) * view.k;
      const y0 = view.oy + (wc.y + t.y * z) * view.k, y1 = view.oy + (wc.y + (t.y + t.h) * z) * view.k;
      const onScreen = x1 > view.l && x0 < view.r && y1 > view.t && y0 < view.b;
      if (onScreen) {
        if (t.tone === 'ready') this.ready.delete(t.key); // seen: the marker has done its job
        continue;
      }
      const sx = (x0 + x1) / 2, sy = (y0 + y1) / 2;
      picks.push({ t, sx, sy, d: Math.hypot(sx - view.cx, sy - view.cy) });
    }
    picks.sort((a, b) => (a.t.tone === b.t.tone ? a.d - b.d : a.t.tone === 'danger' ? -1 : 1));
    const shown = picks.slice(0, MAX_ARROWS);
    this.showLayer(shown.length > 0);
    const places = shown.map(p => this.place(p, view));
    // Two targets in about the same direction would stack their chips: slide the later one along its edge, clear of the earlier ones.
    const gap = PX['hit-min'] + EDGE_PAD;
    for (let i = 1; i < places.length; i++) {
      const q = places[i];
      for (let tries = 0; tries < 4 && places.slice(0, i).some(o => Math.abs(o.x - q.x) < gap && Math.abs(o.y - q.y) < gap); tries++) {
        if (q.side) q.x = q.x + gap <= view.r - gap / 2 ? q.x + gap : q.x - gap;
        else q.y = q.y + gap <= view.pb - gap / 2 ? q.y + gap : q.y - gap;
      }
    }
    for (let i = 0; i < MAX_ARROWS; i++) {
      const p = shown[i];
      this.setChip(i, p ? { t: p.t, x: places[i].x, y: places[i].y, sx: p.sx, sy: p.sy } : null);
    }
  }

  /** Where the line from the band's centre to the target leaves the band (inset by half a hit area plus the wedge), and the angle. */
  private place(p: { sx: number; sy: number }, v: ReturnType<EdgeArrows['viewBand']>): { x: number; y: number; side: boolean } {
    const half = PX['hit-min'] / 2 + EDGE_PAD;
    const pcy = (v.t + v.pb) / 2;
    const dx = p.sx - v.cx, dy = p.sy - pcy;
    const hx = (v.r - v.l) / 2 - half, hy = (v.pb - v.t) / 2 - half;
    const sx = Math.abs(dx) > 0 ? hx / Math.abs(dx) : Infinity, sy = Math.abs(dy) > 0 ? hy / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    // side: the chip sits on the top or bottom edge (it slides along x); otherwise on a side edge (it slides along y).
    return { x: Math.round(v.cx + dx * s), y: Math.round(pcy + dy * s), side: sy <= sx };
  }

  // ---- what to point at --------------------------------------------------------------------------------------------------

  /** Rooms that just finished building or upgrading, and new rooms (a restored wreck), become "ready" markers. */
  private trackReady(state: GameState, now: number): void {
    const fresh: string[] = [];
    const seen = new Set<string>();
    for (const b of state.buildings) {
      seen.add(b.id);
      const was = this.building.get(b.id);
      if (was === undefined) fresh.push(b.id);
      else if (was && !b.isConstructing) this.markReady(b.id, b.level > 1 ? 'upgraded' : 'built', now);
      this.building.set(b.id, b.isConstructing);
    }
    for (const id of [...this.building.keys()]) if (!seen.has(id)) { this.building.delete(id); this.ready.delete(`ready:${id}`); }
    // The first look (and a loaded save) only learns what is there.
    if (this.based && fresh.length <= REBASE_AT) {
      for (const id of fresh) {
        const b = state.buildings.find(x => x.id === id);
        if (b && !b.isConstructing) this.markReady(id, 'restored', now);
      }
    }
    this.based = true;
    for (const [k, m] of this.ready) if (m.until < now) this.ready.delete(k);
  }

  private markReady(id: string, what: 'built' | 'upgraded' | 'restored', now: number): void {
    this.ready.set(`ready:${id}`, { id, icon: what === 'upgraded' ? 'up' : what === 'restored' ? 'refresh' : 'check', label: i18n.t(`ux3b.arrow.${what}`), until: now + READY_TTL_MS });
  }

  private targets(state: GameState): Target[] {
    const r = this.host.renderer;
    const out: Target[] = [];
    const room = (id: string) => r.roomRect(id);
    for (const inc of state.incidents ?? []) {
      const rr = room(inc.buildingId);
      if (rr) out.push({ key: `inc:${inc.id}`, tone: 'danger', icon: INCIDENT_ICON[inc.kind] ?? 'warning', label: i18n.t(`ux3b.arrow.${inc.kind}`), ...rr });
    }
    const d = state.danger;
    for (const dz of d?.disasters ?? []) {
      const rr = dz.buildingId ? room(dz.buildingId) : null;
      if (rr) out.push({ key: `dz:${dz.id}`, tone: 'danger', icon: 'warning', label: i18n.t('ux3b.arrow.disaster'), ...rr });
    }
    if (d?.raid) {
      // The gate: the gate post when there is one, else the entrance above the shaft.
      const post = state.buildings.find(b => b.type === 'gatePost');
      const rr = post ? room(post.id) : null;
      out.push({ key: 'raid', tone: 'danger', icon: 'gatePost', label: i18n.t('ux3b.arrow.raid'), ...(rr ?? { x: 0, y: SURFACE_TOP, w: SHAFT_W, h: -SURFACE_TOP }) });
    }
    for (const [key, m] of this.ready) {
      const rr = room(m.id);
      if (rr) out.push({ key, tone: 'ready', icon: m.icon, label: m.label, ...rr });
    }
    // A bonus waiting over a room (the bubble the player taps to collect).
    for (const b of state.buildings) {
      if (this.ready.has(`ready:${b.id}`) || !r.hasBubble(b.id)) continue;
      const rr = room(b.id);
      if (rr) out.push({ key: `bubble:${b.id}`, tone: 'ready', icon: 'sparkle', label: i18n.t('ux3b.arrow.bonus'), ...rr });
    }
    return out;
  }

  // ---- the band the arrows live on -----------------------------------------------------------------------------------------

  /** The visible world band in page px (between the HUD and the nav / objective / section chips) and the canvas → page mapping. */
  private viewBand(): { l: number; r: number; t: number; b: number; pb: number; cx: number; cy: number; ox: number; oy: number; k: number } {
    const canvas = this.host.renderer.app.canvas as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const k = rect.width / Math.max(1, this.host.renderer.app.screen.width);
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const ins = getHudInsets();
    const chips = parseFloat(document.documentElement.style.getPropertyValue('--chips-h')) || 0;
    // The "Back to the bunker" button sits on the bottom edge when shown: the arrows are placed above it (pb), visibility still uses b.
    const home = document.querySelector<HTMLElement>('.back-home:not([hidden])');
    const t = ins.top, b = vh - ins.bottom - ins.objective - chips;
    const pb = home ? Math.min(b, home.getBoundingClientRect().top) : b;
    return { l: 0, r: vw, t, b, pb, cx: vw / 2, cy: (t + b) / 2, ox: rect.left, oy: rect.top, k };
  }

  // ---- chips ---------------------------------------------------------------------------------------------------------------

  private showLayer(on: boolean): void {
    if (on === this.layerShown) return;
    this.layerShown = on;
    this.layer.hidden = !on;
  }

  private setChip(i: number, p: { t: Target; x: number; y: number; sx: number; sy: number } | null): void {
    let c = this.chips[i];
    if (!p) {
      if (c && c.sig !== '') { c.btn.hidden = true; c.sig = ''; c.key = ''; }
      return;
    }
    if (!c) c = this.chips[i] = this.makeChip();
    const { x, y } = p;
    // The wedge points from where the chip ended up (after any slide) to the target.
    const ang = Math.round((Math.atan2(p.sy - y, p.sx - x) * 180) / Math.PI / 5) * 5;
    const sig = `${p.t.key}|${p.t.tone}|${p.t.icon}|${p.t.label}|${x}|${y}|${ang}`;
    if (sig === c.sig) return;
    const b = c.btn;
    if (c.key !== p.t.key || !c.sig) {
      b.dataset.tone = p.t.tone;
      setRich(b.querySelector<HTMLElement>('.edge-arrow__icon')!, `[[${p.t.icon}]]`);
      b.setAttribute('aria-label', i18n.t('ux3b.arrow.aria', { what: p.t.label }));
      b.title = p.t.label;
    }
    b.style.setProperty('--edge-x', `${x}px`);
    b.style.setProperty('--edge-y', `${y}px`);
    b.style.setProperty('--edge-a', `${ang}deg`);
    b.hidden = false;
    c.key = p.t.key;
    c.sig = sig;
  }

  private makeChip(): Chip {
    const btn = el('button', 'edge-arrow');
    btn.type = 'button';
    btn.hidden = true;
    const pointer = el('span', 'edge-arrow__pointer');
    pointer.setAttribute('aria-hidden', 'true');
    const face = el('span', 'edge-arrow__face');
    face.setAttribute('aria-hidden', 'true');
    face.appendChild(el('span', 'edge-arrow__icon'));
    btn.append(pointer, face);
    const chip: Chip = { btn, sig: '', key: '' };
    // Action on release, like every other button (click fires on release inside the element).
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.go(chip.key);
    });
    this.layer.appendChild(btn);
    return chip;
  }

  /** Glides the camera to the target and hides its arrow. */
  private go(key: string): void {
    if (!key) return;
    const t = this.targets(this.host.getState()).find(x => x.key === key);
    if (t) this.host.renderer.focusOn(t.x + t.w / 2, t.y + Math.min(50, t.h / 2), 1.4);
    haptic('tap');
    this.host.click?.();
    this.quiet.set(key, Date.now() + TAP_QUIET_MS);
    if (key.startsWith('ready:')) this.ready.delete(key);
    for (const [k, until] of this.quiet) if (until < Date.now()) this.quiet.delete(k);
    this.update();
  }
}

// ---- [ux-redesign W3b] long press on a HUD resource tile ---------------------------------------------------------------------

/**
 * A long press (--long-press, 450 ms, the kit tooltip's timing) on a HUD resource tile opens that store's sheet (where it comes from,
 * where it goes, what to do) while the finger is still down, instead of waiting for a release that a long press often never turns into a
 * click (the phone's context gesture eats it). The click that ends the press is swallowed so the sheet does not open twice.
 * Targets the tiles by class (`.hx-res`, the kit chip's `data-resource`): HUD.ts is not touched. A plain tap keeps HUD.ts's own handler.
 */
export function installResourceLongPress(open: (resource: string) => void): void {
  let timer = 0;
  let start: { x: number; y: number; id: number } | null = null;
  let swallowUntil = 0;
  const cancel = () => { window.clearTimeout(timer); timer = 0; start = null; };
  const tileOf = (t: EventTarget | null): HTMLElement | null => (t instanceof Element ? t.closest<HTMLElement>('.hx-res') : null);
  document.addEventListener('pointerdown', (e) => {
    const tile = tileOf(e.target);
    if (!tile || e.button > 0) return;
    const res = tile.querySelector<HTMLElement>('.k-chip[data-resource]')?.dataset.resource;
    if (!res) return;
    cancel();
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    timer = window.setTimeout(() => {
      timer = 0;
      start = null;
      swallowUntil = Date.now() + 1000;
      haptic('select');
      open(res);
    }, MS['long-press']);
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP) cancel();
  }, true);
  document.addEventListener('pointerup', cancel, true);
  document.addEventListener('pointercancel', cancel, true);
  document.addEventListener('click', (e) => {
    if (Date.now() < swallowUntil && tileOf(e.target)) { swallowUntil = 0; e.stopPropagation(); e.preventDefault(); }
  }, true);
  // No system menu / text selection on a held tile.
  document.addEventListener('contextmenu', (e) => { if (tileOf(e.target)) e.preventDefault(); }, true);
}
