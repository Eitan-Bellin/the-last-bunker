import type { GameApp } from '../../app';
import { i18n } from '../../i18n/I18nManager';
import { getA11y, subscribeA11y } from '../../utils/a11y';
import { uiSound } from '../../audio/uiSound';

/**
 * [plan4:AC-13] Floating "+", "-" and "fit" buttons for the camera, for anyone who cannot pinch or double-tap (Accessibility tab, "Zoom buttons").
 * They do what the keyboard keys do: the same glide of the camera, nothing else. Hidden while a panel covers the bunker and when the setting is off;
 * built once, only toggled afterwards.
 */

/** The little the buttons need from the camera (CameraController, reached through the renderer). */
interface CamLike {
  camX: number;
  camY: number;
  zoom: number;
  baseZoom: number;
  focusTo(x: number, y: number, z: number): void;
}
const STEP = 1.25;

export class ZoomButtons {
  private readonly app: GameApp;
  private box: HTMLElement | null = null;

  constructor(app: GameApp) {
    this.app = app;
  }

  install(): void {
    const sync = () => this.sync();
    subscribeA11y(sync);
    sync();
    // A panel opening or closing changes what the buttons would cover: watch the overlays' class changes (cheap: a class check per mutation).
    new MutationObserver(sync).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  private cam(): CamLike | null {
    const c = (this.app.renderer as unknown as { cam?: Partial<CamLike> }).cam;
    return c && typeof c.focusTo === 'function' && typeof c.camX === 'number' ? (c as CamLike) : null;
  }

  private sync(): void {
    const want = getA11y().zoomButtons && !document.querySelector('.sheet-overlay.open, .modal-overlay.open') && !document.body.classList.contains('intro-active');
    if (!want) {
      if (this.box) this.box.hidden = true;
      return;
    }
    if (!this.box) this.box = this.build();
    this.box.hidden = false;
  }

  private build(): HTMLElement {
    const box = document.createElement('div');
    box.className = 'zoom-buttons';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', i18n.t('zoom.group'));
    const make = (glyph: string, key: string, act: (c: CamLike) => void): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'zoom-btn';
      b.textContent = glyph;
      b.setAttribute('aria-label', i18n.t(key));
      b.addEventListener('click', () => {
        const c = this.cam();
        if (!c) return;
        uiSound('click');
        act(c);
      });
      box.appendChild(b);
    };
    make('+', 'zoom.in', c => c.focusTo(c.camX, c.camY, c.zoom * STEP));
    make('−', 'zoom.out', c => c.focusTo(c.camX, c.camY, c.zoom / STEP));
    // "Fit": back to the screen's own default view (what a double tap on an empty spot does when zoomed in).
    make('▣', 'zoom.fit', c => c.focusTo(c.camX, c.camY, c.baseZoom));
    document.body.appendChild(box);
    return box;
  }
}
