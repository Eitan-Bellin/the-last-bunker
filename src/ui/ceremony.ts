import { reducedMotion } from '../utils/a11y';
import { haptic, type HapticKind } from '../utils/haptics';
import { el } from './dom';
import { i18n } from '../i18n/I18nManager';
import { buildingH, buildingX, floorTop, slotX, SLOT_W } from '../rendering/geom';
import { floorExtent, type BuildingInstance } from '../core/GameState';
import { roomSlots } from '../data/buildingDefs';
import type { Sfx } from '../audio/sfx';
import { hudBottom, hudTop } from '../rendering/CameraController';
import { lotCenter } from '../rendering/projectSites'; // [ux-wp3 R4]
import type { GameApp } from '../app';

/**
 * [plan4:GP-2] Ceremonies: the few moments that deserve more than a toast. A small queue, one moment at a time, skippable with a tap,
 * and tied to the dialog gate (GameApp.ceremonyActive: no dialog opens over a moment). The pictures are cheap by design: CSS shapes that
 * move only by transform and opacity, plus the renderer's own small burst (`burstAt`, <= 2 extra draw calls) and floating icons, so a
 * ceremony adds at most a handful of draw calls. Under reduced motion every moment becomes a still card (sound and haptics stay) and
 * the camera does not travel for it. Nothing flashes: opacity ramps are slow and never go to full white.
 */
export type CeremonyKind = 'build' | 'roomLevel' | 'research' | 'person' | 'act' | 'dig' | 'death' | 'genesis'
  // [ux-wp3 R4/F15/F2] A charter project's stage or completion, an achievement, and the moment the raiders reach the gate.
  | 'project' | 'achievement' | 'raid';

export interface CeremonySpec {
  kind: CeremonyKind;
  /** The room it is about (build, level-up, the laboratory of a research). */
  roomId?: string;
  /** The person it is about (level-up, death). */
  personId?: string;
  /** Card text. A card is shown for research, death and genesis, and for every moment under reduced motion. */
  title?: string;
  sub?: string;
  icon?: string;
  /** More lines (the Genesis montage). */
  lines?: string[];
  /** A dug floor, and the side of a wing. */
  floor?: number;
  side?: 'w' | 'e';
  /** How many moments of this kind were folded into this one. */
  n?: number;
  /** [ux-wp3] The charter project (its lot on the surface is where the camera goes). */
  projectId?: string;
  /** [ux-wp3 F2] The raid was beaten off (cheer) or not (crumble); undefined when the bunker hid (no outcome sound). */
  win?: boolean;
  /** Replaces the usual sound (a power plant has its own start-up). */
  sound?: Sfx;
  /** At the peak of the moment (the Act's banner opens here); also runs when the moment is skipped. */
  beat?: () => void;
}

interface Def {
  /** Length of the moment (ms). */
  ms: number;
  /** Who stays in a crowded queue (higher). */
  prio: number;
  /** A dimmed layer that takes the tap (deaths and Genesis), instead of a tap anywhere that also reaches the game. */
  block?: boolean;
  sound: Sfx;
  haptic: { kind: HapticKind; at: number }[];
  /** When the beat callback fires. */
  beatAt?: number;
}

