import { el, setRich } from '../dom';
import { vibrate } from '../../utils/haptics';
import { uiSound } from '../../audio/uiSound';
import { i18n } from '../../i18n/I18nManager';

/** Open sheets, newest last: Escape closes the top one. */
const openSheets: Sheet[] = [];
let escBound = false;

/** How far (px) or how fast (px/ms) a pull-down must go to dismiss the sheet. */
const DISMISS_PX = 90;
const DISMISS_SPEED = 0.6;

/**
 * Bottom sheet that slides up over the game. It closes from the ✕ plate, a tap on the backdrop,
 * Escape, or a pull-down: drag the handle/title, or pull the body down while it is scrolled to the top.
 */
export class Sheet {
  readonly body: HTMLDivElement;
  private overlay: HTMLDivElement;
  private panel: HTMLDivElement;
  private titleEl: HTMLHeadingElement;
  private open = false;

  onClose: (() => void) | null = null;

  constructor(extraClass = '') {
    this.overlay = el('div', 'sheet-overlay');
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    this.panel = el('div', `sheet ${extraClass}`);
    const close = el('button', 'sheet-close', '[[close]]');
    close.setAttribute('aria-label', i18n.t('journal.close'));
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      vibrate(8);
      this.hide();
    });
    const handle = el('div', 'sheet-handle');
    this.titleEl = el('h2', 'sheet-title');
    this.body = el('div', 'sheet-body');
    this.panel.append(close, handle, this.titleEl, this.body);
    this.overlay.appendChild(this.panel);
    document.body.appendChild(this.overlay);
    this.bindPullDown(handle);

    if (!escBound) {
      escBound = true;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') openSheets[openSheets.length - 1]?.hide();
      });
    }
  }

  /** Pull-to-dismiss. Touch works anywhere while the body sits at the top; the mouse drags the handle or title. */
  private bindPullDown(handle: HTMLElement): void {
    let startY = 0;
    let startT = 0;
    let dy = 0;
    let armed = false;
    let dragging = false;

    const begin = (y: number) => {
      startY = y;
      startT = performance.now();
      dy = 0;
      dragging = false;
    };
    const move = (y: number): boolean => {
      dy = y - startY;
      if (!dragging) {
        if (dy < 8) return false;
        dragging = true;
        this.panel.classList.add('dragging');
        startY = y;
        startT = performance.now();
        dy = 0;
      }
      // Follow the finger downward, resist a little upward.
      const shown = dy > 0 ? dy : dy * 0.25;
      this.panel.style.transform = `translateY(${shown.toFixed(1)}px)`;
      return true;
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      const speed = dy / Math.max(1, performance.now() - startT);
      this.panel.classList.remove('dragging');
      this.panel.style.transform = '';
      if (dy > DISMISS_PX || (dy > 24 && speed > DISMISS_SPEED)) this.hide();
    };

    this.panel.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { armed = false; return; }
      // Only a pull that starts with the content at its top may close the sheet.
      armed = this.panel.scrollTop <= 0;
      begin(e.touches[0].clientY);
    }, { passive: true });
    this.panel.addEventListener('touchmove', (e) => {
      if (!armed || e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      if (!dragging && y < startY) {
        // Pushing the content up is a normal scroll: hand the gesture back to the browser.
        armed = false;
        return;
      }
      // At the top a downward pull has nothing to scroll, so claim it from the first move
      // (later touchmoves stop being cancelable once the browser starts its own pan).
      if (e.cancelable) e.preventDefault();
      move(y);
    }, { passive: false });
    const touchEnd = () => {
      armed = false;
      end();
    };
    this.panel.addEventListener('touchend', touchEnd);
    this.panel.addEventListener('touchcancel', touchEnd);

    // Mouse: drag the grip or the title bar.
    const grabMouse = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      begin(e.clientY);
      const onMove = (ev: PointerEvent) => { move(ev.clientY); };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        end();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointerdown', grabMouse);
    this.titleEl.addEventListener('pointerdown', grabMouse);
  }

  setTitle(text: string): void {
    setRich(this.titleEl, text);
  }

  show(): void {
    if (!this.open) uiSound('open', 0.7, 150);
    this.open = true;
    this.panel.style.transform = '';
    this.overlay.classList.add('open');
    const i = openSheets.indexOf(this);
    if (i >= 0) openSheets.splice(i, 1);
    openSheets.push(this);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.overlay.classList.remove('open');
    const i = openSheets.indexOf(this);
    if (i >= 0) openSheets.splice(i, 1);
    this.onClose?.();
  }

  get isVisible(): boolean {
    return this.open;
  }
}
