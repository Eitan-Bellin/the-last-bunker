import type { GameState } from '../../core/GameState';
import { i18n } from '../../i18n/I18nManager';
import { el } from '../dom';
import { haptic } from '../../utils/haptics';
import { threatTarget } from '../../systems/ThreatSystem';
import '../../styles/p4b-d.css';

/** [phase4b] Exposure bands: under 35 unnoticed, under 65 watched, then hunted (the gauge's colour and word). */
export function exposureLevel(n: number): 'low' | 'mid' | 'high' {
  return n < 35 ? 'low' : n < 65 ? 'mid' : 'high';
}

/** [phase4b] Whether the bunker has an Exposure to show: a long game that has reached the raids (the second era, as raidTick). */
export function exposureShown(state: GameState): boolean {
  return !!state.longGame && !state.longGame.meta.legacy && (state.era ?? 0) >= 2;
}

/**
 * [phase4b] (C4) The Exposure gauge in the HUD row, next to the status chip: an eye over the number (0-100), a ring that fills with it,
 * the band as colour AND shape (the eye opens wider: low / mid / high), and a dot while a raid is on its way. One tap opens the
 * Exposure sheet (HUD.onExposure). It takes one 44 px place, so the four tiles still fit at 320 px.
 */
export class ExposureGauge {
  readonly root: HTMLButtonElement;
  private value: HTMLElement;
  private ring: HTMLElement;
  private sig = '';
  private lastAt = 0;
  onPress: (() => void) | null = null;

  constructor() {
    this.root = el('button', 'hx-chip p4bd-gauge');
    this.root.type = 'button';
    this.ring = el('span', 'p4bd-gauge__ring');
    this.ring.setAttribute('aria-hidden', 'true');
    const icon = el('span', 'p4bd-gauge__icon', '[[eye]]');
    icon.setAttribute('aria-hidden', 'true');
    this.value = el('span', 'p4bd-gauge__value', '0');
    this.value.setAttribute('aria-hidden', 'true');
    const dot = el('span', 'p4bd-gauge__dot');
    dot.setAttribute('aria-hidden', 'true');
    this.root.append(this.ring, icon, this.value, dot);
    this.root.style.display = 'none';
    this.root.setAttribute('aria-haspopup', 'dialog');
    this.root.addEventListener('click', () => { haptic('tap'); this.onPress?.(); });
  }

  /** Called every frame by the HUD; writes at most once a second, and only what changed. */
  update(state: GameState): void {
    const now = performance.now();
    if (now - this.lastAt < 1000 && this.sig) return;
    this.lastAt = now;
    const shown = exposureShown(state);
    const n = Math.round(state.longGame?.threat.meter ?? 0);
    const target = shown ? Math.round(threatTarget(state)) : n;
    const raid = !!state.danger?.raid;
    const level = exposureLevel(n);
    const trend = target > n + 1 ? 'up' : target < n - 1 ? 'down' : '';
    const sig = `${shown}|${n}|${trend}|${raid}|${i18n.currentLocale}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.root.style.display = shown ? '' : 'none';
    // On a phone the row has no room for both: the gauge takes the "+N" handle's place (p4b-d.css), as under 360 px already.
    this.root.parentElement?.classList.toggle('p4bd-has-gauge', shown);
    if (!shown) return;
    this.value.textContent = String(n);
    this.root.dataset.level = level;
    this.root.dataset.trend = trend;
    this.root.classList.toggle('is-raid', raid);
    this.ring.style.setProperty('--p4bd-fill', `${Math.max(0, Math.min(100, n))}%`);
    const raidText = raid ? i18n.t('danger.raid.title') : '';
    const label = i18n.t('p4bD.exp.label', { n, level: i18n.t(`p4bD.exp.level.${level}`), raid: raidText });
    this.root.setAttribute('aria-label', label);
    this.root.title = i18n.t('p4bD.exp.now', { n, level: i18n.t(`p4bD.exp.level.${level}`) });
  }
}