export const CEREMONIES: Record<CeremonyKind, Def> = {
  build: { ms: 1600, prio: 35, sound: 'complete', haptic: [{ kind: 'success', at: 0 }] },
  roomLevel: { ms: 1200, prio: 30, sound: 'levelup', haptic: [{ kind: 'success', at: 0 }] },
  research: { ms: 1400, prio: 40, sound: 'research', haptic: [{ kind: 'success', at: 0 }] },
  // [ux-wp3 D1/F5] Its own small sound (two knocks and a bell), no longer the shop's 'coin'.
  person: { ms: 900, prio: 10, sound: 'rankUp', haptic: [{ kind: 'tap', at: 0 }] },
  act: { ms: 4500, prio: 90, sound: 'era', haptic: [{ kind: 'success', at: 0 }, { kind: 'success', at: 260 }], beatAt: 1500 },
  dig: { ms: 2000, prio: 50, sound: 'dig', haptic: [{ kind: 'success', at: 0 }] },
  // 'lore' (soft bells over a low pad) stands in for the mourning tone.
  // Not blocking: a death in the middle of a fire must not swallow the player's next tap (it still ends the moment).
  death: { ms: 3000, prio: 70, sound: 'lore', haptic: [{ kind: 'warning', at: 0 }] },
  // [ux-wp3 R4] A project stage or the whole project: the camera goes to its lot, dust and stars, a card with what it was.
  project: { ms: 3200, prio: 80, sound: 'achievement', haptic: [{ kind: 'success', at: 0 }, { kind: 'success', at: 260 }] },
  // [ux-wp3 F15] A badge card at the top with the count ("Achievement · 12/28").
  achievement: { ms: 1600, prio: 45, sound: 'achievement', haptic: [{ kind: 'success', at: 0 }] },
  // [ux-wp3 F2] The raiders reach the gate: siren, the camera at the entrance, the impact (a shake, sparks, a soft warm flash).
  raid: { ms: 2600, prio: 85, sound: 'siren', haptic: [{ kind: 'warning', at: 0 }, { kind: 'error', at: 900 }] },
  genesis: { ms: 6000, prio: 100, block: true, sound: 'era', haptic: [{ kind: 'success', at: 0 }, { kind: 'success', at: 900 }, { kind: 'success', at: 1800 }] },
};

/** The queue never holds more than this many waiting moments (the least important are dropped). */
const MAX_WAITING = 3;
/** A still card stays this long under reduced motion (Genesis waits longer: it is a summary to read). */
const STATIC_MS = 1600;
const STATIC_GENESIS_MS = 4000;

interface Item {
  spec: CeremonySpec;
  resolve: () => void;
}

export class Ceremonies {
  private app: GameApp;
  private queue: Item[] = [];
  private current: { item: Item; root: HTMLElement; end: (skipped: boolean) => void } | null = null;

  constructor(app: GameApp) {
    this.app = app;
  }

  /** A moment is on screen or waiting. */
  get active(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  /**
   * Adds a moment. Returns a promise that resolves when it has played (or was dropped or skipped). While the bunker catches up on time
   * away, or the page is hidden, nothing is shown: those moments were not lived.
   */
  fire(spec: CeremonySpec): Promise<void> {
    if (document.hidden || this.app.engine.awayRunning) {
      spec.beat?.(); // a beat is something the game waits for (the Act's card): it still happens
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      const item: Item = { spec, resolve };
      // Several of the same small moment (five people leveling up, a raid taking three lives) become one with a count.
      const same = this.queue.find(q => q.spec.kind === spec.kind && (spec.kind === 'person' || spec.kind === 'death' || spec.kind === 'roomLevel'));
      if (same) {
        same.spec.n = (same.spec.n ?? 1) + (spec.n ?? 1);
        resolve();
        return;
      }
      this.queue.push(item);
      // A crowded queue keeps the important ones: drop the least important waiting moment.
      while (this.queue.length > MAX_WAITING) {
        let low = 0;
        this.queue.forEach((q, i) => { if (CEREMONIES[q.spec.kind].prio < CEREMONIES[this.queue[low].spec.kind].prio) low = i; });
        if (CEREMONIES[this.queue[low].spec.kind].prio >= 90) break;
        const [gone] = this.queue.splice(low, 1);
        gone.spec.beat?.();
        gone.resolve();
      }
      this.hold();
      if (!this.current) this.next();
    });
  }

  /** A tap: the moment on screen ends now, and the small ones waiting behind it are dropped (the big ones still play). */
  skip(): void {
    this.queue = this.queue.filter(q => {
      if (CEREMONIES[q.spec.kind].prio >= 90) return true;
      q.spec.beat?.();
      q.resolve();
      return false;
    });
    this.current?.end(true);
  }

  /** Keeps the dialog gate shut for the length of what is on screen and what waits. */
  private hold(): void {
    let ms = 0;
    if (this.current) ms += 400;
    for (const q of this.queue) ms += this.length(q.spec);
    this.app.ceremonyUntil = Math.max(this.app.ceremonyUntil, performance.now() + ms + 300);
  }

