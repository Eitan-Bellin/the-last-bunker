import { el, setRich, RESOURCE_ICONS } from '../dom';
import { i18n } from '../../i18n/I18nManager';
import { enhanceTabs } from '../a11yDom';
import { fmtDuration, fmtNum, fmtRate } from '../format';
import { BADGE_MAX, DANGER_RATIO, LOW_RATIO, NEVER_ATTACHED_TICKS, SECOND_MS, resourceColor } from './tokens';
import { bindPress, kButton } from './Button';

/**
 * [ux-redesign W1] The display half of the kit: resource chip, progress bar, badge, card / row, tabs, empty state, timer.
 * Each `kX(...)` builds a node; each `setX(node, ...)` updates it in place (no re-render, no layout jump). Styles: styles/kit.css.
 */

// ---- Resource chip ------------------------------------------------------------------------------------------------------------------

export type ChipState = 'normal' | 'low' | 'danger';

export interface ResourceChipOptions {
  /** A resource id (food, water, ...): picks its icon and colour token. */
  resource?: string;
  /** Or any icon name from icons.ts (a resource id wins). */
  icon?: string;
  amount: number;
  /** Per second; omitted = no rate line. */
  rate?: number;
  /** The cap: with it the state follows the fill (under 30 % low, under 15 % danger and pulsing) unless `state` is given. */
  max?: number;
  state?: ChipState;
  /** Accessible name; default "<resource name>: <amount>". */
  label?: string;
}

/** normal / low / danger from how full it is. */
export function chipState(amount: number, max: number | undefined): ChipState {
  if (!max || max <= 0) return 'normal';
  const r = amount / max;
  return r < DANGER_RATIO ? 'danger' : r < LOW_RATIO ? 'low' : 'normal';
}

export function kResourceChip(o: ResourceChipOptions): HTMLDivElement {
  const chip = el('div', 'k-chip');
  chip.setAttribute('role', 'group');
  if (o.resource) chip.style.setProperty('--k-chip-color', resourceColor(o.resource));
  const iconTok = o.resource ? RESOURCE_ICONS[o.resource] : o.icon ? `[[${o.icon}]]` : '';
  chip.append(el('span', 'k-chip__icon', iconTok ?? ''), el('span', 'k-chip__amount'), el('span', 'k-chip__rate'));
  chip.dataset.resource = o.resource ?? '';
  setResourceChip(chip, o);
  return chip;
}

export function setResourceChip(chip: HTMLElement, o: Pick<ResourceChipOptions, 'amount' | 'rate' | 'max' | 'state' | 'label'>): void {
  const state = o.state ?? chipState(o.amount, o.max);
  chip.classList.remove('is-normal', 'is-low', 'is-danger');
  chip.classList.add(`is-${state}`);
  const amount = chip.querySelector<HTMLElement>('.k-chip__amount');
  if (amount) amount.textContent = fmtNum(o.amount);
  const rate = chip.querySelector<HTMLElement>('.k-chip__rate');
  if (rate) {
    rate.hidden = o.rate === undefined;
    if (o.rate !== undefined) {
      setRich(rate, fmtRate(o.rate));
      rate.classList.toggle('is-up', o.rate > 0);
      rate.classList.toggle('is-down', o.rate < 0);
    }
  }
  const res = chip.dataset.resource;
  const name = o.label ?? (res ? `${i18n.t(`resources.${res}`)}: ${i18n.formatNumber(Math.floor(o.amount))}` : fmtNum(o.amount));
  chip.setAttribute('aria-label', name);
}

// ---- Progress -----------------------------------------------------------------------------------------------------------------------

/**
 * A bar with a "ghost": when the value drops, the ghost keeps the old length a moment and then shrinks after it, so the player
 * sees how much was lost; when it rises, the fill grows and the ghost follows at once.
 */
export function kProgress(value: number, max: number, label?: string): HTMLDivElement {
  const track = el('div', 'k-progress');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  if (label) track.setAttribute('aria-label', label);
  track.append(el('div', 'k-progress__ghost'), el('div', 'k-progress__fill'));
  setProgress(track, value, max);
  return track;
}

export function setProgress(track: HTMLElement, value: number, max: number): void {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const prev = parseFloat(track.style.getPropertyValue('--k-progress') || '0');
  track.classList.toggle('is-dropping', pct < prev);
  track.style.setProperty('--k-progress', `${pct}%`);
  track.setAttribute('aria-valuemax', String(Math.max(0, Math.round(max))));
  track.setAttribute('aria-valuenow', String(Math.max(0, Math.min(Math.round(max), Math.round(value)))));
}

// ---- Badge --------------------------------------------------------------------------------------------------------------------------

export function badgeText(count: number): string {
  return count > BADGE_MAX ? `${BADGE_MAX}+` : String(Math.max(0, Math.floor(count)));
}

/** A count bubble; hidden at 0, "99+" past 99. */
export function kBadge(count: number): HTMLSpanElement {
  const b = el('span', 'k-badge');
  setBadge(b, count);
  return b;
}

export function setBadge(b: HTMLElement, count: number): void {
  b.hidden = count <= 0;
  b.textContent = badgeText(count);
  b.setAttribute('aria-label', i18n.t('kit.badge.label', { n: Math.floor(count) }));
}

