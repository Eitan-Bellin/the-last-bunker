import { i18n } from '../../i18n/I18nManager';
import { fmtNum } from '../format';
import { BIOMES, POIS, type BiomeId } from '../../data/surface';
import { RESOURCE_ICONS, el } from '../../ui/dom';
import type { MissionReport, ResourceType, SurvivorState } from '../../core/GameState';
import { genderOf, portraitFor, portraitUrl } from '../../data/portraits';
import { biomeImage, journalTimeline } from '../../ui/expeditionText';
import { expeditionEvent } from '../../data/expeditionEvents';
import type { ActiveMission } from '../../core/GameState';
import type { GameApp } from '../../app';
import { eventDeadline, eventDescKey } from '../../systems/EventSystem';
import { knockWay } from '../popupRules';
import type { GameState } from '../../core/GameState';
import { choiceDetail } from '../../ui/eventText'; // [ux-wp5 C1/C2] text variants and choice hints

export const EVENT_ICONS: Record<string, string> = {
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
  returning: '[[door]]',
};

/** [phase2] Save flags (UI-side, no new state): the first knock was taught by its dialog; newcomers may walk in by themselves. */
const DOOR_TAUGHT = 'ui:doorTaught';
const DOOR_AUTO = 'ui:autoDoor';
/** [phase2] Set when the player turned automatic entry off: after the first knock taught the door, entry is automatic by default. */
const DOOR_MANUAL = 'ui:manualDoor';
/** [phase2] A save this far in (play seconds) has met the door already, whether or not it carries the flag (older saves). */
const DOOR_TAUGHT_AFTER_S = 1800;

/** Bunker events (the door, traders, radio...) and expedition choices and reports. */
export class EventController {
  private app: GameApp;
  /** [phase2] Knocks already told (card or walk-in), by event key, so each knock is told once. */
  private toldKnocks = new Set<string>();

  constructor(app: GameApp) {
    this.app = app;
  }

  // ---- [phase2] the door: the first knock is a dialog (it teaches), later ones a card and a bell line, or they walk in by themselves ----

  /** The event on the table is a knock at the door (the door clock's wanderer or pair). */
  isKnock(ev: GameState['activeEvent'] | undefined): boolean {
    return !!ev?.data?.knock;
  }

  /** The player has met the door (the first knock's dialog was shown), so later knocks need no dialog. */
  doorTaught(state: GameState): boolean {
    return state.storyFlags.includes(DOOR_TAUGHT) || state.stats.totalPlayTime > DOOR_TAUGHT_AFTER_S;
  }

  /** "Let newcomers in by themselves while there is a bed" (a save preference; the Menu may show it too: setAutoDoor). */
  get autoDoor(): boolean {
    const flags = this.app.state?.storyFlags;
    if (!flags) return false;
    // [phase2 lead] A card left on "Later" holds the event slot, so after the door is taught newcomers walk in by default.
    return flags.includes(DOOR_AUTO) || (this.doorTaught(this.app.state) && !flags.includes(DOOR_MANUAL));
  }

  setAutoDoor(on: boolean): void {
    const flags = this.app.state.storyFlags.filter(f => f !== DOOR_AUTO && f !== DOOR_MANUAL);
    this.app.engine.stateManager.applyDelta({ path: 'storyFlags', value: [...flags, on ? DOOR_AUTO : DOOR_MANUAL] });
    this.app.engine.requestSave();
  }

  /** Dialog queue: this event may skip the interruption budget (a raid at the door never waits; the first knock teaches the door). */
  budgetExempt(state: GameState): boolean {
    const ev = state.activeEvent;
    if (!ev) return false;
    return eventDeadline(ev) === null || (this.isKnock(ev) && !this.doorTaught(state));
  }

  /** The "let them in" choice that is possible now (both of a pair, else one of them), or null (no bed, or the food is short). */
  private acceptKey(): string | null {
    const es = this.app.engine.eventSystem;
    const c = es.getChoices().find(x => (x.key === 'accept' || x.key === 'one') && es.isChoiceAvailable(x));
    return c?.key ?? null;
  }