  private length(spec: CeremonySpec): number {
    const d = CEREMONIES[spec.kind];
    if (!reducedMotion()) return d.ms;
    return spec.kind === 'genesis' ? STATIC_GENESIS_MS : spec.kind === 'act' ? 400 : Math.min(d.ms, STATIC_MS);
  }

  private next(): void {
    const item = this.queue.shift();
    if (!item) {
      this.current = null;
      // The gate opens a moment after the last one, not at the very instant (a dialog should not pop up under the finger that just skipped).
      this.app.ceremonyUntil = performance.now() + 250;
      return;
    }
    this.play(item);
  }

  // ---- one moment -----------------------------------------------------------------------------------------------------------

  private play(item: Item): void {
    const spec = item.spec;
    const def = CEREMONIES[spec.kind];
    const calm = reducedMotion();
    const ms = this.length(spec);
    const timers: number[] = [];
    const later = (fn: () => void, at: number): void => { timers.push(window.setTimeout(fn, at)); };
    const undo: (() => void)[] = [];

    const root = el('div', `ceremony cer-${spec.kind}${def.block ? ' block' : ''}${calm ? ' still' : ''}`);
    root.setAttribute('aria-hidden', spec.kind === 'genesis' ? 'false' : 'true');
    if (spec.kind === 'genesis') root.setAttribute('role', 'status');
    document.body.appendChild(root);

    // Sound and the buzz at the start (a power plant brings its own sound; a merged moment plays once).
    this.app.audio.play(spec.sound ?? def.sound);
    if (spec.kind === 'build' && !spec.sound) later(() => this.app.audio.play('hiss', { volume: 0.6 }), 260);
    for (const h of def.haptic) { if (h.at === 0) haptic(h.kind); else later(() => haptic(h.kind), h.at); }

    // The card: always still, always readable. Shown for research, death and Genesis, and for every kind under reduced motion.
    const wantsCard = calm || spec.kind === 'research' || spec.kind === 'death' || spec.kind === 'genesis' || spec.kind === 'project' || spec.kind === 'achievement';
    if (wantsCard && spec.kind !== 'act' && (spec.title || spec.lines)) root.appendChild(this.card(spec));

    let beatDone = false;
    const beat = (): void => { if (!beatDone) { beatDone = true; spec.beat?.(); } };

    if (!calm) this.decorate(spec, root, later, undo);

    // Tap anywhere ends the moment; for a blocking one the tap stays here, for the rest it also reaches the game.
    const onTap = (e: Event): void => {
      if (def.block) { e.preventDefault(); e.stopPropagation(); }
      this.skip();
    };
    if (def.block) root.addEventListener('pointerdown', onTap);
    else document.addEventListener('pointerdown', onTap, { capture: true, passive: true });
    undo.push(() => document.removeEventListener('pointerdown', onTap, { capture: true }));

    if (def.beatAt !== undefined) later(beat, calm ? 200 : def.beatAt);

    const end = (skipped: boolean): void => {
      if (this.current?.item !== item) return;
      this.current = null;
      timers.forEach(t => window.clearTimeout(t));
      undo.forEach(u => u());
      beat();
      root.classList.add('out');
      window.setTimeout(() => root.remove(), skipped || calm ? 0 : 260);
      item.resolve();
      this.next();
    };
    this.current = { item, root, end };
    this.hold();
    later(() => end(false), ms);
  }

  private card(spec: CeremonySpec): HTMLElement {
    const c = el('div', 'cer-card');
    // Folded moments say so: "5 workers leveled up", "We remember the 3 we lost".
    const many = (spec.n ?? 1) > 1;
    const title = many && spec.kind === 'person' ? i18n.t('cer.person.many', { n: spec.n ?? 1 }) : many && spec.kind === 'death' ? i18n.t('cer.deathMany', { n: spec.n ?? 1 }) : spec.title;
    const sub = many && spec.kind === 'person' ? undefined : spec.sub;
    if (spec.kind === 'achievement') c.style.top = '9%'; // [ux-wp3 F15] a badge near the top, out of the bunker's middle
    if (spec.icon) c.appendChild(el('div', 'cer-icon', spec.icon));
    if (title) c.appendChild(el('div', 'cer-title', title));
    if (sub) c.appendChild(el('div', 'cer-sub', sub));
    if (spec.lines) {
      const ul = el('ul', 'cer-lines');
      spec.lines.forEach((l, i) => {
        const li = el('li', '', l);
        li.style.setProperty('--i', String(i));
        ul.appendChild(li);
      });
      c.appendChild(ul);
    }
    if (spec.kind === 'death' || spec.kind === 'genesis') c.appendChild(el('div', 'cer-hint', i18n.t('cer.tapSkip')));
    return c;
  }

