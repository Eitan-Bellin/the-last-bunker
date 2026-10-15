import { i18n } from '../i18n/I18nManager';
import { getHudInsets } from '../utils/hudInsets';
import { kButton } from './kit';
import type { GameState } from '../core/GameState';
import type { BunkerRenderer } from '../rendering/BunkerRenderer';
import { ROOM_H, SIDE_MARGIN, SLOT_W } from '../rendering/geom';
import { VIEW_TOP } from '../rendering/CameraController';
import { UPDATE_MS } from './edgeArrows';

/**
 * [ux-redesign W3b] "Back to the bunker": when the camera looks far from where the bunker lives (the far surface lots, the empty depths),
 * a small button above the nav (bottom, inline end: the thumb zone) glides the view back to the home view (the entrance and the top
 * rooms, the same picture the game opens on). Checks at the edge arrows' pace (about 4 Hz) and touches the DOM only when it shows/hides.
 */

/** Below this share of the visible band showing rooms (or ruins), the camera counts as "away from the bunker". */
const AWAY_SHARE = 0.08;
/**
 * Screens narrower than this open on the shaft side; wider ones centre the whole building. [w3fix] The same number as CameraController's
 * own PHONE_W, which is not exported (rendering/ is read-only for UI work): keep the two equal if either changes.
 */
const PHONE_W = 700;
/** After a tap the button stays away while the camera glides home (the glide passes through "away" views). */
const GLIDE_QUIET_MS = 2_000;

export interface BackToBunkerHost {
  renderer: BunkerRenderer;
  getState: () => GameState;
  blocked: () => boolean;
  click?: () => void;
}

export class BackToBunker {
  private readonly btn: HTMLButtonElement;
  private timer = 0;
  private shown = false;
  private quietUntil = 0;

  private readonly host: BackToBunkerHost;

  constructor(host: BackToBunkerHost) {
    this.host = host;
    this.btn = kButton({
      variant: 'secondary', icon: 'vault', label: i18n.t('ux3b.home'), ariaLabel: i18n.t('ux3b.home.aria'),
      className: 'btn-secondary back-home', onPress: () => this.goHome(),
    });
    this.btn.hidden = true;
    document.body.appendChild(this.btn);
  }

  start(): void {
    if (this.timer) return;
    this.timer = window.setInterval(() => this.update(), UPDATE_MS);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  update(): void {
    if (document.hidden) return;
    this.show(Date.now() >= this.quietUntil && !this.host.blocked() && this.away());
  }

  private show(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.btn.hidden = !on;
  }

  /** How much of the visible world band the bunker's rooms and ruins cover (union of boxes is over-counted; fine for a threshold). */
  private away(): boolean {
    const r = this.host.renderer;
    const wc = r.worldContainer;
    const z = wc.scale.x || 1;
    const { width, height } = r.app.screen;
    const ins = getHudInsets();
    // The visible band in world units.
    const vx0 = -wc.x / z, vx1 = (width - wc.x) / z;
    const vy0 = (ins.top - wc.y) / z, vy1 = (height - ins.bottom - ins.objective - wc.y) / z;
    const area = Math.max(1, (vx1 - vx0) * (vy1 - vy0));
    let covered = 0;
    const add = (x: number, y: number, w: number, h: number) => {
      const ox = Math.min(vx1, x + w) - Math.max(vx0, x), oy = Math.min(vy1, y + h) - Math.max(vy0, y);
      if (ox > 0 && oy > 0) covered += ox * oy;
    };
    const state = this.host.getState();
    for (const b of state.buildings) {
      const rr = r.roomRect(b.id);
      if (rr) add(rr.x, rr.y, rr.w, rr.h);
      if (covered / area >= AWAY_SHARE) return false;
    }
    for (const ru of state.ruins) {
      const c = r.ruinCenter(ru);
      add(c.x - (ru.w * SLOT_W) / 2, c.y - ROOM_H / 2, ru.w * SLOT_W, ROOM_H);
      if (covered / area >= AWAY_SHARE) return false;
    }
    return true;
  }

  /** The home view (what the game opens on), as a glide. */
  private goHome(): void {
    this.host.click?.();
    this.host.renderer.camera.goHome(); // [phase2] the same home view the game opens on (the player's busy rooms in city mode)
    this.quietUntil = Date.now() + GLIDE_QUIET_MS;
    this.show(false);
  }
}
