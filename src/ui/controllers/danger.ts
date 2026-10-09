import { getDef } from '../../data/buildingDefs';
import type { BuildingType, RaidStance } from '../../core/GameState';
import { haptic } from '../../utils/haptics';
import { i18n } from '../../i18n/I18nManager';
import { costRow, el } from '../../ui/dom';
import { portraitFor, portraitUrl } from '../../data/portraits';
import { INCIDENTS, DISASTERS, disasterCost, quickFixCost } from '../../data/incidents';
import { missingOr } from '../missing'; // [ux-wp3 A1]
import { causeText } from './feedback'; // [ux-wp3 W1]
import { CEREMONY_COST } from '../../systems/DeathSystem';
import { bunkerDefense, defenseParts, raidTribute, type RaidResult } from '../../systems/EventSystem';
import { announce } from '../a11yDom';
import type { GameApp } from '../../app';

/** [ux-wp3 F3] A quiet reminder while a danger waits (ms), and the countdown at the end (game seconds). */
const REMINDER_MS = 90_000;
const COUNTDOWN_S = 10;
const REMINDER_VOLUME = 0.35;

/** Raids, disasters, incidents in rooms, and the memorial. */
export class DangerController {
  private app: GameApp;

  constructor(app: GameApp) {
    this.app = app;
  }

  lastIncidentAlarm = 0;
  /** [ux-wp3 F3] The danger the tension curve is following (a new one starts the curve again), and the last countdown second played. */
  private curveKey = '';
  private lastTickS = -1;
  private lastWarnAt = 0;

  /** The banner for the most urgent danger on the clock (null = calm). */
  dangerBanner(): { text: string; kind: string; left: number } | null {
    const d = this.app.state.danger;
    if (!d) return null;
    const now = this.app.state.stats.totalPlayTime;
    const locale = i18n.currentLocale;
    const dz = [...d.disasters].sort((a, b) => a.deadline - b.deadline)[0];
    const raidLeft = d.raid ? Math.max(0, d.raid.hitAt - now) : Infinity;
    if (dz && dz.deadline - now <= raidLeft) {
      const def = DISASTERS[dz.kind];
      const room = dz.buildingId ? ` · ${this.app.roomName(dz.buildingId)}` : '';
      return {
        text: `[[${def.icon}]] ${i18n.t('danger.banner.disaster', { name: def.name[locale], time: i18n.formatDuration(dz.deadline - now) })}${room} · ${i18n.t('danger.tapHint')}`,
        kind: 'danger',
        left: Math.max(0, dz.deadline - now),
      };
    }
    if (d.raid) {
      // [ux-wp3 F3] The last ten seconds read as a countdown ("Raiders at the gate in 7 s").
      const text = raidLeft <= COUNTDOWN_S ? i18n.t('wp3.raid.soon', { t: i18n.formatDuration(raidLeft) }) : `${i18n.t('danger.banner.raid', { time: i18n.formatDuration(raidLeft) })} · ${i18n.t('danger.tapHint')}`;
      return { text: `[[armory]] ${text}`, kind: 'raid', left: raidLeft };
    }
    return null;
  }

