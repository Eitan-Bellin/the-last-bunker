import { i18n } from '../../i18n/I18nManager';
import { BIOMES, POIS, type BiomeId } from '../../data/surface';
import { costRow, el } from '../../ui/dom';
import type { MissionReport, SurvivorState } from '../../core/GameState';
import { genderOf, portraitFor, portraitUrl } from '../../data/portraits';
import { biomeImage, journalTimeline } from '../../ui/expeditionText';
import { expeditionEvent } from '../../data/expeditionEvents';
import type { ActiveMission } from '../../core/GameState';
import type { GameApp } from '../../app';

const EVENT_ICONS: Record<string, string> = {
  wanderer: '[[door]]',
  group: '[[people]]',
  stash: '[[storage]]',
  refugees: '[[people]]',
  pipeLeak: '[[waterPurifier]]',
  argument: '[[chat]]',
  trader: '[[cart]]',
  powerSurge: '[[power]]',
  sickness: '[[thermometer]]',
  radioSignal: '[[radioTower]]',
  radioSignal2: '[[dish]]',
  radioSignal3: '[[map]]',
  raiders: '[[skull]]',
};

/** Bunker events (the door, traders, radio...) and expedition choices and reports. */
export class EventController {
  private app: GameApp;

  constructor(app: GameApp) {
    this.app = app;
  }

  showEvent(): void {
    const ev = this.app.state.activeEvent;
    if (!ev) return;
    const params = this.eventParams(ev.data);
    const choices = this.app.engine.eventSystem.getChoices();

    this.app.modal.show({
      icon: EVENT_ICONS[ev.id] ?? '[[warning]]',
      title: i18n.t(`event.${ev.id}.title`, params),
      body: this.eventBody(ev.data, i18n.t(`event.${ev.id}.desc`, params)),
      actions: choices.map((c, i) => ({
        label: i18n.t(`event.${ev.id}.choice.${c.key}`, params),
        className: i === 0 ? 'btn-primary' : 'btn-secondary',
        disabled: !this.app.engine.eventSystem.isChoiceAvailable(c),
        detail: c.cost ? costRow(this.app.state, c.cost as Record<string, number>) : undefined,
        onClick: () => this.resolveEvent(ev.id, c.key, params),
      })),
    });
  }

  /** Events about a person (a wanderer at the door) show their painted portrait. */
  eventBody(data: Record<string, unknown>, text: string): string | HTMLElement {
    const people = ((data.group as SurvivorState[] | undefined) ?? (data.survivor ? [data.survivor as SurvivorState] : []))
      .filter(p => p?.name);
    if (people.length === 0) return text;
    const wrap = el('div');
    const row = el('div', 'modal-portraits');
    for (const p of people) {
      const img = el('img', 'modal-portrait');
      img.src = portraitUrl(portraitFor(p));
      img.alt = '';
      row.appendChild(img);
    }
    wrap.append(row, el('p', 'modal-body', text));
    return wrap;
  }

  resolveEvent(eventId: string, choiceKey: string, params: Record<string, string>): void {
    const result = this.app.engine.eventSystem.resolve(choiceKey);
    if (!result) {
      this.app.modal.hide();
      return;
    }
    this.app.engine.notifyInteraction();
    this.app.engine.requestSave();
    this.app.audio.play(eventId === 'trader' && result.gains ? 'coin' : 'click');
    const body = el('div', 'modal-result');
    body.appendChild(el('p', 'modal-body', i18n.t(`event.${eventId}.result.${result.key}`, params)));
    if (result.gains) body.appendChild(this.app.welcome.gainsList(result.gains));
    for (const inj of result.injured ?? []) {
      body.appendChild(el('p', 'modal-sub negative-text', `[[bandage]] ${i18n.t('mission.injury', { name: this.app.localName(inj.name), n: inj.damage, ...this.app.gByName(inj.name, (inj as { id?: string }).id) })}`));
    }

    this.app.modal.show({
      icon: EVENT_ICONS[eventId] ?? '[[warning]]',
      title: i18n.t(`event.${eventId}.title`, params),
      body,
      actions: [{ label: i18n.t('event.ok'), onClick: () => this.app.modal.hide() }],
    });
  }

