import { el } from '../dom';
import { uiSound } from '../../audio/uiSound';
import { setInert, trapTab } from '../a11yDom';

export interface ModalAction {
  label: string;
  className?: string;
  disabled?: boolean;
  detail?: HTMLElement;
  onClick: () => void;
}

export interface ModalOptions {
  icon?: string;
  title: string;
  body: string | HTMLElement;
  actions: ModalAction[];
  /** Called once when this dialog goes away: closed, or replaced by another one. */
  onDismiss?: () => void;
}

/** Centered dialog that requires an explicit choice; backdrop taps don't dismiss it. */
export class Modal {
  private overlay: HTMLDivElement;
  private box: HTMLDivElement;
  private dismiss: (() => void) | null = null;
  private scroll: HTMLDivElement | null = null;
  private shownTitle = '';
  /** [plan4:AC-8] Page parts made inert while the dialog is up (and only those it made inert), and what had the focus before it. */
  private inerted: Element[] = [];
  private opener: HTMLElement | null = null;

  constructor() {
    this.overlay = el('div', 'modal-overlay');
    this.box = el('div', 'modal');
    // [plan4:AC-8] An alert dialog: it needs an answer (the backdrop does not dismiss it), so a screen reader reads it out at once.
    this.box.setAttribute('role', 'alertdialog');
    this.box.setAttribute('aria-modal', 'true');
    this.overlay.appendChild(this.box);
    document.body.appendChild(this.overlay);
    this.overlay.addEventListener('keydown', (e) => trapTab(e, [this.box]));
  }

  show(opts: ModalOptions): void {
    // A dialog that is replaced counts as dismissed, so whoever opened it can clear its own "I am open" flag.
    const previous = this.dismiss;
    this.dismiss = opts.onDismiss ?? null;
    previous?.();
    // [plan4:UX-3] The same dialog shown again while open (a toggle list) keeps its scroll position instead of jumping to the top.
    const keepScroll = this.isVisible && this.shownTitle === opts.title ? this.scroll?.scrollTop ?? 0 : 0;
    this.shownTitle = opts.title;
    // Everything above the buttons scrolls; the (last) buttons stay pinned. Many choices (mutators, scenarios) scroll with the text
    // and only the last, main button is pinned, so a long list can never push the way out of the screen.
    const scroll = el('div', 'modal-scroll');
    if (opts.icon) scroll.appendChild(el('div', 'modal-icon', opts.icon));
    const title = el('h2', 'modal-title', opts.title);
    title.id = 'modal-title';
    this.box.setAttribute('aria-labelledby', title.id);
    scroll.appendChild(title);
    const bodyNode = typeof opts.body === 'string' ? el('p', 'modal-body', opts.body) : opts.body;
    bodyNode.id = 'modal-body';
    this.box.setAttribute('aria-describedby', bodyNode.id);
    scroll.appendChild(bodyNode);

    const makeButton = (a: ModalAction): HTMLButtonElement => {
      const btn = el('button', `btn ${a.className ?? 'btn-primary'}`);
      btn.appendChild(el('span', '', a.label));
      if (a.detail) btn.appendChild(a.detail);
      btn.disabled = !!a.disabled;
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const cls = a.className ?? 'btn-primary';
        uiSound(cls.includes('btn-primary') || cls.includes('btn-danger') ? 'confirm' : 'cancel', 0.8);
        a.onClick();
      });
      return btn;
    };
    const pinnedFrom = opts.actions.length > 3 ? opts.actions.length - 1 : 0;
    if (pinnedFrom > 0) {
      const list = el('div', 'modal-actions');
      for (const a of opts.actions.slice(0, pinnedFrom)) list.appendChild(makeButton(a));
      scroll.appendChild(list);
    }
    const actions = el('div', 'modal-actions');
    for (const a of opts.actions.slice(pinnedFrom)) actions.appendChild(makeButton(a));

    this.scroll = scroll;
    this.box.replaceChildren(scroll, actions);
    scroll.scrollTop = keepScroll;
    if (!this.isVisible) {
      uiSound('modalOpen', 0.8, 300);
      this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // Everything else on the page (the HUD, the canvas, the sheets) leaves the tab order and the screen reader while the dialog is up.
      for (const n of [...document.body.children]) {
        if (n === this.overlay || n.tagName === 'SCRIPT' || n.matches('.toast-stack, .sr-only, #splash') || (n as HTMLElement).inert || n.hasAttribute('aria-hidden')) continue;
        setInert(n, true);
        this.inerted.push(n);
      }
    }
    this.overlay.classList.add('open');
    // Keyboard and screen-reader users land on the first choice.
    this.box.querySelector<HTMLButtonElement>('.modal-actions button:not(:disabled)')?.focus({ preventScroll: true });
  }

  hide(): void {
    this.overlay.classList.remove('open');
    for (const n of this.inerted) setInert(n, false);
    this.inerted = [];
    const back = this.opener;
    this.opener = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
    const done = this.dismiss;
    this.dismiss = null;
    done?.();
  }

  get isVisible(): boolean {
    return this.overlay.classList.contains('open');
  }
}