  /** The decision window for the most urgent danger: the raid (pay or fight) or a disaster (handle it). */
  showDanger(): void {
    const state = this.app.state;
    const d = state.danger;
    const now = state.stats.totalPlayTime;
    const locale = i18n.currentLocale;
    const dz = [...d.disasters].sort((a, b) => a.deadline - b.deadline)[0];
    const raidLeft = d.raid ? Math.max(0, d.raid.hitAt - now) : Infinity;
    const body = el('div', 'modal-result');
    const later = { label: i18n.t('danger.disaster.later'), className: 'btn-secondary', onClick: () => this.app.modal.hide() };
    const more = d.disasters.length + (d.raid ? 1 : 0) - 1;
    const note = more > 0 ? el('p', 'bp-hint', i18n.t('danger.more', { n: more })) : null;
    if (dz && dz.deadline - now <= raidLeft) {
      const def = DISASTERS[dz.kind];
      const cost = disasterCost(state, dz.kind);
      const block = this.app.engine.incidentSystem.handleBlock(dz.id);
      body.append(
        el('p', 'modal-body', def.desc[locale]),
        el('p', 'modal-sub negative-text', `[[clock]] ${i18n.t('danger.disaster.eta', { time: i18n.formatDuration(dz.deadline - now) })}`),
        el('p', 'bp-hint', `[[worker]] ${i18n.t('danger.disaster.crew', { n: def.crew })}`),
      );
      if (block === 'cost') body.appendChild(el('p', 'bp-hint negative-text', i18n.t('danger.disaster.noCost')));
      if (block === 'crew') body.appendChild(el('p', 'bp-hint negative-text', i18n.t('danger.disaster.noCrew')));
      if (note) body.appendChild(note);
      this.app.modal.show({
        icon: `[[${def.icon}]]`,
        title: def.name[locale],
        body,
        actions: [
          {
            label: def.handleLabel[locale], disabled: !!block, detail: costRow(state, cost),
            onClick: () => {
              if (this.app.engine.incidentSystem.handle(dz.id)) {
                this.app.engine.notifyInteraction();
                this.app.engine.requestSave();
                this.app.audio.play('fixed');
              } else this.app.toasts.show(missingOr(this.app.state, disasterCost(this.app.state, dz.kind)), 'bad'); // [ux-wp3 A1]
              this.app.modal.hide();
            },
          },
          later,
        ],
      });
      return;
    }
    if (!d.raid) return;
    const raid = d.raid;
    const tribute = raidTribute(state) as Record<string, number>;
    const kind = raid.kind;
    const stance = raid.stance ?? 'hold';
    const defHold = bunkerDefense(state, kind, 'hold');
    const defSally = bunkerDefense(state, kind, 'sally');
    const weak = defHold < raid.strength;
    body.append(el('p', 'modal-body', i18n.t('danger.raid.body', { strength: raid.strength, defense: defHold, time: i18n.formatDuration(raidLeft) })));
    // [P2] The scout report: who is coming and what stops them.
    if (kind) {
      const p = defenseParts(state);
      body.append(
        el('p', 'modal-sub', `[[eye]] ${i18n.t(`raid.kind.${kind}`)}`),
        el('p', 'bp-hint', i18n.t('raid.parts', { walls: Math.round(p.walls), guards: Math.round(p.guards), residents: Math.round(p.residents) })),
      );
    }
    body.appendChild(el('p', `bp-hint ${weak ? 'negative-text' : ''}`, i18n.t(weak ? 'danger.raid.hintWeak' : 'danger.raid.hintOk')));
    if (note) body.appendChild(note);
    const choose = (s: RaidStance) => () => {
      this.app.engine.eventSystem.setStance(s);
      this.app.engine.notifyInteraction();
      this.app.engine.requestSave();
      this.app.modal.hide();
      this.app.toasts.show(`[[armory]] ${i18n.t(`raid.stance.${s}.set`)}`, 'info');
    };
    const odds = (v: number) => i18n.t(v >= raid.strength ? 'raid.odds.win' : 'raid.odds.lose', { def: v, str: raid.strength });
    this.app.modal.show({
      icon: '[[armory]]',
      title: i18n.t('danger.raid.title'),
      body,
      actions: [
        { label: `${stance === 'hold' ? '✓ ' : ''}${i18n.t('raid.stance.hold')}`, className: !weak ? 'btn-primary' : 'btn-secondary', detail: el('span', 'difficulty-desc', odds(defHold)), onClick: choose('hold') },
        ...(kind ? [{ label: `${stance === 'sally' ? '✓ ' : ''}${i18n.t('raid.stance.sally')}`, className: weak && defSally >= raid.strength ? 'btn-primary' : 'btn-secondary', detail: el('span', 'difficulty-desc', odds(defSally)), onClick: choose('sally') }] : []),
        {
          label: i18n.t('danger.raid.pay'), className: weak && defSally < raid.strength ? 'btn-primary' : 'btn-secondary', disabled: !this.app.engine.eventSystem.canPayTribute(),
          detail: costRow(state, tribute),
          onClick: () => {
            this.app.engine.eventSystem.payTribute();
            this.app.engine.notifyInteraction();
            this.app.engine.requestSave();
            this.app.modal.hide();
          },
        },
        ...(kind ? [{ label: `${stance === 'hide' ? '✓ ' : ''}${i18n.t('raid.stance.hide')}`, className: 'btn-secondary', detail: el('span', 'difficulty-desc', i18n.t('raid.stance.hide.desc')), onClick: choose('hide') }] : []),
      ],
    });
  }

