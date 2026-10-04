import type { OfflineReport } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { getResearch } from '../../data/research';
import { RESOURCE_ICONS, el } from '../../ui/dom';
import type { ResourceType } from '../../core/GameState';
import { portraitFor, portraitUrl } from '../../data/portraits';
import type { GameApp } from '../../app';

/** The welcome-back report and the daily supply drop. */
export class WelcomeController {
  private app: GameApp;

  constructor(app: GameApp) {
    this.app = app;
  }

  /**
   * Welcome back (S6): what was made, what overflowed full storage, who came home, what research finished,
   * and the people waiting at the door, whose answer is the first thing the player does this session.
   */
  showWelcome(report: OfflineReport | null): void {
    this.app.welcomeOpen = true;
    // Whatever closes this dialog (a button, or another dialog taking its place) ends the "welcome is open" state.
    const onDismiss = () => { this.app.welcomeOpen = false; };
    this.app.audio.play('event');
    const state = this.app.state;
    const locale = i18n.currentLocale;
    const body = el('div', 'modal-result');
    if (report) {
      body.appendChild(el('p', 'modal-body', i18n.t('welcome.away', { time: i18n.formatDuration(report.seconds) })));
      if (Object.keys(report.gained).length > 0) {
        body.appendChild(el('p', 'modal-sub', i18n.t('welcome.produced')));
        body.appendChild(this.gainsList(report.gained));
      }
      // [Economy A1/A3] Overflow became credits (and fed the active project) instead of being lost.
      const converted = report.converted ?? {};
      if ((report.credits ?? 0) > 0 || Object.keys(report.absorbed ?? {}).length > 0) {
        if (report.credits > 0) {
          body.appendChild(el('p', 'modal-sub', `[[storage]] ${i18n.t('welcome.converted', { credits: report.credits })}`));
          body.appendChild(this.gainsList(converted));
        }
        if (Object.keys(report.absorbed ?? {}).length > 0) {
          body.appendChild(el('p', 'modal-sub', i18n.t('welcome.absorbed')));
          body.appendChild(this.gainsList(report.absorbed));
        }
        body.appendChild(el('p', 'bp-hint', i18n.t('welcome.convertedHint')));
      }
      const wasted = report.wasted ?? {};
      if (Object.keys(wasted).length > 0) {
        body.appendChild(el('p', 'modal-sub negative-text', `[[storage]] ${i18n.t('welcome.wasted')}`));
        body.appendChild(this.gainsList(Object.fromEntries(Object.entries(wasted).map(([r, v]) => [r, -(v ?? 0)]))));
        body.appendChild(el('p', 'bp-hint', i18n.t('welcome.wastedHint')));
      }
      if (report.missions > 0) body.appendChild(el('p', 'modal-sub', `[[backpack]] ${i18n.t('welcome.missions', { n: report.missions })}`));
      if (report.research?.length) {
        const names = report.research.map(id => (getResearch(id) ?? this.app.engine.researchSystem.defOf(state, id))?.name[locale] ?? id).join(', ');
        body.appendChild(el('p', 'modal-sub', `[[research]] ${i18n.t('welcome.research', { names })}`));
      }
      // [Danger C4] the soft version of what struck while away
      const dg = report.danger;
      if (dg && (dg.raids > 0 || dg.disasters.length > 0)) {
        const parts: string[] = [];
        if (dg.raids > 0) parts.push(i18n.t('welcome.danger.raids', { n: dg.raids, lost: dg.raidsLost }));
        if (dg.disasters.length > 0) parts.push(i18n.t('welcome.danger.disasters', { n: dg.disasters.length }));
        if (dg.hurt > 0) parts.push(i18n.t('welcome.danger.hurt', { n: dg.hurt }));
        body.appendChild(el('p', 'modal-sub negative-text', `[[warning]] ${i18n.t('welcome.danger.title')} ${parts.join(' · ')}`));
        if (dg.died.length > 0) body.appendChild(el('p', 'modal-sub negative-text', `[[skull]] ${i18n.t('welcome.danger.died', { names: dg.died.map(n => this.app.localName(n)).join(', ') })}`));
        else body.appendChild(el('p', 'bp-hint', i18n.t('welcome.danger.hint')));
      }
    }
    const waiting = state.doorWaiting ?? [];
    const close = () => {
      this.app.welcomeOpen = false;
      this.app.modal.hide();
    };
    if (waiting.length === 0) {
      const actions = [{ label: i18n.t('welcome.ok'), onClick: close }] as { label: string; className?: string; onClick: () => void }[];
      // [Economy A1] a shortcut to spend the credits the overflow earned.
      if ((report?.credits ?? 0) > 0) actions.unshift({ label: i18n.t('welcome.toShop'), className: 'btn-secondary', onClick: () => { close(); this.app.journal.showShop(this.app.state); } });
      this.app.modal.show({ icon: '[[vault]]', title: i18n.t('welcome.title'), body, actions, onDismiss });
      return;
    }
    // The doorstep: faces and names of who waited through the night.
    const door = el('div', 'welcome-door');
    const row = el('div', 'modal-portraits');
    for (const p of waiting) {
      const img = el('img', 'modal-portrait');
      img.src = portraitUrl(portraitFor(p));
      img.alt = '';
      row.appendChild(img);
    }
    const names = waiting.map(p => this.app.localName(p.name)).join(', ');
    door.append(row, el('p', 'modal-body', `[[door]] ${i18n.t(waiting.length === 1 ? 'welcome.doorOne' : 'welcome.door', { n: waiting.length, names })}`));
    const beds = state.maxPopulation - state.survivors.length;
    if (beds < waiting.length) door.appendChild(el('p', 'bp-hint negative-text', i18n.t(beds <= 0 ? 'welcome.doorNoBeds' : 'welcome.doorBeds', { n: Math.max(0, beds) })));
    body.appendChild(door);
    const answer = (accept: boolean) => {
      const n = this.app.engine.answerDoor(accept);
      close();
      this.app.audio.play(accept && n > 0 ? 'cheer' : 'click');
      this.app.toasts.show(accept && n > 0 ? `[[people]] ${i18n.t('welcome.doorIn', { n })}` : `[[door]] ${i18n.t('welcome.doorAway')}`, accept && n > 0 ? 'good' : 'info');
    };
    this.app.modal.show({
      icon: '[[door]]',
      title: i18n.t('welcome.title'),
      body,
      actions: [
        { label: i18n.t('welcome.doorAccept'), className: 'btn-primary', disabled: beds <= 0, onClick: () => answer(true) },
        { label: i18n.t('welcome.doorRefuse'), className: 'btn-secondary', onClick: () => answer(false) },
      ],
      onDismiss,
    });
  }