  // ---- the pictures (full motion only) ----------------------------------------------------------------------------------------

  private roomOf(spec: CeremonySpec): BuildingInstance | undefined {
    return spec.roomId ? this.app.state.buildings.find(b => b.id === spec.roomId) : undefined;
  }

  /** The room's rectangle in world coordinates, from the layout (it needs no room view, so a room out of sight works too). */
  private rectOf(b: BuildingInstance): { x: number; y: number; w: number; h: number } {
    return { x: buildingX(b), y: floorTop(b.position.floor), w: roomSlots(b.type) * SLOT_W, h: buildingH(b.type) };
  }

  /** World -> screen with the world container's current transform. */
  private toScreen(x: number, y: number): { x: number; y: number } {
    const wc = this.app.renderer.worldContainer;
    return { x: wc.x + x * wc.scale.x, y: wc.y + y * wc.scale.y };
  }

  /** Keeps an element on a world rectangle while the camera moves (one transform write per picture, only while a moment plays). */
  private track(node: HTMLElement, rect: () => { x: number; y: number; w: number; h: number }, undo: (() => void)[]): void {
    let raf = 0;
    const tick = (): void => {
      const r = rect();
      const a = this.toScreen(r.x, r.y);
      const z = this.app.renderer.worldContainer.scale.x;
      // A room out of the picture (under the HUD bands) gets no shape: it would hang over the navigation.
      const mid = a.y + (r.h * z) / 2;
      node.style.visibility = mid > hudTop() && mid < window.innerHeight - hudBottom() ? '' : 'hidden';
      node.style.width = `${r.w * z}px`;
      node.style.height = `${r.h * z}px`;
      node.style.transform = `translate(${a.x}px, ${a.y}px)`;
      raf = requestAnimationFrame(tick);
    };
    tick();
    undo.push(() => cancelAnimationFrame(raf));
  }

  /** The camera may travel only when the player is not busy with it. */
  private cameraFree(): boolean {
    return !this.app.placementMode && !this.app.renderer.cameraMoving && !this.app.anyPanelOpen();
  }

  /** Glides to a world point and, after `holdMs`, back to where the player had it (unless they took the camera meanwhile). */
  private visit(x: number, y: number, zoomBoost: number, holdMs: number, later: (fn: () => void, at: number) => void): void {
    const cam = this.app.renderer.camera;
    const back = { x: cam.camX, y: cam.camY, z: cam.zoom };
    cam.focusTo(x, y, Math.max(cam.zoom, cam.baseZoom * zoomBoost));
    later(() => { if (this.cameraFree()) cam.focusTo(back.x, back.y, back.z); }, holdMs);
  }