  /** What happened when the raiders reached the door. */
  showRaidResult(r: RaidResult): void {
    const body = el('div', 'modal-result');
    body.appendChild(el('p', 'modal-body', i18n.t(`raid.result.${r.key}`, { captive: r.captive ? this.app.localName(r.captive) : '' })));
    if (r.gains) body.appendChild(this.app.welcome.gainsList(r.gains));
    for (const inj of r.injured) {
      body.appendChild(el('p', 'modal-sub negative-text', `[[bandage]] ${i18n.t('mission.injury', { name: this.app.localName(inj.name), n: inj.damage, ...this.app.gByName(inj.name, (inj as { id?: string }).id) })}`));
    }
    if (r.died) body.appendChild(el('p', 'modal-sub negative-text', `[[skull]] ${i18n.t('raid.result.died', { name: this.app.localName(r.died), ...this.app.gByName(r.died) })}`));
    // [P2] A room wrecked in the rout: it waits as a ruin, and comes back as it was once restored.
    if (r.wrecked) body.appendChild(el('p', 'modal-sub negative-text', `[[pick]] ${i18n.t('raid.result.wrecked', { room: getDef(r.wrecked as BuildingType)?.name[i18n.currentLocale] ?? r.wrecked })}`));
    this.app.audio.play(r.key === 'win' || r.key === 'winCaptive' ? 'achievement' : 'error');
    this.app.modal.show({
      icon: '[[armory]]',
      title: i18n.t('raid.title'),
      body,
      actions: [{ label: i18n.t('event.ok'), onClick: () => this.app.modal.hide() }],
    });
  }

  /** Meaningful death: the portrait, the name, one line about who they were, and the choice of how to say goodbye. */
  showMemorial(): void {
    const f = this.app.state.danger.memorialQueue[0];
    if (!f) return;
    const name = this.app.localName(f.name);
    const lineKey = f.job && i18n.has(`memorial.line.${f.job}`) ? `memorial.line.${f.job}` : 'memorial.line.generic';
    const memorialGender = this.app.gOf(f);
    const why = causeText(this.app.state, f.cause, memorialGender);
    const body = el('div', 'modal-result memorial');
    const row = el('div', 'modal-portraits');
    const img = el('img', 'modal-portrait');
    img.src = portraitUrl(portraitFor(f));
    img.alt = '';
    row.appendChild(img);
    body.append(
      row,
      el('p', 'modal-sub', i18n.t('memorial.sub', { level: f.level })),
      ...(why ? [el('p', 'modal-sub negative-text', `[[skull]] ${why.charAt(0).toUpperCase()}${why.slice(1)}`)] : []), // [ux-wp3 W1] how they died
      el('p', 'modal-body', `"${i18n.t(lineKey, memorialGender)}"`),
      el('p', 'bp-hint', `[[heart]] ${i18n.t('memorial.ceremonyHint')}`),
      el('p', 'bp-hint', `[[hourglass]] ${i18n.t('memorial.carryOnHint')}`),
    );
    this.app.audio.play('error');
    const answer = (choice: 'ceremony' | 'carryOn') => {
      if (!this.app.engine.deathSystem.answerMemorial(choice, this.app.engine.resourceSystem)) {
        this.app.toasts.show(missingOr(this.app.state, CEREMONY_COST), 'bad'); // [ux-wp3 A1]
        return;
      }
      this.app.engine.requestSave();
      this.app.modal.hide();
    };
    this.app.modal.show({
      icon: '[[skull]]',
      title: i18n.t('memorial.title', { name }),
      body,
      actions: [
        {
          label: i18n.t('memorial.ceremony'), disabled: !this.app.engine.resourceSystem.canAfford(this.app.state, CEREMONY_COST),
          detail: costRow(this.app.state, CEREMONY_COST), onClick: () => answer('ceremony'),
        },
        { label: i18n.t('memorial.carryOn'), className: 'btn-secondary', onClick: () => answer('carryOn') },
      ],
    });
  }