// ---- Card / Row ---------------------------------------------------------------------------------------------------------------------

export interface CardOptions {
  title?: string;
  body?: string;
  children?: HTMLElement[];
  /** Makes the whole card one button. */
  onPress?: () => void;
  className?: string;
}

export function kCard(o: CardOptions = {}): HTMLElement {
  const card = o.onPress ? el('button', `k-card is-pressable ${o.className ?? ''}`) : el('div', `k-card ${o.className ?? ''}`);
  if (o.title) card.appendChild(el('div', 'k-card__title', o.title));
  if (o.body) card.appendChild(el('div', 'k-card__body', o.body));
  for (const c of o.children ?? []) card.appendChild(c);
  if (o.onPress) {
    (card as HTMLButtonElement).type = 'button';
    bindPress(card, o.onPress); // same press feel, release-inside and debounce as kButton
  }
  return card;
}

export interface RowOptions {
  icon?: string;
  label: string;
  /** Right-hand (inline-end) value, e.g. an amount. */
  value?: string;
  trailing?: HTMLElement;
  onPress?: () => void;
}

/** One line of a list: icon, label, value at the end. A row with onPress is a button with a 48 px hit area. */
export function kRow(o: RowOptions): HTMLElement {
  const row = o.onPress ? el('button', 'k-row is-pressable') : el('div', 'k-row');
  if (o.icon) row.appendChild(el('span', 'k-row__icon', `[[${o.icon}]]`));
  row.appendChild(el('span', 'k-row__label', o.label));
  if (o.value !== undefined) row.appendChild(el('span', 'k-row__value', o.value));
  if (o.trailing) row.appendChild(o.trailing);
  if (o.onPress) {
    (row as HTMLButtonElement).type = 'button';
    bindPress(row, o.onPress);
  }
  return row;
}

// ---- Tabs ---------------------------------------------------------------------------------------------------------------------------

export interface TabSpec { id: string; label: string; badge?: number }

/**
 * A tab row on the game's `.tab-row` look, made an ARIA tab list by a11yDom.enhanceTabs (roles, roving tabindex, arrow keys that follow
 * the reading direction). Choosing a tab marks it and calls `onChange`; the caller draws the panel.
 */
export function kTabs(tabs: TabSpec[], active: string, onChange: (id: string) => void, label?: string, panel?: HTMLElement): HTMLDivElement {
  const row = el('div', 'tab-row k-tabs');
  const buttons = tabs.map((t) => {
    const b = el('button', `tab k-tab${t.id === active ? ' active' : ''}`, t.label);
    b.type = 'button';
    b.dataset.tab = t.id;
    if (t.badge) b.appendChild(kBadge(t.badge));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      for (const o of buttons) {
        const on = o === b;
        o.classList.toggle('active', on);
        o.setAttribute('aria-selected', String(on));
        o.tabIndex = on ? 0 : -1;
      }
      if (panel) panel.setAttribute('aria-labelledby', b.id);
      onChange(t.id);
    });
    return b;
  });
  row.append(...buttons);
  enhanceTabs(row, label, panel);
  return row;
}

// ---- Empty state --------------------------------------------------------------------------------------------------------------------

export function kEmpty(icon: string, text: string, cta?: { label: string; onPress: () => void }): HTMLDivElement {
  const box = el('div', 'k-empty');
  box.appendChild(el('div', 'k-empty__icon', `[[${icon}]]`));
  box.appendChild(el('p', 'k-empty__text', text));
  if (cta) box.appendChild(kButton({ variant: 'secondary', label: cta.label, onPress: cta.onPress }));
  return box;
}

// ---- Timer --------------------------------------------------------------------------------------------------------------------------

export interface TimerOptions {
  /** When it ends, in the clock of `now` (default Date.now, ms). */
  endsAt: number;
  now?: () => number;
  /** Called once when it reaches zero. */
  onDone?: () => void;
  /** Text at zero; default "Ready". */
  doneText?: string;
}

/** A countdown ("4h 12m", "12:05", "45s") that updates itself every second and stops when it ends or leaves the page. */
export function kTimer(o: TimerOptions): HTMLSpanElement {
  const node = el('span', 'k-timer');
  node.setAttribute('role', 'timer');
  const now = o.now ?? Date.now;
  let started = false;
  const tick = (): boolean => {
    const left = (o.endsAt - now()) / SECOND_MS;
    if (left <= 0) {
      node.textContent = o.doneText ?? i18n.t('kit.timer.done');
      node.classList.add('is-done');
      o.onDone?.();
      return false;
    }
    node.textContent = fmtDuration(left);
    return true;
  };
  if (!tick()) return node; // already over: onDone has run once, no interval
  // Ticks stop when it ends, when it is taken off the page after being on it, or if it never reaches the page within a few ticks.
  let ticks = 0;
  const id = window.setInterval(() => {
    ticks++;
    if (node.isConnected) started = true;
    else if (started || ticks > NEVER_ATTACHED_TICKS) { window.clearInterval(id); return; }
    if (!tick()) window.clearInterval(id);
  }, SECOND_MS);
  return node;
}
