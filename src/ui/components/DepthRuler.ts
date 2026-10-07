import type { GameState } from '../../core/GameState';
import type { BunkerRenderer } from '../../rendering/BunkerRenderer';
import { BASE_EAST } from '../../core/GameState';
import { ROOM_H, floorAtY, floorTop } from '../../rendering/geom';
import { i18n } from '../../i18n/I18nManager';
import { isTouchDevice } from '../../utils/device';
import { haptic } from '../../utils/haptics';
import { el } from '../dom';
import '../../styles/ruler.css';

// [plan4:ST-12 #5] Orientation on a tall, wide bunker (D11): a depth ruler at the screen edge and a row of section chips above the nav.
//  - Ruler: a 28 px strip listing the floors (B1..), gallery ticks, the current floor in a pill and the band the screen shows. Dragging it
//    scrubs the camera up and down, a tap jumps to that floor (the existing focusFloor). It fades after 2 s without use, comes back when the
//    camera moves up or down, and is not built on a mouse-and-keyboard machine. Its edge follows the one-hand setting (CSS).
//  - Chips: "West wing / Core / East wing", only for the sides the bunker really has (state.layout.ext); a tap spring-pans there.
// All DOM, no per-frame work: update() is throttled to ~4 Hz and rebuilds only when floors / wings / language / viewport changed.

const IDLE_MS = 2000;
const TAP_PX = 6;
const MIN_FLOORS = 4;
/** Screen px between two labels on the strip: floors are thinned to this. */
const LABEL_GAP = 15;

type Sector = 'west' | 'core' | 'east';

export class DepthRuler {
  private readonly r: BunkerRenderer;
  private readonly root: HTMLDivElement;
  private readonly track: HTMLDivElement;
  private readonly ticks: HTMLDivElement;
  private readonly band: HTMLDivElement;
  private readonly cur: HTMLDivElement;
  private readonly chips: HTMLDivElement;
  private readonly chipBtns = new Map<Sector, HTMLButtonElement>();
  private floors = 0;
  private sig = '';
  private hideTimer = 0;
  private lastCheck = 0;
  private shown = false;
  private lastY = NaN;
  private lastFloor = -2;
  private drag: { id: number; sy: number; moved: boolean } | null = null;
  private y0 = 0;
  private y1 = 1;
  private enabled: boolean;

