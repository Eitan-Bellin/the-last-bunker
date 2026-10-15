import { el } from '../dom';
import { uiSound } from '../../audio/uiSound';
import { setInert, trapTab } from '../a11yDom';
import { kButton } from '../kit';
import { dismissIndex, tapBlocked } from '../popupRules';

export interface ModalAction {
  label: string;
  className?: string;
  disabled?: boolean;
  detail?: HTMLElement;
  /** [ux-redesign W1] Why a disabled choice cannot be taken (shown when it is pressed anyway). */
  disabledReason?: string;
  onClick: () => void;
}

export interface ModalOptions {
  icon?: string;
  title: string;
  body: string | HTMLElement;
  actions: ModalAction[];
  /** Called once when this dialog goes away: closed, or replaced by another one. */
  onDismiss?: () => void;
  /**
   * [ux-redesign w2a] The choice that Escape and the phone's back button press. Default: the only choice of a one-button (info) dialog;
   * 'none' for a decision that needs an explicit answer. Dialogs with several choices name theirs ("Later").
   */
  dismiss?: number | 'none';
}

/**
 * Centered dialog that requires an explicit choice; backdrop taps don't dismiss it. [ux-redesign w2a] A dialog that just opened (or whose
 * content was just replaced) ignores taps for MODAL_TAP_GUARD_MS, and an info dialog closes with Escape / back (`dismiss`).
 */
export class Modal {
  private overlay: HTMLDivElement;
  private box: HTMLDivElement;
  private dismiss: (() => void) | null = null;
  private scroll: HTMLDivElement | null = null;
  private shownTitle = '';
  /** [plan4:AC-8] Page parts made inert while the dialog is up (and only those it made inert), and what had the focus before it. */
  private inerted: Element[] = [];
  private opener: HTMLElement | null = null;
  /** [ux-redesign w2a] When the current content appeared, and the button back / Escape presses (null: a decision). */
  private openedAt = 0;
  private dismissBtn: HTMLButtonElement | null = null;
  /** [ux-redesign w2fix B2] Watches the story scene this dialog waits behind (null: not waiting). */
  private storyWatch: MutationObserver | null = null;

