import type { GameState } from '../core/GameState';
import { floorExtent } from '../core/GameState';
import type { BunkerRenderer } from '../rendering/BunkerRenderer';
import { BASE_EAST, ROOM_H, SLOT_W, floorTop, slotX } from '../rendering/layout';
import { ROW_X0, ROW_X1 } from '../rendering/surfaceRow';
import { reducedMotion } from '../utils/a11y';
import { i18n } from '../i18n/I18nManager';
import { el } from './dom';
import '../styles/tour.css';

/**
 * [plan4:GP-6] Tour mode: the camera visits points of interest by itself on a clean screen: a room with people, an incident, someone
 * talking, the lift, the gate house, the newest wing. Each stop lasts 7-9 seconds counting the glide; a tap anywhere (or any key) ends it.
 * Meanwhile the picture rate is capped at 20 fps and the screen is kept awake where the browser allows it (Screen Wake Lock, iOS 16.4+).
 * Under reduced motion the camera cuts from stop to stop (CameraController.tourPath does that).
 *
 * The camera work is CameraController.tourPath (one stop at a time, so each stop is chosen from the live state when it comes up).
 */

type Stop = 'people' | 'incident' | 'talk' | 'lift' | 'gate' | 'wing';
const ORDER: Stop[] = ['people', 'incident', 'talk', 'lift', 'gate', 'wing'];
/** Seconds a stop is held once the camera has arrived; the glide (about 1.5 s) comes on top, so a stop takes 7-9 s. */
const DWELL_MIN = 5.5;
const DWELL_SPAN = 2;
export const TOUR_FPS = 20;

export interface TourDeps {
  renderer: BunkerRenderer;
  getState: () => GameState;
  /** Caps (or, with null, frees) the picture rate. */
  setFrameCap: (fps: number | null) => void;
  /** Something else wants the player now (a dialog, a sheet, the story): the tour gives way. */
  interrupted: () => boolean;
  /** The tour has ended (for any reason). */
  onEnd?: () => void;
}

interface WakeSentinel { release(): Promise<void>; addEventListener?: (t: string, f: () => void) => void }

export class TourMode {
  private deps: TourDeps;
  private on = false;
  private round = 0;
  private shield: HTMLButtonElement | null = null;
  private watch = 0;
  private wake: WakeSentinel | null = null;
  private onVisible = (): void => { if (this.on && !document.hidden) void this.lockScreen(); };
  // Any key ends the tour: the game's key shortcuts (B, P, R, L ...) would otherwise open panels behind the clean screen.
  // (Not in the first moments: the Enter that pressed "Start tour" is still bubbling up to the document.)
  private onKey = (): void => { if (performance.now() - this.startedAt > 400) this.stop(); };
  private startedAt = 0;

  constructor(deps: TourDeps) {
    this.deps = deps;
  }

  get active(): boolean {
    return this.on;
  }

