import { el } from '../dom';
import { uiSound } from '../../audio/uiSound';

export type ToastKind = 'info' | 'good' | 'bad';

const MAX_TOASTS = 3;
const DURATION_MS = 3200;

export class Toasts {
  private stack: HTMLDivElement;

  constructor() {
    this.stack = el('div', 'toast-stack');
    document.body.appendChild(this.stack);
  }

  show(text: string, kind: ToastKind = 'info'): void {
    const toast = el('div', `toast ${kind}`, text);
    if (kind === 'info') uiSound('notify', 0.6, 4000);
    this.stack.appendChild(toast);
    while (this.stack.children.length > MAX_TOASTS) this.stack.firstElementChild?.remove();

    requestAnimationFrame(() => toast.classList.add('in'));
    setTimeout(() => {
      toast.classList.remove('in');
      setTimeout(() => toast.remove(), 300);
    }, DURATION_MS);
  }
}