  eventParams(data: Record<string, unknown>): Record<string, string> {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string') params[k] = k.startsWith('name') ? this.app.localName(v) : v;
      else if (typeof v === 'number') params[k] = String(v);
    }
    // An event about one person (a wanderer, a sick resident) is worded for their gender.
    const who = (data.survivor as SurvivorState | undefined) ?? this.app.state.survivors.find(x => x.id === data.survivorId);
    if (who?.name) params.g = genderOf(who);
    return params;
  }

  /** The team on the surface radios home with a decision. */
  showMissionChoice(m: ActiveMission): void {
    const ev = m.event ? expeditionEvent(m.event.id) : undefined;
    if (!ev) return;
    if (ev.id === 'storm') this.app.audio.play('thunder');
    const locale = i18n.currentLocale;
    const hex = this.app.engine.explorationSystem.getHex(this.app.state, m.hexX, m.hexY);
    const body = el('div', 'modal-result exp-choice');
    const art = biomeImage(hex?.biome);
    if (art) body.appendChild(art);
    const team = m.survivorIds.map(id => this.app.state.survivors.find(s => s.id === id)).filter((s): s is SurvivorState => !!s);
    const faces = el('div', 'exp-team');
    for (const s of team) {
      const img = el('img', 'worker-face');
      img.src = portraitUrl(portraitFor(s));
      img.alt = '';
      faces.appendChild(img);
    }
    body.append(faces, el('p', 'modal-sub', `[[signal]] ${i18n.t('exp.radio', { place: hex ? BIOMES[hex.biome as BiomeId].name[locale] : '' })}`), el('p', 'modal-body', ev.text[locale]));
    const hints = (o: typeof ev.options[number]) => {
      const parts: string[] = [];
      if ((o.lootMult ?? 1) > 1 || o.loot) parts.push(`[[backpack]] ${i18n.t('exp.moreLoot')}`);
      if ((o.lootMult ?? 1) < 1) parts.push(`[[backpack]] ${i18n.t('exp.lessLoot')}`);
      if (o.injury) parts.push(`[[bandage]] ${i18n.t('exp.risk')}`);
      if ((o.timeMult ?? 1) > 1) parts.push(`[[clock]] ${i18n.t('exp.slower')}`);
      if ((o.timeMult ?? 1) < 1) parts.push(`[[clock]] ${i18n.t('exp.faster')}`);
      if (o.recruit) parts.push(`[[person]] ${i18n.t('exp.maybeRecruit')}`);
      if (o.reveal) parts.push(`[[map]] ${i18n.t('exp.reveal')}`);
      return parts.length ? el('span', 'exp-hints', parts.join('  ')) : undefined;
    };
    this.app.modal.show({
      icon: `[[${ev.icon}]]`,
      title: ev.title[locale],
      body,
      actions: ev.options.map((o, i) => ({
        label: o.label[locale],
        className: i === 0 ? 'btn-secondary' : 'btn-primary',
        detail: hints(o),
        onClick: () => {
          this.app.engine.explorationSystem.choose(m.id, o.key);
          this.app.audio.play('choice');
          this.app.engine.requestSave();
          this.app.modal.hide();
          this.app.toasts.show(`[[chat]] ${o.result[locale]}`, 'info');
        },
      })),
    });
  }

  showMissionReport(report: MissionReport): void {
    const locale = i18n.currentLocale;
    const hex = this.app.engine.explorationSystem.getHex(this.app.state, report.hexX, report.hexY);
    const biome = hex ? BIOMES[hex.biome as BiomeId].name[locale] : '';
    const body = el('div', 'modal-result');
    const art = biomeImage(report.biome ?? hex?.biome);
    if (art) body.appendChild(art);
    if (report.success) setTimeout(() => this.app.audio.play('cheer', { volume: 0.8 }), 300);
    if (report.firstVisit) setTimeout(() => this.app.audio.play('reveal'), 900);
    body.appendChild(el('p', 'modal-body', i18n.t(report.success ? 'mission.success' : 'mission.failure', { place: biome })));
    if (report.poi) {
      const poi = POIS[report.poi];
      body.appendChild(el('p', 'modal-sub', `${poi.icon} ${i18n.t('mission.foundPoi', { name: poi.name[locale] ?? poi.name.en })}`));
    }
    body.appendChild(this.app.welcome.gainsList(report.loot));
    if (report.recruitName) {
      body.appendChild(el('p', 'modal-sub positive-text', `[[person]] ${i18n.t('mission.recruit', { name: this.app.localName(report.recruitName), ...this.app.gByName(report.recruitName) })}`));
    }
    for (const inj of report.injuries) {
      body.appendChild(el('p', 'modal-sub negative-text', `[[bandage]] ${i18n.t('mission.injury', { name: this.app.localName(inj.name), n: inj.damage, ...this.app.gByName(inj.name, (inj as { id?: string }).id) })}`));
    }
    if (report.journal?.length) {
      const details = el('details', 'exp-log');
      details.appendChild(el('summary', '', `[[journal]] ${i18n.t('exp.log')}`));
      details.appendChild(journalTimeline(report.journal, biome, (n: string) => this.app.localName(n)));
      body.appendChild(details);
    }
    this.app.modal.show({
      icon: report.success ? '[[backpack]]' : '[[bandage]]',
      title: i18n.t('mission.title'),
      body,
      actions: [{
        label: i18n.t('event.ok'),
        onClick: () => {
          this.app.engine.explorationSystem.dismissReport();
          this.app.engine.requestSave();
          this.app.modal.hide();
        },
      }],
    });
  }
}