  gainsList(gains: Partial<Record<ResourceType, number>>): HTMLElement {
    const list = el('div', 'gains-list');
    for (const [r, v] of Object.entries(gains) as [ResourceType, number][]) {
      if (!v) continue;
      list.appendChild(el('span', `gain-chip ${v > 0 ? 'positive' : 'negative'}`, `${RESOURCE_ICONS[r] ?? ''} ${v > 0 ? '+' : '−'}${Math.abs(Math.round(v))}`));
    }
    return list;
  }

  /** The daily supply drop: open today's crate (NICE3). */
  openSupplyDrop(): void {
    const claim = this.app.engine.supplySystem.claim();
    if (!claim) return;
    this.app.engine.requestSave();
    this.app.audio.play('achievement');
    const body = el('div', 'modal-result');
    body.appendChild(el('p', 'modal-body', i18n.t('supply.desc')));
    body.appendChild(this.gainsList(claim.gains));
    body.appendChild(el('p', 'modal-sub', `[[hourglass]] ${i18n.t('rush.gift', { n: claim.rush })}`));
    if (Object.keys(claim.gains).length === 0) body.appendChild(el('p', 'bp-hint', i18n.t('supply.full')));
    body.appendChild(el('p', 'modal-sub', `[[fire]] ${i18n.t('supply.streak', { n: claim.streak })}`));
    body.appendChild(el('p', 'bp-hint', i18n.t('supply.tomorrow')));
    this.app.modal.show({ icon: '[[gift]]', title: i18n.t('supply.title'), body, actions: [{ label: i18n.t('event.ok'), onClick: () => this.app.modal.hide() }] });
  }
}