  private decorate(spec: CeremonySpec, root: HTMLElement, later: (fn: () => void, at: number) => void, undo: (() => void)[]): void {
    const r = this.app.renderer;
    const room = this.roomOf(spec);
    switch (spec.kind) {
      case 'build': {
        if (!room) break;
        const rect = this.rectOf(room);
        // The scaffold: gold corner brackets that rise over the room.
        const frame = el('div', 'cer-frame');
        frame.append(el('i', 'tl'), el('i', 'tr'), el('i', 'bl'), el('i', 'br'));
        root.appendChild(frame);
        this.track(frame, () => this.rectOf(room), undo);
        const c = { x: rect.x + rect.w / 2, y: rect.y + rect.h * 0.55 };
        r.burstAt(c.x, c.y, rect.w, 8); // eight sparks
        if (this.cameraFree()) this.visit(c.x, c.y - 10, 1.5, 1100, later);
        break;
      }
      case 'roomLevel': {
        if (!room) break;
        const ring = el('div', 'cer-ring');
        root.appendChild(ring);
        this.track(ring, () => this.rectOf(room), undo);
        const rect = this.rectOf(room);
        this.app.popups.spawn(rect.x + rect.w / 2, rect.y + 14, `[[up]] ${room.level}`, 0xffd27a);
        break;
      }
      case 'research': {
        // The laboratory warms up: a glow that rises and settles (never a flash).
        const lab = room ?? this.app.state.buildings.find(b => b.type === 'laboratory' && !b.isConstructing);
        if (!lab) break;
        const glow = el('div', 'cer-glow');
        root.appendChild(glow);
        this.track(glow, () => this.rectOf(lab), undo);
        break;
      }
      case 'person': {
        const p = spec.personId ? r.personPos(spec.personId) : null;
        if (p) r.floatIcons(p.x, p.y, 'star', Math.min(5, 2 + (spec.n ?? 1)), '#ffe27a');
        break;
      }
      case 'act': {
        // The camera steps back to show the whole bunker, then returns when the banner is closed (the beat opens it).
        if (!this.cameraFree()) break;
        const cam = r.camera;
        const s = this.app.state;
        const top = floorTop(0), bottom = floorTop(Math.max(1, s.currentFloors));
        cam.focusTo(cam.camX, (top + bottom) / 2, cam.overviewZoom());
        break;
      }
      case 'dig': {
        if (spec.floor === undefined) break;
        const s = this.app.state;
        const ext = floorExtent(s, spec.floor);
        const x = spec.side === 'w' ? slotX(-ext.w) : spec.side === 'e' ? slotX(ext.e) : slotX(0) + SLOT_W * 3;
        const y = floorTop(spec.floor) + 50;
        // The work light opens at the new edge: a warm wedge that widens, held, then faded.
        const light = el('div', 'cer-light');
        root.appendChild(light);
        this.track(light, () => ({ x: spec.side === 'w' ? x - 90 : x, y: y - 50, w: 90, h: 100 }), undo);
        r.burstAt(x, y, 120, 8);
        r.floatIcons(x, y, 'pick', 3, '#ffd27a');
        if (this.cameraFree()) this.visit(x, y, 1.4, 1500, later);
        break;
      }
      case 'death': {
        // A slow dimming (never below 65% brightness), a candle, a line of remembrance.
        root.appendChild(el('div', 'cer-dim'));
        const candle = el('div', 'cer-candle');
        candle.append(el('i', 'flame'), el('i', 'wax'));
        root.appendChild(candle);
        break;
      }
      case 'genesis':
        root.appendChild(el('div', 'cer-dim'));
        break;
      case 'project': {
        // [ux-wp3 R4] The camera goes up to the lot, dust rises and stars float over it (the card says what was finished).
        const c = spec.projectId ? lotCenter(spec.projectId) : null;
        if (!c) break;
        if (this.cameraFree()) this.visit(c.x, c.y, 1.2, 2400, later);
        later(() => { r.burstAt(c.x, c.y + 20, 160, 26); r.floatIcons(c.x, c.y - 10, 'star', 6, '#ffd27a'); }, 500);
        break;
      }
      case 'raid': {
        // [ux-wp3 F2] At the gate: the siren is already sounding; at the impact the picture shakes, sparks fly at the door,
        // and a soft warm flash (never white, never above 30%) passes over the screen.
        const gate = { x: slotX(0) + SLOT_W, y: floorTop(0) + 30 };
        if (this.cameraFree()) this.visit(gate.x, gate.y - 20, 1.25, 2200, later);
        later(() => {
          r.shake(5, 0.6);
          r.burstAt(gate.x, gate.y, 90, 10);
          const flash = el('div', 'cer-flash');
          flash.style.cssText = 'position:absolute;inset:0;background:rgba(255,196,120,1);opacity:0;pointer-events:none';
          root.appendChild(flash);
          flash.animate([{ opacity: 0 }, { opacity: 0.28, offset: 0.25 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' });
        }, 900);
        later(() => r.burstAt(gate.x + 24, gate.y - 6, 70, 8), 1250);
        if (spec.win !== undefined) later(() => this.app.audio.play(spec.win ? 'cheer' : 'crumble'), 1700);
        break;
      }
    }
  }
}
