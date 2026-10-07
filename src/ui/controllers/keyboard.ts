import type { GameApp } from '../../app';
import { ZoomButtons } from '../components/ZoomButtons'; // [plan4:AC-13] installed here: this is where the camera keys live

/**
 * [plan4:AC-10] Keyboard shortcuts for desktop players and external keyboards on a tablet:
 * B build, P people, R research, L the room list (AC-11), arrows pan, + / - zoom, 1..9 jump to a floor.
 * They go through the same entry points as the buttons (the HUD's navigation handler, the renderer's camera), nothing else is touched.
 * Never active while the player is typing, while a dialog or the intro is up, or with a modifier key held (browser shortcuts stay theirs).
 */

/** The little the keyboard needs from the camera (CameraController, reached through the renderer; read-only fields, public glide). */
interface CamLike {
  camX: number;
  camY: number;
  zoom: number;
  baseZoom: number;
  focusTo(x: number, y: number, z: number): void;
}

/** World units a pan key press moves (about one room). */
const PAN_STEP = 120;
const ZOOM_STEP = 1.25;

export class KeyboardShortcuts {
  private readonly app: GameApp;

  constructor(app: GameApp) {
    this.app = app;
  }

  install(): void {
    document.addEventListener('keydown', e => this.onKey(e));
    new ZoomButtons(this.app).install();
  }

  private typing(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  private sheetOpen(): boolean {
    return !!document.querySelector('.sheet-overlay.open');
  }

  private cam(): CamLike | null {
    const c = (this.app.renderer as unknown as { cam?: Partial<CamLike> }).cam;
    return c && typeof c.focusTo === 'function' && typeof c.camX === 'number' ? (c as CamLike) : null;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || this.typing(e)) return;
    const app = this.app;
    if (app.modal.isVisible || app.introPlaying || document.body.classList.contains('intro-active')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // [plan4:AC-10] Escape also leaves placing a room (the confirm bar has a cancel button; this is its key). An open panel closes first (Sheet.ts).
    if (k === 'Escape' && app.placementMode && !this.sheetOpen()) { e.preventDefault(); app.world.cancelPlacement(); return; }
    // Panels: the same handler the bottom navigation uses (it toggles, closes what is open, cancels a placement).
    const nav = k === 'b' ? 'build' : k === 'p' ? 'people' : k === 'r' ? 'research' : null;
    if (nav) { e.preventDefault(); app.hud.onNav?.(nav); return; }
    if (k === 'l') { e.preventDefault(); app.toggleStructure(); return; }
    // The camera keys act on the bunker, so not while a panel covers it.
    if (this.sheetOpen()) return;
    const cam = this.cam();
    if (!cam) return;
    const pan = (dx: number, dy: number): void => { e.preventDefault(); cam.focusTo(cam.camX + dx * PAN_STEP, cam.camY + dy * PAN_STEP, cam.zoom); };
    // Arrow directions are screen directions (left is left in Hebrew too).
    if (k === 'ArrowLeft') pan(-1, 0);
    else if (k === 'ArrowRight') pan(1, 0);
    else if (k === 'ArrowUp') pan(0, -1);
    else if (k === 'ArrowDown') pan(0, 1);
    else if (k === '+' || k === '=') { e.preventDefault(); cam.focusTo(cam.camX, cam.camY, cam.zoom * ZOOM_STEP); }
    else if (k === '-' || k === '_') { e.preventDefault(); cam.focusTo(cam.camX, cam.camY, cam.zoom / ZOOM_STEP); }
    else if (/^[1-9]$/.test(k)) {
      const floor = Number(k) - 1;
      if (floor < app.state.currentFloors) { e.preventDefault(); app.renderer.focusFloor(floor); }
    }
  }
}
