import { i18n } from '../../i18n/I18nManager';
import { el } from '../dom';
import { kButton } from '../kit';
import { reducedMotion } from '../../utils/a11y';
import { ghostHand } from '../controllers/tips';

/** Space between the element and the edge of the cut-out (px, the --sp-2 token). */
const PAD = 8;

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
 * [ux-redesign W3a] The tutorial spotlight: a dark layer (--overlay) with a cut-out around one element, a bubble that says what to do,
 * and "Skip tutorial" always in reach. Input: four transparent blockers around the hole catch every touch except on the element itself
 * (in 'next' mode a fifth one covers the hole too). The hole follows the element every frame (sheets slide, the strip changes width).
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
    this.bubbleText.textContent = step.text;
    this.nextBox.replaceChildren();
    if (step.mode === 'next') {
      this.nextBox.appendChild(kButton({ variant: 'primary', label: step.nextLabel ?? i18n.t('ux3a.next'), onPress: () => this.handlers?.onNext?.() }));
    }
    this.skipBox.replaceChildren(kButton({
      variant: 'tertiary', className: 'btn-ghost ob-skip__btn', label: i18n.t('ux3a.skip'), onPress: () => this.handlers?.onSkip(),
    }));
    this.blockers[4].hidden = step.mode !== 'next';
    this.root.dataset.mode = step.mode;
    this.root.classList.toggle('is-still', reducedMotion());
    if (this.root.hidden) {
      this.root.hidden = false;
      requestAnimationFrame(() => this.root.classList.add('in'));
    }
    this.watchTap();
    this.place();
  }

  hide(): void {
    this.offClick?.();
    this.offClick = null;
    this.step = null;
    this.handlers = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
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

  private place = (): void => {
    this.raf = 0;
    const step = this.step;
    if (!step) return;
    const t = step.target();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    const ok = visible(t);
    this.root.classList.toggle('is-lost', !ok);
    if (ok) {
      const r = t.getBoundingClientRect();
      const x0 = Math.max(0, r.left - PAD);
      const y0 = Math.max(0, r.top - PAD);
      const x1 = Math.min(vw, r.right + PAD);
      const y1 = Math.min(vh, r.bottom + PAD);
      const box = (n: HTMLElement, x: number, y: number, w: number, h: number): void => {
        n.style.transform = `translate(${x}px, ${y}px)`;
        n.style.width = `${Math.max(0, w)}px`;
        n.style.height = `${Math.max(0, h)}px`;
      };
      box(this.hole, x0, y0, x1 - x0, y1 - y0);
      box(this.blockers[0], 0, 0, vw, y0);
      box(this.blockers[1], 0, y1, vw, vh - y1);
      box(this.blockers[2], 0, y0, x0, y1 - y0);
      box(this.blockers[3], x1, y0, vw - x1, y1 - y0);
      box(this.blockers[4], x0, y0, x1 - x0, y1 - y0);
      // The bubble goes on the side with more room, centred on the element and kept on screen.
      const bw = this.bubble.offsetWidth;
      const bh = this.bubble.offsetHeight;
      const above = y0 > vh - y1;
      const gap = PAD * 2;
      const bx = Math.min(Math.max(PAD * 2, (x0 + x1) / 2 - bw / 2), vw - bw - PAD * 2);
      const by = above ? Math.max(PAD, y0 - gap - bh) : Math.min(vh - bh - PAD, y1 + gap);
      this.bubble.style.transform = `translate(${bx}px, ${by}px)`;
      this.bubble.dataset.side = above ? 'above' : 'below';
    } else {
      // The element is not on screen (a sheet still opening): the whole screen waits, the bubble in the middle.
      for (const b of this.blockers.slice(0, 4)) { b.style.transform = 'translate(0, 0)'; b.style.width = '0'; b.style.height = '0'; }
      this.blockers[0].style.width = `${vw}px`;
      this.blockers[0].style.height = `${vh}px`;
    }
    this.raf = requestAnimationFrame(this.place);
  };
}

/**
 * [ux-redesign W3a] The idle hint: the tip cards' ghost finger tapping on an element, or (reduced motion) a still ring around it.
 * Never takes a touch (pointer-events: none).
 */
export class IdleHand {
  private node: HTMLElement | null = null;
  private target: HTMLElement | null = null;
  private raf = 0;

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
  }

  private follow = (): void => {
    const n = this.node;
    const t = this.target;
    if (!n || !t) return;
    if (!visible(t)) { this.hide(); return; }
    const r = t.getBoundingClientRect();
    if (n.classList.contains('ob-ring')) {
      n.style.transform = `translate(${r.left - PAD / 2}px, ${r.top - PAD / 2}px)`;
      n.style.width = `${r.width + PAD}px`;
      n.style.height = `${r.height + PAD}px`;
    } else {
      // The finger lands on the middle of the element.
      n.style.transform = `translate(${r.left + r.width / 2 - n.offsetWidth / 2}px, ${r.top + r.height / 2 - n.offsetHeight / 2}px)`;
    }
    this.raf = requestAnimationFrame(this.follow);
  };
}
