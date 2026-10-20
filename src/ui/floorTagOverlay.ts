import { el } from './dom';
import { i18n } from '../i18n/I18nManager';
import { bindPress, kRow } from './kit';
import { floorTag } from './floorTag';
import { UPDATE_MS } from './edgeArrows';
import { zoneForFloor } from '../data/zones';
import { floorKinds, type FloorKind } from '../rendering/floorIdentity';
import { roomStatus } from '../rendering/roomStatus';
import { labelState } from '../rendering/LabelScale';
import type { GameState } from '../core/GameState';
import type { BunkerRenderer } from '../rendering/BunkerRenderer';

/**
 * [clean:2] The sticky floor tag: one small chip at the start edge under the status row ("קומה 7 · חקלאות ומים") naming the floor the view
 * looks at (CameraController.floorInView, the one a scroll snaps to the top). The camera tells it when that floor changes; nothing else
 * touches the DOM. A tap opens a compact floor list (kit rows: the floor, its name, a red dot when a room there is in trouble); a row glides
 * the camera there. Hidden at far zoom (the city map labels its floors itself), while a panel / the room screen / placement covers the
 * world, and before anything is dug.
 */

export interface FloorTagHost {
  renderer: BunkerRenderer;
  getState: () => GameState;
  blocked: () => boolean;
  click?: () => void;
}

/** The name of floor f: the founding zones by their zone; a deeper floor by what fills most of it (floorIdentity), or "Deep level". */
export function floorName(state: GameState, f: number, kinds?: readonly { kind: FloorKind }[]): string {
  if (f < 0) return i18n.t('floor.surface');
  const zone = zoneForFloor(f);
  const loc = i18n.currentLocale;
  if (zone.id !== 'deep') return zone.name[loc] ?? zone.name.en;
  const k = (kinds ?? floorKinds(state.buildings, state.currentFloors))[f]?.kind;
  if (k === 'living' || k === 'agri' || k === 'engineering' || k === 'industrial' || k === 'research') return i18n.t(`cf2.kind.${k}`);
  return zone.name[loc] ?? zone.name.en;
}

/** Floors with a room in trouble (roomStatus 'bad': nobody at a job that needs people, shut down, a crisis or a disaster). */
function troubledFloors(state: GameState): Set<number> {
  const out = new Set<number>();
  const now = Date.now();
  for (const b of state.buildings) if (!out.has(b.position.floor) && roomStatus(state, b, now) === 'bad') out.add(b.position.floor);
  return out;
}

export class FloorTagOverlay {
  private readonly tag: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private readonly dot: HTMLSpanElement;
  private readonly list: HTMLDivElement;
  private readonly host: FloorTagHost;
  private timer = 0;
  private floor = NaN;
  private shown = false;
  private open = false;
  private text = '';
  private bad = false;
  private locale = '';

  constructor(host: FloorTagHost) {
    this.host = host;
    this.tag = el('button', 'cf2-floortag');
    this.tag.type = 'button';
    this.tag.setAttribute('aria-haspopup', 'listbox');
    this.tag.setAttribute('aria-expanded', 'false');
    this.dot = el('span', 'cf2-floortag__dot');
    this.dot.hidden = true;
    this.label = el('span', 'cf2-floortag__label');
    this.tag.append(this.dot, this.label);
    this.tag.hidden = true;
    bindPress(this.tag, () => this.toggle());
    this.list = el('div', 'cf2-jump');
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', i18n.t('cf2.jump.title'));
    this.list.hidden = true;
    document.body.append(this.tag, this.list);
    // A tap anywhere else (or Escape) closes the list.
    window.addEventListener('pointerdown', e => {
      if (this.open && !this.list.contains(e.target as Node) && !this.tag.contains(e.target as Node)) this.close();
    }, true);
    window.addEventListener('keydown', e => { if (this.open && e.key === 'Escape') { this.close(); this.tag.focus(); } });
  }

  start(): void {
    if (this.timer) return;
    this.host.renderer.camera.addFloorListener(f => this.setFloor(f));
    this.timer = window.setInterval(() => this.update(), UPDATE_MS);
    this.update();
  }

  /** Visibility (and the floor's words when the dig or the language moved under a still camera), at the edge arrows' pace. */
  private update(): void {
    if (document.hidden) return;
    const state = this.host.getState();
    const on = state.currentFloors > 0 && labelState.mode === 'full' && !this.host.blocked();
    if (on !== this.shown) {
      this.shown = on;
      this.tag.hidden = !on;
      if (!on) this.close();
    }
    if (!on) return;
    this.setFloor(this.host.renderer.camera.floorInView(), i18n.currentLocale !== this.locale);
  }

  private setFloor(f: number, force = false): void {
    if (f === this.floor && !force) return;
    this.floor = f;
    if (!this.shown) return;
    const state = this.host.getState();
    this.locale = i18n.currentLocale;
    const text = `${floorTag(f)} · ${floorName(state, f)}`;
    if (text !== this.text) {
      this.text = text;
      this.label.textContent = text;
      this.tag.setAttribute('aria-label', i18n.t('cf2.tag.aria', { floor: text }));
    }
    const bad = f >= 0 && troubledFloors(state).has(f);
    if (bad !== this.bad) {
      this.bad = bad;
      this.dot.hidden = !bad;
    }
    if (this.open) this.markCurrent();
  }

  private toggle(): void {
    this.host.click?.();
    if (this.open) this.close();
    else this.openList();
  }

  /** Builds the list fresh each time it opens (24 rows at most): floor, name, a red dot where a room is in trouble. */
  private openList(): void {
    const state = this.host.getState();
    const n = state.currentFloors;
    const kinds = floorKinds(state.buildings, n);
    const bad = troubledFloors(state);
    this.list.replaceChildren();
    for (let f = 0; f < n; f++) {
      const trailing = el('span', 'cf2-jump__dot');
      trailing.hidden = !bad.has(f);
      if (bad.has(f)) trailing.setAttribute('aria-label', i18n.t('cf2.jump.trouble'));
      const row = kRow({
        label: floorName(state, f, kinds), value: floorTag(f), trailing,
        onPress: () => { this.close(); this.host.renderer.camera.glideToFloor(f); },
      });
      row.classList.add('cf2-jump-item');
      row.setAttribute('role', 'option');
      row.dataset.floor = String(f);
      this.list.appendChild(row);
    }
    this.open = true;
    this.list.hidden = false;
    this.tag.setAttribute('aria-expanded', 'true');
    this.markCurrent();
    const cur = this.list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (cur) this.list.scrollTop = cur.offsetTop - (this.list.clientHeight - cur.offsetHeight) / 2; // the floor in view in the middle
  }

  private markCurrent(): void {
    for (const r of this.list.children) (r as HTMLElement).setAttribute('aria-selected', String(Number((r as HTMLElement).dataset.floor) === this.floor));
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.list.hidden = true;
    this.tag.setAttribute('aria-expanded', 'false');
  }
}