  /** [plan4:AC-11] Which danger was last said to a screen reader (the banner text changes every second; the kind only when something new comes). */
  private announcedDanger = '';

  updateIncidentBanner(): void {
    // [Danger] a raid warning or disaster countdown takes the banner (and its alarm) over a room crisis.
    const danger = this.dangerBanner();
    if (!danger) this.announcedDanger = '';
    else if (this.announcedDanger !== danger.kind) {
      this.announcedDanger = danger.kind;
      announce(danger.text.replace(/\[\[[a-z0-9]+\]\]\s*/gi, ''), 'assertive');
    }
    if (danger) {
      this.app.hud.setIncident(danger.text, danger.kind);
      this.tension(danger.kind, danger.left);
      return;
    }
    this.curveKey = '';
    const list = this.app.state.incidents ?? [];
    if (!list.length) {
      this.app.hud.setIncident(null);
      return;
    }
    const inc = list[0];
    const def = INCIDENTS[inc.kind];
    const more = list.length > 1 ? ` +${list.length - 1}` : '';
    this.app.hud.setIncident(`[[${def.icon}]] ${def.name[i18n.currentLocale]} · ${this.app.roomName(inc.buildingId)}${more} · ${i18n.t('incident.tapAlarm')}`, inc.kind);
    // [ux-wp3 F3] The alarm sounded when it started (feedback); while it burns, only a quiet one now and then (it does not duck the music).
    const now = performance.now();
    if (now - this.lastIncidentAlarm > REMINDER_MS) {
      if (this.lastIncidentAlarm) this.app.audio.play('alarm', { volume: REMINDER_VOLUME });
      this.lastIncidentAlarm = now;
    }
  }

  /**
   * [ux-wp3 F3] A raid or a disaster on the clock builds tension instead of repeating the alarm every 25 s: the alarm once when it
   * is announced (feedback), then a quiet one every minute and a half, a little louder every 20 s in the last minute, and a tick
   * every second in the last ten (with a tap of the buzzer at 3, 2, 1).
   */
  private tension(kind: string, left: number): void {
    const now = performance.now();
    if (this.curveKey !== kind) {
      this.curveKey = kind;
      this.lastIncidentAlarm = now; // the announcement already sounded
      this.lastWarnAt = 0;
      this.lastTickS = -1;
    }
    if (left <= COUNTDOWN_S && left > 0) {
      const s = Math.ceil(left);
      if (s !== this.lastTickS) {
        this.lastTickS = s;
        this.app.audio.play('tick', { volume: 0.8 });
        if (s <= 3) haptic('tap');
      }
      return;
    }
    if (left <= 60) {
      if (now - this.lastWarnAt > 20_000) {
        this.lastWarnAt = now;
        this.app.audio.play('alarm', { volume: 0.45 });
      }
      return;
    }
    if (now - this.lastIncidentAlarm > REMINDER_MS) {
      this.lastIncidentAlarm = now;
      this.app.audio.play('alarm', { volume: REMINDER_VOLUME });
    }
  }

  /** The player's helping hand against a crisis. */
  tapIncident(id: string): void {
    const inc = this.app.state.incidents?.find(i => i.id === id);
    if (!inc) return;
    this.app.engine.notifyInteraction();
    const sound: Record<string, 'splash' | 'click' | 'place'> = { fire: 'splash', flood: 'splash', blackout: 'click', roaches: 'place', breach: 'place' };
    this.app.audio.play(sound[inc.kind]);
    haptic('tap');
    this.app.renderer.incidents.hit(id);
    this.app.engine.incidentSystem.tap(id);
    if (this.app.buildingPanel.isVisible) this.app.buildingPanel.refresh(this.app.state);
  }

  quickFixIncident(id: string): void {
    if (!this.app.engine.incidentSystem.quickFix(id)) {
      this.app.audio.play('error');
      const inc = this.app.state.incidents?.find(i => i.id === id);
      this.app.toasts.show(inc ? missingOr(this.app.state, quickFixCost(this.app.state, inc.kind)) : i18n.t('toast.notEnough'), 'bad'); // [ux-wp3 A1]
      return;
    }
    this.app.renderer.incidents.hit(id);
    this.app.buildingPanel.refresh(this.app.state);
  }
}
