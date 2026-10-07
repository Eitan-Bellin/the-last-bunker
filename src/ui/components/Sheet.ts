import { el, setRich } from '../dom';
import { haptic } from '../../utils/haptics';
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
  private helpBtn: HTMLButtonElement;

  onClose: (() => void) | null = null;
  /** [Q6] Opens the Bunker Book at a topic; set once by the app. */
  static onHelp: ((topic: string) => void) | null = null;

  constructor(extraClass = '', helpTopic: string | null = null) {
    this.overlay = el('div', 'sheet-overlay');
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    this.panel = el('div', `sheet ${extraClass}`);
    const close = el('button', 'sheet-close', '[[close]]');
    close.setAttribute('aria-label', i18n.t('journal.close'));
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      haptic('tap');
      this.hide();
    });
    // [Q6] The "?" plate: opens the Bunker Book at this sheet's topic (shown only when a topic was set).
    this.helpBtn = el('button', 'sheet-help', '[[question]]');
    this.helpBtn.style.display = 'none';
    this.helpBtn.setAttribute('aria-label', i18n.t('book.title'));
    this.helpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      haptic('tap');
      const topic = this.helpBtn.dataset.topic;
      if (topic) Sheet.onHelp?.(topic);
    });
    const handle = el('div', 'sheet-handle');
    this.titleEl = el('h2', 'sheet-title');
    this.body = el('div', 'sheet-body');
    this.panel.append(close, this.helpBtn, handle, this.titleEl, this.body);
    this.overlay.appendChild(this.panel);
    document.body.appendChild(this.overlay);
    this.bindPullDown(handle);
    this.setHelp(helpTopic);

    if (!escBound) {
      escBound = true;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') openSheets[openSheets.length - 1]?.hide();
      });
    }
  }

  /** Pull-to-dismiss. Touch works anywhere while the body sits at the top; the mouse drags the handle or title. */
  private bindPullDown(handle: HTMLElement): void {
    let startX = 0;
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
      // [plan4:UX-4] A touch that starts on a text field or a slider belongs to that control (typing, selecting, dragging a thumb),
      // never to the pull-down: the old code cancelled every downward touchmove, which froze the volume sliders.
      const t = e.target as Element | null;
      if (t?.closest?.('input,textarea,select,[data-no-pulldown]')) { armed = false; return; }
      // Only a pull that starts with the content at its top may close the sheet.
      armed = this.panel.scrollTop <= 0;
      startX = e.touches[0].clientX;
      begin(e.touches[0].clientY);
    }, { passive: true });
    this.panel.addEventListener('touchmove', (e) => {
      if (!armed || e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      if (!dragging) {
        const dy = y - startY;
        const dx = e.touches[0].clientX - startX;
        if (dy < -8) {
          // Pushing the content up is a normal scroll: hand the gesture back to the browser.
          armed = false;
          return;
        }
        // [plan4:UX-4] Claim the gesture only once it is clearly a downward pull (more than 8 px, and more vertical than
        // horizontal): a sideways swipe or a small wobble of a tap must stay with the content under the finger.
        if (dy <= 8) return;
        if (Math.abs(dy) <= Math.abs(dx)) { armed = false; return; }
      }
      // At the top a downward pull has nothing to scroll, so once claimed the sheet follows the finger
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

  /** [Q6] Puts a "?" plate on the sheet that opens the Bunker Book at the given topic (null removes it). */
  setHelp(topic: string | null): void {
    this.helpBtn.style.display = topic ? '' : 'none';
    if (topic) this.helpBtn.dataset.topic = topic;
  }

  show(): void {
    if (!this.open) {
      uiSound('open', 0.7, 150);
      // [Q6] The newest sheet is the top sheet (the Bunker Book opens over the sheet it was asked from), but always below dialogs.
      const modal = document.querySelector('.modal-overlay');
      if (modal && modal.parentElement === document.body) document.body.insertBefore(this.overlay, modal);
      else document.body.appendChild(this.overlay);
    }
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