  /**
   * Called a few times a second (inbox.refresh). A knock after the first one: walks in by itself (auto on, a bed and the price there),
   * or comes as a card (Let in / Later) above the nav; it also stays in the bell until answered, or until it lapses (the door's own
   * deadline turns them away, as before).
   */
  watchDoor(state: GameState): void {
    const ev = state.activeEvent;
    if (!ev || !this.isKnock(ev) || !this.doorTaught(state) || this.app.engine.awayRunning) return;
    const key = `${ev.id}:${ev.at ?? 0}`;
    if (this.toldKnocks.has(key)) return;
    this.toldKnocks.add(key);
    const params = this.eventParams(ev.data);
    const accept = this.acceptKey();
    if (knockWay(true, this.autoDoor, accept !== null) === 'auto') {
      this.letIn(ev.id, accept!, params, true);
      return;
    }
    const still = () => { const now = this.app.state.activeEvent; return !!now && `${now.id}:${now.at ?? 0}` === key; };
    const actions: { label: string; primary?: boolean; onPress: () => void }[] = [
      { label: i18n.t('inbox.later'), onPress: () => undefined },
      accept
        ? { label: i18n.t(`event.${ev.id}.choice.accept`, params), primary: true, onPress: () => { if (still()) { const k = this.acceptKey(); if (k) this.letIn(ev.id, k, params, false); else this.showEvent(); } } }
        : { label: i18n.t('p2p.door.details'), primary: true, onPress: () => { if (still()) this.showEvent(); } },
    ];
    if (!this.autoDoor) actions.push({ label: i18n.t('p2p.door.always'), onPress: () => { this.setAutoDoor(true); this.app.toasts.show(`[[door]] ${i18n.t('p2p.door.alwaysOn')}`, 'good'); if (still()) { const k = this.acceptKey(); if (k) this.letIn(ev.id, k, params, false); } } });
    this.app.tips.pushNews({
      key: `door:${key}`, icon: EVENT_ICONS[ev.id] ?? '[[door]]', urgent: true, valid: still, sound: 'click',
      text: ev.id === 'group' ? i18n.t('p2p.door.knockTwo', params) : i18n.t('p2p.door.knock', params),
      actions,
    });
  }

  /** Lets the newcomer(s) in without a dialog: a toast says who (and that they walked in by themselves). */
  private letIn(eventId: string, choiceKey: string, params: Record<string, string>, auto: boolean): void {
    const result = this.app.engine.eventSystem.resolve(choiceKey);
    if (!result) return;
    this.app.engine.requestSave();
    this.app.audio.play('cheer', { volume: 0.7 });
    const text = i18n.t(`event.${eventId}.result.${result.key}`, params);
    this.app.toasts.show(`[[door]] ${text}${auto ? ` · ${i18n.t('p2p.door.auto')}` : ''}`, 'good');
  }

  showEvent(): void {
    const ev = this.app.state.activeEvent;
    if (!ev) return;
    // [phase2] The first knock's dialog teaches the door: later knocks come as a card.
    if (this.isKnock(ev) && !this.app.state.storyFlags.includes(DOOR_TAUGHT)) {
      this.app.engine.stateManager.applyDelta({ path: 'storyFlags', value: [...this.app.state.storyFlags, DOOR_TAUGHT] });
    }
    const params = this.eventParams(ev.data);
    const choices = this.app.engine.eventSystem.getChoices();

    this.app.modal.show({
      icon: EVENT_ICONS[ev.id] ?? '[[warning]]',
      title: i18n.t(`event.${ev.id}.title`, params),
      body: this.eventBody(ev.data, i18n.t(eventDescKey(ev), params)),
      actions: choices.map((c, i) => ({
        label: i18n.t(`event.${ev.id}.choice.${c.key}`, params),
        className: i === 0 ? 'btn-primary' : 'btn-secondary',
        disabled: !this.app.engine.eventSystem.isChoiceAvailable(c),
        detail: choiceDetail(this.app.state, c, params),
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
    // [ux-wp4] P10: letting a wanderer in needs no second "has joined! Continue" dialog: a toast says it and the game goes on.
    if (eventId === 'wanderer' && choiceKey === 'accept' && !result.gains && !(result.injured ?? []).length) {
      this.app.modal.hide();
      this.app.toasts.show(`[[door]] ${i18n.t(`event.${eventId}.result.${result.key}`, params)}`, 'good');
      return;
    }
    // [ux-redesign w2a #19] A find (the hidden stash) needs no second "Continue" dialog either: a toast says what was taken and the
    // goods fly up into their counters.
    if (eventId === 'stash' && !(result.injured ?? []).length) {
      this.app.modal.hide();
      const gains = result.gains ?? {};
      // [w4fix C4] Amounts read like the HUD ("400K", not "400000").
      const got = (Object.entries(gains) as [ResourceType, number][]).filter(([, v]) => v > 0).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''}${fmtNum(v)}`).join(' ');
      this.app.toasts.show(`${EVENT_ICONS.stash} ${i18n.t(`event.${eventId}.result.${result.key}`, params)}${got ? ` ${got}` : ''}`, 'good');
      this.app.feedback.flyGoods(gains, null); // [w4fix C1] from the middle; the numbers wait for the goods, then count
      return;
    }
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
