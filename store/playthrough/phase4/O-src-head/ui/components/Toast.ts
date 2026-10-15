import { el } from '../dom';
import { relaxedMs } from '../../utils/a11y';
import { uiSound } from '../../audio/uiSound';
import { MS } from '../kit/tokens';
import { LANE_MIN_MS, LANE_VISIBLE, nextInLane, oneIcon } from '../popupRules';

/**
 * [plan4:UX-9] Three weights of message:
 *  - info:     neutral news (3.2 s)
 *  - good:     something worked (3 s)
 *  - bad:      something went wrong / is missing (5 s). A `good` toast never pushes a `bad` one off the screen.
 *  - critical: the game itself is in trouble, e.g. it cannot save (6 s, announced assertively, never pushed off by anything lower).
 * (`bad` and `critical` are the plan's single "critical" level, split so the ~35 existing `bad` calls keep their meaning and only
 * the few that must interrupt a screen reader are `critical`.)
 */
export type ToastKind = 'info' | 'good' | 'bad' | 'critical';

const RANK: Record<ToastKind, number> = { info: 0, good: 1, bad: 2, critical: 3 };
const DURATION_MS: Record<ToastKind, number> = { info: 3200, good: 3000, bad: 5000, critical: 6000 };
/** [ux-redesign w2a #12] One notification lane: one toast on screen, the rest wait their turn (and leave sooner while others wait). */
const MAX_VISIBLE = LANE_VISIBLE;
const MAX_QUEUED = 6;
/** How often a paused lane (a room being placed) looks whether it may go on. */
const PAUSE_POLL_MS = 400;
/** [ux-redesign W1] How long a leaving toast stays in the page: the --dur-screen token (its fade is the shorter --dur-toast). */
const FADE_MS = MS['dur-toast']; // [ux-redesign W4] in and out in --dur-toast (200 ms), as the CSS transition
/** [ux-wp3 D2] Messages kept back while the bunker works through time away (the welcome report tells that story). */
const MAX_HELD = 40;
/** A sideways drag past this (px), or a quick flick, dismisses the toast. */
const SWIPE_PX = 60;
const SWIPE_SPEED = 0.5;

interface Entry {
  text: string;
  kind: ToastKind;
  count: number;
  node: HTMLDivElement | null;
  countEl: HTMLElement | null;
  timer: number;
  shownAt: number;
}

export class Toasts {
  private stack: HTMLDivElement;
  private visible: Entry[] = [];
  private queue: Entry[] = [];
  /**
   * [ux-wp3 D2/F4] While this says yes (the away catch-up is running) nothing but a `critical` message is shown: the dozens of
   * "X levelled up" / "Y finished" lines from the hours away are not lived moments. They are kept (deduplicated, counted) for the
   * return screen to summarise if it wants them (`takeHeld`).
   */
  hold: (() => boolean) | null = null;
  private held: { text: string; kind: ToastKind; count: number }[] = [];
  /** [ux-redesign w2a #12/#39] While this says yes (a room is being placed) only a `critical` message shows; the rest wait in line. */
  pause: (() => boolean) | null = null;
  private pollTimer = 0;

  constructor() {
    this.stack = el('div', 'toast-stack');
    document.body.appendChild(this.stack);
  }

  show(text: string, kind: ToastKind = 'info'): void {
    text = oneIcon(text, kind); // [ux-redesign w2a #11] the toast's style already draws the warning / check icon
    if (kind !== 'critical' && this.hold?.()) {
      const same = this.held.find(h => h.text === text && h.kind === kind);
      if (same) same.count++;
      else if (this.held.length < MAX_HELD) this.held.push({ text, kind, count: 1 });
      return;
    }
    // The same message again (a tap spammed on a button that says "not enough") is one toast with a counter, not a wall of copies:
    // [ux-redesign w2a] compared with everything on screen or waiting, since the lane is one toast wide.
    const same = [...this.visible, ...this.queue].find(e => e.text === text && e.kind === kind);
    if (same) {
      same.count++;
      if (same.node) {
        this.paintCount(same);
        if (!this.queue.length) this.arm(same); // it stays as long as it keeps being repeated (unless others wait)
      }
      return;
    }
    const entry: Entry = { text, kind, count: 1, node: null, countEl: null, timer: 0, shownAt: 0 };
    const paused = kind !== 'critical' && !!this.pause?.();
    if (this.visible.length < MAX_VISIBLE && !paused) {
      this.display(entry);
      return;
    }
    if (paused) {
      this.enqueue(entry);
      this.watchPause();
      return;
    }
    // Full. A more important message may take the place of the oldest less important one on screen; it never goes the other way.
    const victim = this.visible
      .filter(v => RANK[v.kind] < RANK[kind])
      .sort((a, b) => RANK[a.kind] - RANK[b.kind])[0];
    if (victim) {
      this.dismiss(victim, false);
      this.display(entry);
      return;
    }
    this.enqueue(entry);
    // Someone is waiting: the toast on screen leaves once it has been up long enough to be read.
    for (const v of this.visible) this.hurry(v);
  }

  private enqueue(entry: Entry): void {
    this.queue.push(entry);
    if (this.queue.length > MAX_QUEUED) {
      // Too many waiting: lose the least important (the oldest of those), which may be the one that just arrived.
      let worst = 0;
      for (let i = 1; i < this.queue.length; i++) if (RANK[this.queue[i].kind] < RANK[this.queue[worst].kind]) worst = i;
      this.queue.splice(worst, 1);
    }
  }

