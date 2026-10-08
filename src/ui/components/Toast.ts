import { el } from '../dom';
import { relaxedMs } from '../../utils/a11y';
import { uiSound } from '../../audio/uiSound';

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
/** On screen at once, and how many more may wait their turn. */
const MAX_VISIBLE = 3;
const MAX_QUEUED = 6;
const FADE_MS = 300;
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
}

export class Toasts {
  private stack: HTMLDivElement;
  private visible: Entry[] = [];
  private queue: Entry[] = [];

  constructor() {
    this.stack = el('div', 'toast-stack');
    document.body.appendChild(this.stack);
  }

  show(text: string, kind: ToastKind = 'info'): void {
    // The same message again right after itself (a tap spammed on a button that says "not enough") is one toast with a counter,
    // not a wall of copies: compare with the newest one, waiting or showing.
    const last = this.queue[this.queue.length - 1] ?? this.visible[this.visible.length - 1];
    if (last && last.text === text && last.kind === kind) {
      last.count++;
      if (last.node) {
        this.paintCount(last);
        this.arm(last); // it stays as long as it keeps being repeated
      }
      return;
    }
    const entry: Entry = { text, kind, count: 1, node: null, countEl: null, timer: 0 };
    if (this.visible.length < MAX_VISIBLE) {
      this.display(entry);
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
    this.queue.push(entry);
    if (this.queue.length > MAX_QUEUED) {
      // Too many waiting: lose the least important (the oldest of those), which may be the one that just arrived.
      let worst = 0;
      for (let i = 1; i < this.queue.length; i++) if (RANK[this.queue[i].kind] < RANK[this.queue[worst].kind]) worst = i;
      this.queue.splice(worst, 1);
    }
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
      window.setTimeout(() => node.remove(), FADE_MS);
    }
    // (a slot freed by a replacement goes straight to the newcomer, not to the queue)
    if (pump) this.next();
  }

  private next(): void {
    while (this.visible.length < MAX_VISIBLE && this.queue.length) {
      // The most important waiting message goes first; among equals, the oldest.
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) if (RANK[this.queue[i].kind] > RANK[this.queue[best].kind]) best = i;
      this.display(this.queue.splice(best, 1)[0]);
    }
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
