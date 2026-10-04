import { el } from '../dom';
import { uiSound } from '../../audio/uiSound';

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

  constructor() {
    this.overlay = el('div', 'modal-overlay');
    this.box = el('div', 'modal');
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-modal', 'true');
    this.overlay.appendChild(this.box);
    document.body.appendChild(this.overlay);
  }

  show(opts: ModalOptions): void {
    // A dialog that is replaced counts as dismissed, so whoever opened it can clear its own "I am open" flag.
    const previous = this.dismiss;
    this.dismiss = opts.onDismiss ?? null;
    previous?.();
    const content: HTMLElement[] = [];
    if (opts.icon) content.push(el('div', 'modal-icon', opts.icon));
    const title = el('h2', 'modal-title', opts.title);
    title.id = 'modal-title';
    this.box.setAttribute('aria-labelledby', title.id);
    content.push(title);
    content.push(typeof opts.body === 'string' ? el('p', 'modal-body', opts.body) : opts.body);

    const actions = el('div', 'modal-actions');
    for (const a of opts.actions) {
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
      actions.appendChild(btn);
    }
    content.push(actions);

    this.box.replaceChildren(...content);
    if (!this.isVisible) uiSound('modalOpen', 0.8, 300);
    this.overlay.classList.add('open');
    // Keyboard and screen-reader users land on the first choice.
    actions.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  hide(): void {
    this.overlay.classList.remove('open');
    const done = this.dismiss;
    this.dismiss = null;
    done?.();
  }

  get isVisible(): boolean {
    return this.overlay.classList.contains('open');
  }
}