  /** A toast with others waiting behind it stays LANE_MIN_MS at most (never longer than its own time). */
  private hurry(e: Entry): void {
    if (e.kind === 'critical') return;
    const left = Math.max(0, e.shownAt + LANE_MIN_MS - performance.now());
    window.clearTimeout(e.timer);
    e.timer = window.setTimeout(() => this.dismiss(e, true), left);
  }

  /** [ux-redesign w2a #12] While paused: the toast on screen goes, the line waits, and it moves again when the pause ends. */
  private watchPause(): void {
    if (this.pollTimer) return;
    this.pollTimer = window.setTimeout(() => {
      this.pollTimer = 0;
      // [ux-redesign w2fix] The toast that had to make way goes back to the front of the line (it was not read yet), not away.
      if (this.pause?.()) {
        for (const v of [...this.visible]) {
          if (v.kind === 'critical') continue;
          this.dismiss(v, false);
          this.queue.unshift({ text: v.text, kind: v.kind, count: v.count, node: null, countEl: null, timer: 0, shownAt: 0 });
        }
        while (this.queue.length > MAX_QUEUED) this.queue.pop();
      }
      this.next(); // schedules the next look while still paused
    }, PAUSE_POLL_MS);
  }

  /** [ux-wp3 D2] The messages held back during the last catch-up (and forgets them). For the welcome-back report. */
  takeHeld(): { text: string; kind: ToastKind; count: number }[] {
    const out = this.held;
    this.held = [];
    return out;
  }

  private display(e: Entry): void {
    const toast = el('div', `toast ${e.kind}`);
    // The live-region role is on the toast itself: it is created (inserted) with its text, which is what makes a screen reader read it.
    const critical = e.kind === 'critical';
    toast.setAttribute('role', critical ? 'alert' : 'status');
    toast.setAttribute('aria-live', critical ? 'assertive' : 'polite');
    toast.setAttribute('aria-atomic', 'true');
    const msg = el('span', 'toast-msg', e.text);
    const count = el('span', 'toast-count');
    toast.append(msg, count);
    e.node = toast;
    e.countEl = count;
    this.paintCount(e);
    this.bindSwipe(toast, e);
    if (e.kind === 'info') uiSound('notify', 0.6, 4000);
    this.visible.push(e);
    e.shownAt = performance.now();
    this.stack.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('in'));
    this.arm(e);
  }

  private paintCount(e: Entry): void {
    // The counter is real text inside the live region, so a screen reader hears "x3" when a repeat arrives.
    if (e.countEl) e.countEl.textContent = e.count > 1 ? `×${e.count}` : '';
  }

  private arm(e: Entry): void {
    window.clearTimeout(e.timer);
    e.timer = window.setTimeout(() => this.dismiss(e, true), relaxedMs(DURATION_MS[e.kind])); // plan4:AC-13 relaxed timing: messages stay twice as long
  }

  /** Fades the toast out and lets the next waiting one in. `slide` is the direction of a swipe (px), 0 for a plain fade. */
  private dismiss(e: Entry, pump: boolean, slide = 0): void {
    const i = this.visible.indexOf(e);
    if (i < 0) return;
    this.visible.splice(i, 1);
    window.clearTimeout(e.timer);
    const node = e.node;
    if (node) {
      if (slide) node.style.setProperty('--dx', `${slide}px`);
      node.classList.remove('in');
      window.setTimeout(() => requestAnimationFrame(() => node.remove()), FADE_MS); // [w4fix] one frame after the fade, never mid-fade
    }
    // (a slot freed by a replacement goes straight to the newcomer, not to the queue)
    if (pump) this.next();
  }

  private next(): void {
    const paused = !!this.pause?.();
    while (this.visible.length < MAX_VISIBLE && this.queue.length) {
      // The most important waiting message goes first; among equals, the oldest (popupRules.nextInLane). Paused: only a critical one.
      const best = nextInLane(this.queue, paused);
      if (best < 0) break;
      this.display(this.queue.splice(best, 1)[0]);
    }
    if (paused && this.queue.length) this.watchPause();
    else for (const v of this.visible) if (this.queue.length) this.hurry(v);
  }

  /** Swipe sideways to dismiss. The toast follows the finger; a short drag springs back. */
  private bindSwipe(node: HTMLElement, e: Entry): void {
    let startX = 0;
    let startT = 0;
    let dx = 0;
    let active = false;
    node.addEventListener('pointerdown', (ev) => {
      active = true;
      startX = ev.clientX;
      startT = performance.now();
      dx = 0;
      node.classList.add('dragging');
      try { node.setPointerCapture(ev.pointerId); } catch { /* synthetic pointers cannot be captured */ }
    });
    node.addEventListener('pointermove', (ev) => {
      if (!active) return;
      dx = ev.clientX - startX;
      node.style.setProperty('--dx', `${dx.toFixed(1)}px`);
    });
    const end = () => {
      if (!active) return;
      active = false;
      node.classList.remove('dragging');
      const speed = Math.abs(dx) / Math.max(1, performance.now() - startT);
      if (Math.abs(dx) > SWIPE_PX || (Math.abs(dx) > 24 && speed > SWIPE_SPEED)) this.dismiss(e, true, dx > 0 ? window.innerWidth : -window.innerWidth);
      else node.style.setProperty('--dx', '0px');
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
  }
}