  constructor(renderer: BunkerRenderer) {
    this.r = renderer;
    // No ruler on a mouse-and-keyboard machine: the wheel and the drag already cover it; `?ruler` forces it for testing.
    this.enabled = isTouchDevice() || new URLSearchParams(location.search).has('ruler');
    this.root = el('div', 'depth-ruler');
    this.root.setAttribute('aria-hidden', 'true');
    this.track = el('div', 'dr-track');
    this.ticks = el('div', 'dr-ticks');
    this.band = el('div', 'dr-band');
    this.cur = el('div', 'dr-cur');
    this.track.append(this.ticks, this.band, this.cur);
    this.root.append(this.track);
    this.chips = el('div', 'dr-chips');
    this.chips.dir = 'ltr'; // a map, not text: west is on the left in every language
    this.chips.setAttribute('role', 'group');
    for (const k of ['west', 'core', 'east'] as Sector[]) {
      const b = el('button', 'dr-chip');
      b.type = 'button';
      b.dataset.sector = k;
      b.addEventListener('click', () => {
        haptic('select');
        this.r.camera.panToSector(k);
        this.refreshChips();
      });
      this.chipBtns.set(k, b);
    }
    this.chips.append(...this.chipBtns.values());
    if (!this.enabled) return;
    document.body.append(this.root, this.chips);
    this.root.addEventListener('pointerdown', e => this.onDown(e));
    this.root.addEventListener('pointermove', e => this.onMove(e));
    this.root.addEventListener('pointerup', e => this.onUp(e));
    this.root.addEventListener('pointercancel', e => this.onUp(e, true));
    this.r.camera.onChange = () => this.onCamera();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { this.sig = ''; }).observe(this.root);
  }

  /** World y of the strip's top and bottom end: the ceiling of floor 0 to the bottom of the last floor. */
  private mapY(frac: number): number {
    return this.y0 + frac * (this.y1 - this.y0);
  }

  private fracOf(y: number): number {
    return Math.max(0, Math.min(1, (y - this.y0) / (this.y1 - this.y0)));
  }

  private floorAtPointer(clientY: number): number {
    const rc = this.track.getBoundingClientRect();
    const frac = (clientY - rc.top) / Math.max(1, rc.height);
    return Math.max(0, Math.min(this.floors - 1, floorAtY(this.mapY(Math.max(0, Math.min(1, frac)))).floor));
  }

  private onDown(e: PointerEvent): void {
    e.preventDefault();
    this.root.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, sy: e.clientY, moved: false };
    this.show();
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientY - d.sy) > TAP_PX) d.moved = true;
    if (!d.moved) return;
    const rc = this.track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientY - rc.top) / Math.max(1, rc.height)));
    this.r.camera.scrubY(this.mapY(frac));
    this.show();
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    if (!d.moved && !cancelled) {
      haptic('tap');
      this.r.focusFloor(this.floorAtPointer(e.clientY));
    }
    this.show();
  }

  private show(): void {
    if (!this.enabled || this.floors < MIN_FLOORS) return;
    if (!this.shown) {
      this.shown = true;
      this.root.classList.add('on');
    }
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (this.drag) { this.show(); return; }
      this.shown = false;
      this.root.classList.remove('on');
    }, IDLE_MS);
  }

  /** The camera moved: follow it (cheap), and wake the strip when the move was up or down. */
  private onCamera(): void {
    if (this.floors < MIN_FLOORS) return;
    const cam = this.r.camera;
    const dy = Math.abs(cam.camY - this.lastY);
    if (Number.isNaN(this.lastY)) this.lastY = cam.camY; // the first fit is not a gesture
    else if (dy > 1) { this.lastY = cam.camY; this.show(); }
    if (this.shown) this.placeMarkers();
    this.refreshChips();
  }

  private placeMarkers(): void {
    const cam = this.r.camera;
    const { y0, y1 } = cam.visibleY();
    const top = this.fracOf(y0), bot = this.fracOf(y1);
    this.band.style.top = `${top * 100}%`;
    this.band.style.height = `${Math.max(0.5, (bot - top) * 100)}%`;
    const f = Math.max(0, Math.min(this.floors - 1, floorAtY(cam.camY).floor));
    this.cur.style.top = `${this.fracOf(cam.camY) * 100}%`;
    if (f !== this.lastFloor) {
      if (this.drag?.moved && this.lastFloor >= 0) haptic('select');
      this.lastFloor = f;
      this.cur.textContent = `B${f + 1}`;
    }
  }

  private refreshChips(): void {
    const now = this.r.camera.sectorNow();
    for (const [k, b] of this.chipBtns) {
      b.classList.toggle('active', k === now);
      b.setAttribute('aria-pressed', k === now ? 'true' : 'false');
    }
  }

  /** Called every picture by the app; does real work ~4 times a second. */
  update(state: GameState): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastCheck < 250) return;
    this.lastCheck = now;
    const floors = state.currentFloors;
    // Wings: any floor reaching west of the shaft or east past the classic 12 slots.
    let west = false, east = false;
    const ext = state.layout?.ext;
    if (ext) for (const k in ext) { if (ext[k].w > 0) west = true; if (ext[k].e > BASE_EAST) east = true; }
    let gal = '';
    for (let f = 0; f < floors; f++) gal += floorAtY(floorTop(f) + ROOM_H / 2).gallery ? 'g' : '.';
    const h = this.track.clientHeight;
    const sig = `${floors}|${gal}|${west}|${east}|${i18n.currentLocale}|${h}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.floors = floors;
    this.build(floors, gal, west, east, h);
  }

  private build(floors: number, gal: string, west: boolean, east: boolean, trackH: number): void {
    const usable = floors >= MIN_FLOORS;
    this.root.classList.toggle('off', !usable);
    this.y0 = floorTop(0);
    this.y1 = floorTop(Math.max(1, floors));
    this.ticks.textContent = '';
    if (usable) {
      const per = Math.max(1, trackH) / floors;
      const step = Math.max(1, Math.ceil(LABEL_GAP / per));
      for (let f = 0; f < floors; f++) {
        const top = this.fracOf(floorTop(f)) * 100;
        const mid = this.fracOf(floorTop(f) + ROOM_H / 2) * 100;
        const line = el('i', gal[f] === 'g' ? 'dr-line dr-gal' : 'dr-line');
        line.style.top = `${top}%`;
        this.ticks.append(line);
        // The lowest floor always gets its label, the rest are thinned to every `step`.
        if (gal[f] !== 'g' && (f % step === 0 || f === floors - 1)) {
          const t = el('span', 'dr-num', `B${f + 1}`);
          t.style.top = `${mid}%`;
          this.ticks.append(t);
        }
      }
      this.placeMarkers();
    }
    // Chips: only for sides that exist; with no wing at all the row is not shown.
    const any = west || east;
    this.chips.classList.toggle('on', any);
    document.documentElement.style.setProperty('--chips-h', any ? '52px' : '0px');
    const names: Record<Sector, string> = { west: i18n.t('ruler.west'), core: i18n.t('ruler.core'), east: i18n.t('ruler.east') };
    for (const [k, b] of this.chipBtns) {
      // Chevron and name as separate pieces, so the arrow stays on the map side of the name in Hebrew too.
      const name = el('span', 'name', names[k]);
      name.dir = 'auto';
      const parts: HTMLElement[] = k === 'west' ? [el('span', 'chev', '\u2039'), name] : k === 'east' ? [name, el('span', 'chev', '\u203A')] : [name];
      b.replaceChildren(...parts);
      b.setAttribute('aria-label', names[k]);
      b.hidden = (k === 'west' && !west) || (k === 'east' && !east);
    }
    this.refreshChips();
  }
}