  start(): void {
    if (this.on) return;
    this.on = true;
    this.round = 0;
    this.startedAt = performance.now();
    document.body.classList.add('tour-on');
    // One full-screen button: it takes every tap (so nothing underneath is touched) and is the tag "tap to exit".
    const shield = el('button', 'tour-shield');
    shield.type = 'button';
    shield.setAttribute('aria-label', i18n.t('tour.exitLabel'));
    shield.append(el('span', 'tour-tag', i18n.t('tour.exit')));
    shield.addEventListener('click', () => this.stop());
    shield.addEventListener('wheel', () => this.stop(), { passive: true });
    document.body.appendChild(shield);
    shield.focus({ preventScroll: true });
    this.shield = shield;
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisible);
    this.deps.setFrameCap(TOUR_FPS);
    void this.lockScreen();
    // The first 1.5 s are left alone: the menu that started the tour is still sliding away (its panel counts as open until it is gone).
    this.watch = window.setInterval(() => { if (performance.now() - this.startedAt > 1500 && this.deps.interrupted()) this.stop(); }, 500);
    void this.run();
  }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    document.body.classList.remove('tour-on');
    this.shield?.remove();
    this.shield = null;
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.clearInterval(this.watch);
    this.deps.renderer.camera.cancelTour();
    this.deps.setFrameCap(null);
    void this.wake?.release().catch(() => undefined);
    this.wake = null;
    this.deps.onEnd?.();
  }

  /** Keeps the screen awake while touring, where the browser has the Screen Wake Lock API. Refused or missing: the tour just runs. */
  private async lockScreen(): Promise<void> {
    try {
      const api = (navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<WakeSentinel> } }).wakeLock;
      if (!api || this.wake) return;
      const lock = await api.request('screen');
      if (!this.on) { void lock.release().catch(() => undefined); return; } // the tour ended while the browser was answering
      this.wake = lock;
      lock.addEventListener?.('release', () => { if (this.wake === lock) this.wake = null; }); // the browser lets go when the page is hidden
    } catch {
      // low battery, a hidden page or no permission: no wake lock, nothing else changes
    }
  }

  private async run(): Promise<void> {
    const cam = this.deps.renderer.camera;
    while (this.on) {
      const spot = this.nextSpot();
      const dwell = (DWELL_MIN + Math.random() * DWELL_SPAN + (reducedMotion() ? 1.5 : 0)) * 1000;
      // false = the player took the camera (a touch) or something else moved it: the tour is over.
      const finished = await cam.tourPath([spot], dwell);
      if (!finished) { this.stop(); return; }
    }
  }

  /** The next stop from the live state: the next kind in the round that has a place to go, or a look at the whole bunker. */
  private nextSpot(): { x: number; y: number; z: number } {
    const n = this.round++;
    const cycle = Math.floor(n / ORDER.length);
    for (let k = 0; k < ORDER.length; k++) {
      const spot = this.spotFor(ORDER[(n + k) % ORDER.length], cycle + k);
      if (spot) {
        this.round = n + k + 1;
        return spot;
      }
    }
    const sp = this.deps.renderer.floorSpan;
    return { x: (sp.l + sp.r) / 2, y: floorTop(1), z: this.deps.renderer.camera.overviewZoom() };
  }

  /** A zoom that fits `width` world px into 90% of the screen, kept between 0.6 (the picture gets too small) and 2.2 (people get blurry). */
  private zoomFor(width: number): number {
    return Math.max(0.6, Math.min(2.2, (this.deps.renderer.app.screen.width * 0.9) / width));
  }

  private spotFor(kind: Stop, cycle: number): { x: number; y: number; z: number } | null {
    const r = this.deps.renderer;
    const st = this.deps.getState();
    const roomSpot = (id: string, min: number): { x: number; y: number; z: number } | null => {
      const rc = r.roomRect(id);
      return rc ? { x: rc.x + rc.w / 2, y: rc.y + rc.h / 2, z: this.zoomFor(Math.max(rc.w, min) + 40) } : null;
    };
    switch (kind) {
      case 'people': {
        // Rooms with someone at work, the busiest first; later rounds take the next one.
        const crew = new Map<string, number>();
        for (const s of st.survivors) if (s.assignedBuildingId && !s.isOnMission) crew.set(s.assignedBuildingId, (crew.get(s.assignedBuildingId) ?? 0) + 1);
        const rooms = [...crew.entries()].filter(([id]) => r.roomRect(id)).sort((a, b) => b[1] - a[1]);
        return rooms.length ? roomSpot(rooms[cycle % rooms.length][0], 140) : null;
      }
      case 'incident': {
        const list = (st.incidents ?? []).filter(i => r.roomRect(i.buildingId));
        return list.length ? roomSpot(list[cycle % list.length].buildingId, 140) : null;
      }
      case 'talk': {
        const p = r.talkingSpot(cycle);
        return p ? { x: p.x, y: p.y, z: this.zoomFor(190) } : null;
      }
      case 'lift': {
        const p = r.liftSpot();
        return p ? { x: p.x + 40, y: p.y, z: this.zoomFor(190) } : null;
      }
      case 'gate': {
        // The gate-house room when one stands; else the surface row once it is open; before that there is nothing to see.
        const post = st.buildings.find(b => b.type === 'gatePost' && !b.isConstructing);
        if (post) return roomSpot(post.id, 140);
        if (st.layout?.surfaceOpen) return { x: (ROW_X0 + ROW_X1) / 2, y: floorTop(-1) + ROOM_H / 2, z: this.zoomFor(ROW_X1 - ROW_X0 + 40) };
        return null;
      }
      case 'wing': {
        // The widest wing (west, or east past the classic 12 slots); a later round visits the next widest.
        const wings: { f: number; mid: number; width: number }[] = [];
        for (const k of Object.keys(st.layout?.ext ?? {})) {
          const f = Number(k);
          if (!Number.isFinite(f) || f < 0) continue;
          const ex = floorExtent(st, f);
          if (ex.w > 0) wings.push({ f, mid: (slotX(-ex.w) + slotX(0)) / 2, width: ex.w * SLOT_W });
          if (ex.e > BASE_EAST) wings.push({ f, mid: (slotX(BASE_EAST) + slotX(ex.e)) / 2, width: (ex.e - BASE_EAST) * SLOT_W });
        }
        wings.sort((a, b) => b.width - a.width || b.f - a.f);
        const w = wings[cycle % Math.max(1, wings.length)];
        return w ? { x: w.mid, y: floorTop(w.f) + ROOM_H / 2, z: this.zoomFor(Math.min(w.width, 420) + 60) } : null;
      }
    }
  }
}
