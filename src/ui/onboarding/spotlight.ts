import { i18n } from '../../i18n/I18nManager';
import { el } from '../dom';
import { kButton, PX } from '../kit';
import { dropInert, holdInert, shouldInert } from '../inertOwners';
import { reducedMotion } from '../../utils/a11y';
import { ghostHand } from '../controllers/tips';

/** Space between the element and the edge of the cut-out (px): the --sp-2 token, through the kit's PX mirror. */
const PAD = PX['sp-2'];

export interface SpotStep {
  /** The element to cut out (looked up every frame: sheets re-render). */
  target: () => HTMLElement | null;
  /** At most eight words. */
  text: string;
  /** 'tap': only the target responds and the step ends when it is tapped. 'next': nothing under the overlay responds; a button goes on. */
  mode: 'tap' | 'next';
  nextLabel?: string;
}

export interface SpotHandlers {
  onTap?: () => void;
  onNext?: () => void;
  onSkip: () => void;
}

const visible = (n: HTMLElement | null): n is HTMLElement => {
  if (!n || !n.isConnected) return false;
  const r = n.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/**
 * [ux-redesign final F1] Body-level parts the spotlight's walk leaves live besides inertOwners.NEVER_INERT (dialogs, story, lore,
 * toasts, ceremonies, its own layer): the idle hand. A dialog layer must never be inerted here: one that opened over a step stayed
 * dead for the rest of the session.
 */
const KEEP_LIVE = '.ob-hand';

/** The nearest ancestor that scrolls (a sheet's body), or null. */
const scrollParent = (n: HTMLElement): HTMLElement | null => {
  for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
};

/**
 * [ux-redesign W3a] The tutorial spotlight: a dark layer (--overlay) with a cut-out around one element, a bubble that says what to do,
 * and "Skip tutorial" always in reach. Input: four transparent blockers around the hole catch every touch except on the element itself
 * (in 'next' mode a fifth one covers the hole too). The hole follows the element every frame (sheets slide, the strip changes width).
 *
 * [ux-redesign w3fix] The frame loop only reads: it writes the layout when the target's rectangle or the viewport changed, and measures
 * the bubble only when its text changed (it used to write every frame: 60 DOM mutations a second). Keyboard: while it is up everything
 * but the target (and the spotlight itself) is inert, so Tab + Enter cannot reach a nav tab past it; restored when it goes.
 */
export class Spotlight {
  private root: HTMLElement;
  private hole: HTMLElement;
  private blockers: HTMLElement[];
  private bubble: HTMLElement;
  private bubbleText: HTMLElement;
  private nextBox: HTMLElement;
  private skipBox: HTMLElement;
  private step: SpotStep | null = null;
  private handlers: SpotHandlers | null = null;
  private raf = 0;
  private offClick: (() => void) | null = null;
  /** The last layout written (target rectangle + viewport); '' forces the next frame to write. */
  private sig = '';
  /** The bubble's size, measured when its text (or the viewport) changes. */
  private bubbleSize: { w: number; h: number } | null = null;
  private skipRect: DOMRect | null = null;
  private side = '';
  private lost: boolean | null = null;
  /** [final F3] The target was scrolled clear of the bottom nav once for this step. */
  private scrolled = false;
  private rawSig = '';
  /** Nodes made inert, and for which target ('all' = everything but the spotlight). */
  private inerted: Element[] = [];
  private inertFor: HTMLElement | 'all' | null = null;

  constructor() {
    this.root = el('div', 'ob-spot');
    this.root.hidden = true;
    this.hole = el('div', 'ob-spot__hole');
    this.hole.setAttribute('aria-hidden', 'true');
    this.blockers = [0, 1, 2, 3, 4].map(() => {
      const b = el('div', 'ob-spot__block');
      // Swallow touches outside the target (no click-through to the bunker or the HUD).
      for (const t of ['pointerdown', 'pointerup', 'click'] as const) b.addEventListener(t, e => { e.preventDefault(); e.stopPropagation(); });
      return b;
    });
    this.bubble = el('div', 'ob-bubble');
    this.bubble.setAttribute('role', 'status');
    this.bubble.setAttribute('aria-live', 'polite');
    this.bubbleText = el('p', 'ob-bubble__text');
    this.nextBox = el('div', 'ob-bubble__actions');
    this.bubble.append(this.bubbleText, this.nextBox);
    this.skipBox = el('div', 'ob-skip');
    this.root.append(this.hole, ...this.blockers, this.bubble, this.skipBox);
    document.body.appendChild(this.root);
  }

  get isVisible(): boolean {
    return !this.root.hidden;
  }

  /** The element in the cut-out now (for the idle hand). */
  get targetEl(): HTMLElement | null {
    return this.step?.target() ?? null;
  }

  show(step: SpotStep, handlers: SpotHandlers): void {
    this.step = step;
    this.handlers = handlers;
    if (this.bubbleText.textContent !== step.text) this.bubbleText.textContent = step.text;
    this.nextBox.replaceChildren();
    if (step.mode === 'next') {
      this.nextBox.appendChild(kButton({ variant: 'primary', label: step.nextLabel ?? i18n.t('ux3a.next'), onPress: () => this.handlers?.onNext?.() }));
    }
    this.skipBox.replaceChildren(kButton({
      variant: 'tertiary', className: 'btn-ghost ob-skip__btn', label: i18n.t('ux3a.skip'), onPress: () => this.handlers?.onSkip(),
    }));
    this.blockers[4].hidden = step.mode !== 'next';
    this.root.dataset.mode = step.mode;
    // Reduced motion: the ring around the cut-out stays still (onboarding.css stops its breathing).
    this.root.classList.toggle('is-still', reducedMotion());
    if (this.root.hidden) {
      this.root.hidden = false;
      requestAnimationFrame(() => this.root.classList.add('in'));
    }
    // New text or buttons: measure the bubble again and write the layout on the next look.
    this.bubbleSize = null;
    this.sig = '';
    this.scrolled = false;
    this.watchTap();
    cancelAnimationFrame(this.raf);
    this.place();
  }

  hide(): void {
    // [ux-redesign final F8] Called every tick while the screen is busy: an already hidden spotlight writes nothing.
    if (this.root.hidden && !this.step && !this.inerted.length) return;
    this.offClick?.();
    this.offClick = null;
    this.step = null;
    this.handlers = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.sig = '';
    this.lost = null;
    this.releaseInert();
    this.root.classList.remove('in');
    this.root.hidden = true;
  }

  /** A tap that reaches the target ends a 'tap' step (after the target's own handler ran). */
  private watchTap(): void {
    this.offClick?.();
    const onClick = (e: MouseEvent): void => {
      const step = this.step;
      if (!step || step.mode !== 'tap') return;
      const t = step.target();
      if (!t || !(e.target instanceof Node) || !t.contains(e.target)) return;
      const h = this.handlers;
      window.setTimeout(() => h?.onTap?.(), 0);
    };
    document.addEventListener('click', onClick, { capture: true });
    this.offClick = () => document.removeEventListener('click', onClick, { capture: true });
  }

  // ---- keyboard: the rest of the page is inert ------------------------------------------------------------------------------

  /** Makes everything inert except the path to `keep` (null: everything but the spotlight). */
  private inertAround(keep: HTMLElement | null): void {
    const want = keep ?? 'all';
    if (this.inertFor === want) return;
    this.releaseInert();
    this.inertFor = want;
    const path = new Set<Element>();
    for (let n: Element | null = keep; n && n !== document.body; n = n.parentElement) path.add(n);
    const walk = (parent: Element): void => {
      for (const c of [...parent.children]) {
        if (path.has(c)) { if (c !== keep) walk(c); continue; }
        if (!shouldInert(c, KEEP_LIVE)) continue;
        if (holdInert(c, 'spotlight')) this.inerted.push(c);
      }
    };
    walk(document.body);
  }

  /** Lets go of exactly what the walk held (inertOwners): a part a dialog or a sheet also holds stays inert until they let go too. */
  private releaseInert(): void {
    for (const n of this.inerted) dropInert(n, 'spotlight');
    this.inerted = [];
    this.inertFor = null;
  }

  // ---- layout ---------------------------------------------------------------------------------------------------------------

  private box(n: HTMLElement, x: number, y: number, w: number, h: number): void {
    n.style.transform = `translate(${x}px, ${y}px)`;
    n.style.width = `${Math.max(0, w)}px`;
    n.style.height = `${Math.max(0, h)}px`;
  }

  private place = (): void => {
    this.raf = 0;
    const step = this.step;
    if (!step) return;
    this.raf = requestAnimationFrame(this.place);
    const t = step.target();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    const ok = visible(t);
    // Keyboard: the target stays reachable in a 'tap' step; a 'next' step (or a target not on screen) leaves only the spotlight.
    this.inertAround(ok && step.mode === 'tap' ? t : null);
    let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
    if (ok) {
      let r = t.getBoundingClientRect();
      // [ux-redesign final F3] A target under the bottom nav (a sheet's button on a short screen): scroll its sheet once so it sits
      // above the nav; if it still cannot clear it, the cut-out covers only the part that shows.
      const nav = document.querySelector<HTMLElement>('.hud-bottom');
      const navTop = nav && !nav.contains(t) && nav.getClientRects().length ? nav.getBoundingClientRect().top : vh;
      // Only once the element has stopped moving (a sheet still sliding in is below the nav for a moment).
      const raw = `${Math.round(r.top)}|${Math.round(r.bottom)}`;
      const still = raw === this.rawSig;
      this.rawSig = raw;
      if (r.bottom > navTop && still && !this.scrolled) {
        this.scrolled = true;
        const sc = scrollParent(t);
        if (sc) { sc.scrollTop += Math.ceil(r.bottom - navTop + PAD * 2); r = t.getBoundingClientRect(); }
      }
      const bottom = Math.min(vh, navTop);
      x0 = Math.round(Math.max(0, r.left - PAD));
      y0 = Math.round(Math.max(0, r.top - PAD));
      x1 = Math.round(Math.min(vw, r.right + PAD));
      y1 = Math.round(Math.min(bottom, r.bottom + PAD));
      if (y1 <= y0) y1 = Math.round(Math.min(vh, r.bottom + PAD)); // nothing shows above the nav: point at the element itself
    }
    const sig = `${ok ? 1 : 0}|${x0}|${y0}|${x1}|${y1}|${vw}|${vh}`;
    if (sig === this.sig && this.bubbleSize) return; // nothing moved: no writes
    const resized = !this.sig.endsWith(`|${vw}|${vh}`);
    this.sig = sig;
    if (this.lost !== !ok) { this.lost = !ok; this.root.classList.toggle('is-lost', !ok); }
    if (!ok) {
      // The element is not on screen (a sheet still opening): the whole screen waits, the bubble in the middle.
      for (const b of this.blockers.slice(1, 4)) this.box(b, 0, 0, 0, 0);
      this.box(this.blockers[0], 0, 0, vw, vh);
      return;
    }
    this.box(this.hole, x0, y0, x1 - x0, y1 - y0);
    this.box(this.blockers[0], 0, 0, vw, y0);
    this.box(this.blockers[1], 0, y1, vw, vh - y1);
    this.box(this.blockers[2], 0, y0, x0, y1 - y0);
    this.box(this.blockers[3], x1, y0, vw - x1, y1 - y0);
    this.box(this.blockers[4], x0, y0, x1 - x0, y1 - y0);
    // The bubble goes on the side with more room, centred on the element and kept on screen. Measured only when its text or the
    // viewport changed (a read of offsetWidth after the writes above would force a layout every frame).
    if (!this.bubbleSize || resized) {
      this.bubbleSize = { w: this.bubble.offsetWidth, h: this.bubble.offsetHeight };
      this.skipRect = this.skipBox.getBoundingClientRect();
    }
    const { w: bw, h: bh } = this.bubbleSize;
    const above = y0 > vh - y1;
    const gap = PAD * 2;
    const bx = Math.min(Math.max(PAD * 2, (x0 + x1) / 2 - bw / 2), vw - bw - PAD * 2);
    let by = above ? Math.max(PAD, y0 - gap - bh) : Math.min(vh - bh - PAD, y1 + gap);
    // Below a target at the top (the bell), the bubble must not sit on "Skip tutorial": it goes under it.
    if (!above && this.skipRect && by < this.skipRect.bottom && by + bh > this.skipRect.top && bx < this.skipRect.right && bx + bw > this.skipRect.left) {
      by = Math.min(vh - bh - PAD, this.skipRect.bottom + PAD);
    }
    this.bubble.style.transform = `translate(${Math.round(bx)}px, ${Math.round(by)}px)`;
    const side = above ? 'above' : 'below';
    if (this.side !== side) { this.side = side; this.bubble.dataset.side = side; }
  };
}

/**
 * [ux-redesign W3a] The idle hint: the tip cards' ghost finger tapping on an element, or (reduced motion) a still ring around it.
 * Never takes a touch (pointer-events: none). [w3fix] Follows the element every frame but writes only when its rectangle changed.
 */
export class IdleHand {
  private node: HTMLElement | null = null;
  private target: HTMLElement | null = null;
  private raf = 0;
  private sig = '';
  private size: { w: number; h: number } | null = null;

  get isVisible(): boolean {
    return !!this.node;
  }

  show(target: HTMLElement): void {
    this.hide();
    this.target = target;
    const still = reducedMotion();
    const node = still ? el('div', 'ob-ring') : ghostHand('dbltap', 'ob-hand');
    if (!still) node.appendChild(el('span', 'ob-hand__glyph', '[[hand]]'));
    node.setAttribute('aria-hidden', 'true');
    document.body.appendChild(node);
    this.node = node;
    requestAnimationFrame(() => node.classList.add('in'));
    this.follow();
  }

  hide(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.node?.remove();
    this.node = null;
    this.target = null;
    this.sig = '';
    this.size = null;
  }

  private follow = (): void => {
    const n = this.node;
    const t = this.target;
    if (!n || !t) return;
    if (!visible(t)) { this.hide(); return; }
    this.raf = requestAnimationFrame(this.follow);
    const r = t.getBoundingClientRect();
    const sig = `${Math.round(r.left)}|${Math.round(r.top)}|${Math.round(r.width)}|${Math.round(r.height)}`;
    if (sig === this.sig) return;
    this.sig = sig;
    if (n.classList.contains('ob-ring')) {
      n.style.transform = `translate(${Math.round(r.left - PAD / 2)}px, ${Math.round(r.top - PAD / 2)}px)`;
      n.style.width = `${Math.round(r.width + PAD)}px`;
      n.style.height = `${Math.round(r.height + PAD)}px`;
    } else {
      // The finger lands on the middle of the element (its own size measured once).
      this.size ??= { w: n.offsetWidth, h: n.offsetHeight };
      n.style.transform = `translate(${Math.round(r.left + r.width / 2 - this.size.w / 2)}px, ${Math.round(r.top + r.height / 2 - this.size.h / 2)}px)`;
    }
  };
}
