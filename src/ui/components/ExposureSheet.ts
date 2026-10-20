import type { GameEngine } from '../../core/GameEngine';
import type { GameState } from '../../core/GameState';
import { i18n } from '../../i18n/I18nManager';
import { el } from '../dom';
import { fmtNum } from '../format';
import { kButton, kCard, kProgress, kRow } from '../kit';
import { Sheet } from './Sheet';
import { actCurrency, exposureDrivers, hideStoresTrim } from '../../systems/ThreatSystem';
import { bunkerDefense, raidForecast, raidStrength, winChance } from '../../systems/EventSystem';
import { exposureLevel } from './ExposureGauge';
import '../../styles/p4b-d.css';

/** Seconds between the sheet's own refreshes while it is open (it reads the live state; the app does not have to drive it). */
const REFRESH_MS = 1000;

/**
 * [phase4b] (C4) The Exposure sheet: the meter, the next raid, what draws the raiders (stores, radio, people, outposts, and the part no
 * lever moves), and the two levers, each with what it would do "in your bunker" before the tap.
 */
export class ExposureSheet {
  private sheet = new Sheet('p4bd-exposure-sheet', 'threat');
  private engine: GameEngine;
  private sig = '';
  private timer = 0;
  private root: HTMLElement | null = null;

  constructor(engine: GameEngine) {
    this.engine = engine;
    this.sheet.onClose = () => this.stop();
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  show(state: GameState = this.engine.stateManager.state): void {
    this.sig = '';
    this.sheet.setTitle(`[[eye]] ${i18n.t('p4bD.exp.title')}`);
    this.refresh(state);
    this.sheet.show();
    this.stop();
    this.timer = window.setInterval(() => { if (this.sheet.isVisible) this.refresh(this.engine.stateManager.state); else this.stop(); }, REFRESH_MS);
  }

  hide(): void {
    this.sheet.hide();
  }

  private stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  refresh(state: GameState): void {
    const lg = state.longGame;
    if (!lg) return;
    const meter = Math.round(lg.threat.meter);
    const d = exposureDrivers(state);
    const f = raidForecast(state);
    const sig = [meter, Math.round(d.total), Math.round(d.stores), Math.round(d.radio), Math.round(d.people), Math.round(d.outposts), Math.round(d.rest),
      Math.round(d.levers), !!lg.threat.hideStores, !!lg.threat.radioSilence, f.eta === null ? -1 : Math.floor(f.eta / 30), f.warned, Math.round(f.breather / 600),
      bunkerDefense(state), state.survivors.length, state.maxPopulation, i18n.currentLocale].join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    const box = el('div', 'p4bd-sheet');
    const level = exposureLevel(meter);
    box.dataset.level = level;
    const head = el('div', 'p4bd-head');
    head.append(el('span', 'p4bd-head__n', `${meter}/100`), el('span', 'p4bd-head__level', i18n.t(`p4bD.exp.level.${level}`)));
    const target = Math.round(d.total);
    const trend = target > meter + 1 ? i18n.t('p4bD.exp.rising', { n: target }) : target < meter - 1 ? i18n.t('p4bD.exp.falling', { n: target }) : i18n.t('p4bD.exp.steady');
    const bar = kProgress(meter, 100, i18n.t('p4bD.exp.now', { n: meter, level: i18n.t(`p4bD.exp.level.${level}`) }));
    box.append(head, bar, el('div', 'p4bd-line', `${trend} ${i18n.t('p4bD.exp.why')}`));

    // The raids: the next one, the pace while away, the breather; and the odds of holding the door against a gang sized up now.
    const raid = el('div', 'p4bd-raid');
    if ((state.era ?? 0) < 2) raid.appendChild(el('div', 'p4bd-line', `[[armory]] ${i18n.t('p4bD.exp.noRaids')}`));
    else {
      if (f.warned && f.eta !== null) raid.appendChild(el('div', 'p4bd-line is-bad', `[[armory]] ${i18n.t('p4bD.exp.raidNow', { t: i18n.formatDuration(f.eta) })}`));
      else if (f.eta !== null) raid.appendChild(el('div', 'p4bd-line', `[[clock]] ${i18n.t('p4bD.exp.nextRaid', { t: i18n.formatDuration(Math.max(60, f.eta)) })}`));
      if (f.breather > 0) raid.appendChild(el('div', 'p4bd-line', `[[hourglass]] ${i18n.t('p4bD.exp.breather', { t: i18n.formatDuration(f.breather) })}`));
      else raid.appendChild(el('div', 'p4bd-line', `[[moon]] ${i18n.t('p4bD.exp.away', { n: f.awayPerDay.toFixed(1) })}`));
      const def = bunkerDefense(state);
      const gang = raidStrength(state, 0.5);
      raid.appendChild(el('div', 'p4bd-line', `[[endurance]] ${i18n.t('p4bD.exp.defense', { n: fmtNum(def), s: fmtNum(gang), pct: Math.round(winChance(def, gang) * 100) })}`));
    }
    box.appendChild(raid);

    // What draws them: the four drivers the player moves, the rest, and the levers' cut.
    const drivers = el('div', 'p4bd-drivers');
    drivers.appendChild(el('div', 'bp-section-title', i18n.t('p4bD.exp.drivers')));
    const outposts = ((lg.world.outposts ?? []) as { readyAt?: number }[]).filter(o => (o?.readyAt ?? 0) <= lg.meta.worldT).length;
    const plus = (v: number) => `+${Math.round(v)}`;
    drivers.append(
      kRow({ icon: 'storage', label: i18n.t('p4bD.exp.stores'), value: plus(d.stores) }),
      kRow({ icon: 'signal', label: i18n.t('p4bD.exp.radio'), value: plus(d.radio) }),
      kRow({ icon: 'people', label: i18n.t('p4bD.exp.people', { n: state.survivors.length }), value: plus(d.people) }),
      kRow({ icon: 'tent', label: i18n.t('p4bD.exp.outposts', { n: outposts }), value: plus(d.outposts) }),
      kRow({ icon: 'books', label: i18n.t('p4bD.exp.rest'), value: plus(d.rest) }),
    );
    if (d.levers < 0) {
      const cut = kRow({ icon: 'check', label: i18n.t('p4bD.exp.levers'), value: `−${Math.round(-d.levers)}` });
      cut.classList.add('is-cut');
      drivers.appendChild(cut);
    }
    box.appendChild(drivers);

    // The two levers, each with its effect in this bunker.
    box.appendChild(el('div', 'bp-section-title', i18n.t('p4bD.exp.leversTitle')));
    const cur = i18n.t(`resources.${actCurrency(state)}`);
    const hideOn = !!lg.threat.hideStores;
    const silentOn = !!lg.threat.radioSilence;
    const from = Math.round(d.total);
    const hideTo = Math.round(exposureDrivers(state, { hideStores: !hideOn }).total);
    const silentTo = Math.round(exposureDrivers(state, { radioSilence: !silentOn }).total);
    box.appendChild(this.lever('storage', i18n.t('p4bD.lever.hide'), hideOn,
      hideOn ? i18n.t('p4bD.lever.hide.on', { cur }) : i18n.t('p4bD.lever.hide.off', { from, to: hideTo, n: fmtNum(hideStoresTrim(state).gained), cur }),
      () => this.engine.threatSystem.setHideStores(!hideOn)));
    box.appendChild(this.lever('signal', i18n.t('p4bD.lever.silence'), silentOn,
      silentOn ? i18n.t('p4bD.lever.silence.on') : i18n.t('p4bD.lever.silence.off', { from, to: silentTo, n: Math.max(0, state.maxPopulation - state.survivors.length) }),
      () => this.engine.threatSystem.setRadioSilence(!silentOn)));

    if (this.root) this.root.replaceWith(box);
    else this.sheet.body.replaceChildren(box);
    this.root = box;
    if (!box.isConnected) this.sheet.body.replaceChildren(box);
  }

  private lever(icon: string, name: string, on: boolean, text: string, toggle: () => void): HTMLElement {
    const top = el('div', 'p4bd-lever__top');
    const btn = kButton({
      variant: on ? 'secondary' : 'primary',
      label: i18n.t(on ? 'p4bD.lever.turnOff' : 'p4bD.lever.turnOn'),
      onPress: () => {
        toggle();
        this.engine.notifyInteraction();
        this.engine.requestSave();
        this.sig = '';
        this.refresh(this.engine.stateManager.state);
      },
    });
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', String(on));
    btn.setAttribute('aria-label', name);
    top.append(el('span', 'p4bd-lever__name', `[[${icon}]] ${name}`), btn);
    const card = kCard({ className: `p4bd-lever${on ? ' is-on' : ''}`, children: [top, el('div', 'p4bd-line', text)] });
    return card;
  }
}