  constructor() {
    this.overlay = el('div', 'modal-overlay');
    this.box = el('div', 'modal');
    // [plan4:AC-8] An alert dialog: it needs an answer (the backdrop does not dismiss it), so a screen reader reads it out at once.
    this.box.setAttribute('role', 'alertdialog');
    this.box.setAttribute('aria-modal', 'true');
    this.overlay.appendChild(this.box);
    document.body.appendChild(this.overlay);
    this.overlay.addEventListener('keydown', (e) => trapTab(e, [this.box]));
    // [ux-redesign w2a #20] Escape belongs to the dialog while one is up (a sheet under it stays open); a decision ignores it.
    // [ux-redesign w2fix] Not while it waits behind a story scene: the scene has the keys then.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.isVisible || this.storyWatch) return;
      e.preventDefault();
      e.stopPropagation();
      this.back();
    }, { capture: true });
    // [ux-redesign w2a #4] A tap that lands right after the dialog appeared was meant for what was there before: swallow it.
    this.overlay.addEventListener('click', (e) => {
      if (tapBlocked(this.openedAt, performance.now(), e.detail)) { e.preventDefault(); e.stopPropagation(); }
    }, { capture: true });
  }

  /** [ux-redesign w2a #20] The open dialog has a choice that back / Escape may press (an info dialog, or one with a "Later"). */
  get canDismiss(): boolean {
    return this.isVisible && !!this.dismissBtn?.isConnected;
  }

  /** [ux-redesign w2a #20] Escape / the phone's back button: presses the dismiss choice of an info dialog. False for a decision. */
  back(): boolean {
    const b = this.dismissBtn;
    if (!this.isVisible || !b || !b.isConnected) return false;
    b.click();
    return true;
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

    // [ux-redesign W1] Kit buttons: pressed feedback, action on release, double-tap guard, and a disabled choice explains itself.
    const makeButton = (a: ModalAction): HTMLButtonElement => {
      const cls = a.className ?? 'btn-primary';
      return kButton({
        variant: cls.includes('btn-primary') ? 'primary' : 'secondary',
        className: cls,
        label: a.label,
        detail: a.detail,
        disabledReason: a.disabled ? a.disabledReason ?? '' : null,
        haptics: false,
        stopPropagation: false,
        onPress: () => {
          uiSound(cls.includes('btn-primary') || cls.includes('btn-danger') ? 'confirm' : 'cancel', 0.8);
          a.onClick();
        },
      });
    };
    const pinnedFrom = opts.actions.length > 3 ? opts.actions.length - 1 : 0;
    // [ux-redesign w2fix] Every choice in order, straight from makeButton (a body that brings its own buttons cannot shift the index).
    const buttons: HTMLButtonElement[] = [];
    if (pinnedFrom > 0) {
      const list = el('div', 'modal-actions');
      for (const a of opts.actions.slice(0, pinnedFrom)) {
        const b = makeButton(a);
        buttons.push(b);
        list.appendChild(b);
      }
      scroll.appendChild(list);
    }
    const actions = el('div', 'modal-actions');
    for (const a of opts.actions.slice(pinnedFrom)) {
      const b = makeButton(a);
      buttons.push(b);
      actions.appendChild(b);
    }
    const di = dismissIndex(opts.actions, opts.dismiss);
    this.dismissBtn = di === null ? null : buttons[di] ?? null;
    this.openedAt = performance.now();

    this.scroll = scroll;
    this.box.replaceChildren(scroll, actions);
    scroll.scrollTop = keepScroll;
    if (!this.isVisible) {
      uiSound('modalOpen', 0.8, 300);
      this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // Everything else on the page (the HUD, the canvas, the sheets) leaves the tab order and the screen reader while the dialog is up.
      // [ux-redesign w2fix B2] A story scene on screen (z 60, over this dialog's z 40) is never made inert: the dialog waits behind it.
      for (const n of [...document.body.children]) {
        if (n === this.overlay || n.tagName === 'SCRIPT' || n.matches('.toast-stack, .sr-only, #splash, .story-overlay.open') || (n as HTMLElement).inert || n.hasAttribute('aria-hidden')) continue;
        setInert(n, true);
        this.inerted.push(n);
      }
    }
    this.overlay.classList.add('open');
    const story = document.querySelector<HTMLElement>('.story-overlay.open');
    if (story) this.waitBehind(story);
    else this.focusFirst();
  }

  /** Keyboard and screen-reader users land on the first choice. */
  private focusFirst(): void {
    this.box.querySelector<HTMLButtonElement>('.modal-actions button:not(:disabled):not([aria-disabled="true"])')?.focus({ preventScroll: true });
  }

  /**
   * [ux-redesign w2fix B2] A dialog opened while a story scene plays stays hidden (no taps, no focus, no Escape) until the scene closes;
   * then it shows, its tap guard starts again, and its first choice takes the focus.
   */
  private waitBehind(story: HTMLElement): void {
    if (this.storyWatch) return;
    this.overlay.classList.add('is-held');
    this.storyWatch = new MutationObserver(() => {
      if (story.classList.contains('open') && story.isConnected) return;
      this.release();
      if (!this.isVisible) return;
      this.openedAt = performance.now();
      this.focusFirst();
      // the scene itself was left out of the inert walk at show(): take it (and anything new) out now that this dialog is on top
      for (const n of [...document.body.children]) {
        if (n === this.overlay || this.inerted.includes(n) || n.tagName === 'SCRIPT' || n.matches('.toast-stack, .sr-only, #splash, .story-overlay.open') || (n as HTMLElement).inert || n.hasAttribute('aria-hidden')) continue;
        setInert(n, true);
        this.inerted.push(n);
      }
    });
    this.storyWatch.observe(story, { attributes: true, attributeFilter: ['class'] });
  }

  private release(): void {
    this.storyWatch?.disconnect();
    this.storyWatch = null;
    this.overlay.classList.remove('is-held');
  }

  hide(): void {
    this.release();
    this.dismissBtn = null;
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
