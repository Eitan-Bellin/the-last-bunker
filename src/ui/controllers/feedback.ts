import { ENDINGS } from '../../data/endings';
import { SEASONS, nextSeason, seasonAt } from '../../data/seasons';
import { ACTS } from '../../data/acts';
import { haptic } from '../../utils/haptics';
import { reducedMotion } from '../../utils/a11y'; // [plan4:GP-2]
import { statusTint } from '../../utils/a11y';
import { announce } from '../a11yDom';
import { getProject } from '../../data/projects';
import { getPartner } from '../../data/trade';
import { WEEKLY_CREDITS } from '../../data/challenges';
import { i18n } from '../../i18n/I18nManager';
import { bus } from '../../core/EventBus';
import { getDef, isPowerPlant } from '../../data/buildingDefs';
import { getResearch } from '../../data/research';
import { ACHIEVEMENTS } from '../../data/achievements';
import { RESOURCE_ICONS } from '../../ui/dom';
import type { Objective } from '../../systems/ObjectiveSystem';
import type { ResourceType, SurvivorState, SurvivorStats } from '../../core/GameState';
import { isDistrict } from '../../data/buildingDefs';
import { showActBanner, showEndingBanner, showEraBanner } from '../../ui/components/EraPanel';
import { ERAS } from '../../data/eras';
import { RUIN_KINDS } from '../../data/ruins';
import type { RuinClearedInfo } from '../../systems/RestorationSystem';
import { INCIDENTS, DISASTERS } from '../../data/incidents';
import { specOf } from '../../data/specializations';
import type { IncidentResolved } from '../../systems/IncidentSystem';
import type { ChildBorn, CoupleFormed } from '../../systems/FamilySystem';
import type { Incident } from '../../core/GameState';
import { type RaidResult } from '../../systems/EventSystem';
import { deathCause } from '../../systems/DeathSystem'; // [ux-wp3 W1]
import type { GameApp } from '../../app';

/** [ux-wp3 W1] The cause of a death in words (null when unknown: the old sentence is used). Also used by the memorial. */
export function causeText(state: import('../../core/GameState').GameState, cause: string | undefined, g: Record<string, string | number>): string | null {
  const c = deathCause(state, cause);
  if (c.kind === 'other') return null;
  const what = c.disaster ? DISASTERS[c.disaster as keyof typeof DISASTERS]?.name[i18n.currentLocale] ?? c.disaster : '';
  return i18n.t(`wp3.cause.${c.kind}`, { what, ...g });
}

/** [ux-wp3 D1] Survivor level-up toasts fold into one line per this window. */
const LEVEL_TOAST_GAP_MS = 60_000;

/** What the player sees and hears when something happens in the bunker: toasts, sounds, little bursts over the rooms. */
export class FeedbackController {
  private app: GameApp;

  constructor(app: GameApp) {
    this.app = app;
  }

  /** [ux-wp3 D1/F5] Level-up toasts: at most one a minute; the ones in between become one line ("3 people levelled up"). */
  private levelShownAt = -Infinity;
  private levelWaiting: string[] = [];
  private levelTimer = 0;

  private levelToast(text: string): void {
    if (this.app.engine.awayRunning) return; // [ux-wp3 D2] the hours away are told by the welcome report, not by a pile of level-ups
    const now = performance.now();
    if (!this.levelTimer && now - this.levelShownAt >= LEVEL_TOAST_GAP_MS) {
      this.levelShownAt = now;
      this.app.toasts.show(text, 'good');
      return;
    }
    this.levelWaiting.push(text);
    if (this.levelTimer) return;
    this.levelTimer = window.setTimeout(() => {
      this.levelTimer = 0;
      const list = this.levelWaiting;
      this.levelWaiting = [];
      if (!list.length) return;
      this.levelShownAt = performance.now();
      this.app.toasts.show(list.length === 1 ? list[0] : `[[star]] ${i18n.t('wp3.levelUps', { n: list.length })}`, 'good');
    }, Math.max(1000, LEVEL_TOAST_GAP_MS - (now - this.levelShownAt)));
  }

  install(): void {
    bus.on('building:complete', (id: unknown) => {
      const b = this.app.state.buildings.find(x => x.id === id);
      if (!b) return;
      if (isDistrict(b.type)) {
        const c = this.app.renderer.roomCenter(b);
        this.app.renderer.burstAt(c.x, c.y + 30, 200);
        // Told as soon as nothing else is on screen: it used to take over (and wipe out) the welcome-back dialog.
        this.app.districtFoundQueue.push(b.type);
      }
      const name = getDef(b.type)?.name[i18n.currentLocale] ?? b.type;
      this.app.toasts.show(`[[check]] ${i18n.t('toast.buildingComplete', { name })}`, 'good');
      announce(i18n.t('announce.built', { name }), 'polite'); // plan4:qa the key existed but nothing said it
      // [plan4:GP-2] The sound and the buzz belong to the moment (the same event fires when an upgrade finishes: that is the level-up ceremony).
      const upgraded = b.level > 1;
      void this.app.ceremony.fire({
        kind: upgraded ? 'roomLevel' : 'build', roomId: b.id, title: name,
        sub: upgraded ? i18n.t('cer.roomLevel.sub', { n: b.level }) : i18n.t('cer.build.sub'),
        sound: !upgraded && isPowerPlant(b.type) ? 'engineStart' : undefined, // [plan4:BL-8]
      });
      const c = this.app.renderer.roomCenter(b);
      this.app.popups.spawn(c.x, c.y, '[[check]]', statusTint('ok'));
    });

    bus.on('surface:open', () => { this.app.toasts.show(`[[sun]] ${i18n.t('toast.surfaceOpen')}`, 'good'); haptic('success'); }); // [plan4:ST-16] the gate-house yard is cleared

    bus.on('survivor:levelup', (s: unknown, stat: unknown) => {
      const survivor = s as SurvivorState;
      // [plan4:GP-2] A little star over their head and a bell (the ceremony queue folds several at once into one).
      void this.app.ceremony.fire({ kind: 'person', personId: survivor.id, title: this.app.localName(survivor.name), sub: i18n.t('cer.person.sub', { level: survivor.level }) });
      this.levelToast(`[[star]] ${i18n.t('toast.levelUp', {
        name: this.app.localName(survivor.name),
        level: survivor.level,
        stat: i18n.t(`stats.${stat as keyof SurvivorStats}`),
        ...this.app.gOf(survivor),
      })}`);
    });

    bus.on('survivor:died', (s: unknown, cause: unknown) => {
      // [plan4:GP-2] A slow dimming, a candle and a line of remembrance; the memorial dialog waits behind it (dialog gate).
      void this.app.ceremony.fire({ kind: 'death', personId: (s as SurvivorState).id, icon: '[[heart]]', title: i18n.t('cer.death', { name: this.app.localName((s as SurvivorState).name) }) });
      // [ux-wp3 W1] How they died, said with it ("fell defending the bunker from raiders", "died of thirst").
      const sv = s as SurvivorState;
      const why = causeText(this.app.state, cause as string | undefined, this.app.gOf(sv));
      this.app.toasts.show(`[[skull]] ${why ? i18n.t('wp3.died', { name: this.app.localName(sv.name), cause: why }) : i18n.t('toast.died', { name: this.app.localName(sv.name), ...this.app.gOf(sv) })}`, 'bad');
    });

    bus.on('research:complete', (id: unknown) => {
      const def = getResearch(id as string);
      if (!def) return;
      // [plan4:GP-2] The laboratory warms up and a card says what the research opens.
      const loc = i18n.currentLocale;
      const opens = def.effects.flatMap(e => (e.type === 'unlock' ? [getDef(e.building)?.name[loc] ?? ''] : [])).filter(Boolean);
      void this.app.ceremony.fire({
        kind: 'research', icon: '[[research]]', title: def.name[loc] ?? def.name.en,
        sub: [i18n.t('cer.research.sub'), opens.length ? i18n.t('cer.research.opens', { list: opens.join(', ') }) : ''].filter(Boolean).join(' · '),
        sound: def.effects.some(e => e.type === 'unlock' || e.type === 'feature') ? 'unlock' : 'research',
      });
      this.app.toasts.show(`[[research]] ${i18n.t('toast.researchDone', { name: def.name[i18n.currentLocale] ?? def.name.en })}`, 'good');
      this.app.engine.requestSave();
    });

    bus.on('achievement', (id: unknown) => {
      const a = ACHIEVEMENTS.find(x => x.id === id);
      if (!a) return;
      // [ux-wp3 F15] A badge card with the count; the ceremony brings the sound and the buzz (a hidden page gets the toast only).
      const got = this.app.state.achievements?.length ?? 0;
      void this.app.ceremony.fire({ kind: 'achievement', icon: '[[trophy]]', title: a.name[i18n.currentLocale] ?? a.name.en, sub: i18n.t('wp3.cer.achievement', { n: got, all: ACHIEVEMENTS.length }) });
      this.app.toasts.show(`[[trophy]] ${i18n.t('toast.achievement', { name: a.name[i18n.currentLocale] ?? a.name.en })}`, 'good');
      this.app.engine.requestSave();
    });

    bus.on('mission:complete', () => {
      this.app.audio.play('mission');
      this.app.engine.requestSave();
    });

    bus.on('event:triggered', () => this.app.audio.play('event'));

    bus.on('incident:start', (i: unknown) => {
      const inc = i as Incident;
      const def = INCIDENTS[inc.kind];
      const sound: Record<string, 'fire' | 'splash' | 'powerDown' | 'skitter' | 'alarm'> = {
        fire: 'fire', flood: 'splash', blackout: 'powerDown', roaches: 'skitter', breach: 'alarm',
      };
      this.app.audio.play(sound[inc.kind]);
      if (inc.kind !== 'breach') setTimeout(() => this.app.audio.play('alarm'), 400);
      this.app.renderer.shake(inc.kind === 'breach' ? 6 : 4, 0.5);
      haptic('warning');
      this.app.toasts.show(`[[${def.icon}]] ${i18n.t('incident.started', { name: def.name[i18n.currentLocale], room: this.app.roomName(inc.buildingId) })}`, 'bad');
      // [plan4:AC-11] Said to a screen reader as an alert, with the floor (when the player turned announcements on).
      const floor = this.app.state.buildings.find(b => b.id === inc.buildingId)?.position.floor ?? 0;
      announce(i18n.t('announce.incident', { name: def.name[i18n.currentLocale], floor: floor + 1 }), 'assertive');
    });
    bus.on('incident:burnout', (i: unknown) => {
      const inc = i as Incident;
      this.app.toasts.show(`[[${INCIDENTS[inc.kind].icon}]] ${i18n.t('incident.burnout', { name: INCIDENTS[inc.kind].name[i18n.currentLocale], room: this.app.roomName(inc.buildingId) })}`, 'bad');
    });
    bus.on('incident:spread', (id: unknown) => {
      this.app.toasts.show(`[[fire]] ${i18n.t('incident.spread', { room: this.app.roomName(id as string) })}`, 'bad');
    });
    bus.on('incident:resolved', (r: unknown) => {
      const { incident, quick } = r as IncidentResolved;
      const def = INCIDENTS[incident.kind];
      this.app.audio.play(incident.kind === 'fire' ? 'extinguish' : incident.kind === 'blackout' ? 'powerUp' : 'fixed');
      if (incident.kind === 'fire') {
        setTimeout(() => this.app.audio.play('steam', { volume: 0.7 }), 300);
        setTimeout(() => this.app.audio.play('fixed'), 700);
      }
      const rect = this.app.renderer.roomRect(incident.buildingId);
      if (rect) {
        this.app.renderer.floatIcons(rect.x + rect.w / 2, rect.y + 40, 'star', 5, '#ffd27a');
        this.app.popups.spawn(rect.x + rect.w / 2, rect.y + 30, `[[check]] ${def.name[i18n.currentLocale]}`, statusTint('ok'));
      }
      this.app.toasts.show(`[[check]] ${i18n.t(quick ? 'incident.fixedQuick' : 'incident.fixed', { name: def.name[i18n.currentLocale] })}`, 'good');
      this.app.engine.requestSave();
    });

    // [Danger] raid warnings, disasters and their outcomes
    bus.on('raid:warning', (r: unknown) => {
      const raid = r as { hitAt: number };
      this.app.audio.play('alarm');
      this.app.dangerPrompt = true;
      this.app.toasts.show(`[[armory]] ${i18n.t('danger.toast.raid', { time: i18n.formatDuration(raid.hitAt - this.app.state.stats.totalPlayTime) })}`, 'bad');
      announce(i18n.t('announce.raid', { time: i18n.formatDuration(raid.hitAt - this.app.state.stats.totalPlayTime) }), 'assertive'); // plan4:qa
    });
    bus.on('raid:resolved', (r: unknown) => {
      const res = r as RaidResult;
      this.app.raidResult = res;
      // [ux-wp3 F2] The raiders at the gate: siren, the camera at the entrance, the impact. The result dialog waits behind it (gate).
      if (res.key !== 'tribute') void this.app.ceremony.fire({ kind: 'raid', win: res.key === 'hidden' ? undefined : res.key === 'win' || res.key === 'winCaptive' });
    });
    bus.on('disaster:start', (d: unknown) => {
      const def = DISASTERS[(d as { kind: keyof typeof DISASTERS }).kind];
      this.app.audio.play('alarm');
      this.app.dangerPrompt = true;
      this.app.toasts.show(`[[${def.icon}]] ${i18n.t('danger.toast.disaster', { name: def.name[i18n.currentLocale], time: i18n.formatDuration(def.countdown) })}`, 'bad');
    });
    bus.on('disaster:handled', (d: unknown) => {
      const def = DISASTERS[(d as { kind: keyof typeof DISASTERS }).kind];
      this.app.toasts.show(`[[check]] ${def.saved[i18n.currentLocale]}`, 'good');
    });
    bus.on('disaster:struck', (r: unknown) => {
      const res = r as { kind: keyof typeof DISASTERS };
      const def = DISASTERS[res.kind];
      this.app.audio.play('error');
      haptic('error');
      this.app.toasts.show(`[[${def.icon}]] ${i18n.t('danger.toast.struck', { name: def.name[i18n.currentLocale], text: def.struck[i18n.currentLocale] })}`, 'bad');
    });
    bus.on('family:couple', (c: unknown) => {
      const { a, b } = c as CoupleFormed;
      this.app.audio.play('heart');
      for (const s of [a, b]) {
        const p = this.app.renderer.personPos(s.id);
        if (p) this.app.renderer.floatIcons(p.x, p.y, 'heart', 6, '#ff7a9a');
      }
      this.app.toasts.show(`[[heart]] ${i18n.t('family.couple', { a: this.app.localName(a.name), b: this.app.localName(b.name) })}`, 'good');
      this.app.engine.requestSave();
    });
    bus.on('family:child', (c: unknown) => {
      const { child, parents } = c as ChildBorn;
      this.app.audio.play('baby');
      const p = this.app.renderer.personPos(parents[0].id);
      if (p) this.app.renderer.floatIcons(p.x, p.y, 'baby', 4, '#ffe2a0');
      this.app.toasts.show(`[[baby]] ${i18n.t('family.born', { a: this.app.localName(parents[0].name), b: this.app.localName(parents[1].name), name: this.app.localName(child.name), ...this.app.gOf(child) })}`, 'good');
      this.app.engine.requestSave();
    });
    bus.on('family:grownUp', (s: unknown) => {
      const sv = s as SurvivorState | undefined;
      if (!sv) return;
      this.app.audio.play('levelup');
      this.app.toasts.show(`[[star]] ${i18n.t('family.grownUp', { name: this.app.localName(sv.name), ...this.app.gOf(sv) })}`, 'good');
    });
    bus.on('story:chapter', (id: unknown) => { this.app.pendingChapter = id as string; });
    bus.on('mission:choice', () => this.app.audio.play('radio'));
    bus.on('building:specialized', (id: unknown) => {
      const b = this.app.state.buildings.find(x => x.id === id);
      const spec = b ? specOf(b) : undefined;
      if (!b || !spec) return;
      this.app.audio.play('achievement');
      const c = this.app.renderer.roomCenter(b);
      this.app.renderer.burstAt(c.x, c.y + 30, 120);
      this.app.renderer.floatIcons(c.x, c.y + 10, 'crown', 5, '#ffd27a');
      this.app.toasts.show(`[[crown]] ${i18n.t('spec.done', { room: this.app.roomName(b.id), spec: spec.name[i18n.currentLocale] })}`, 'good');
      this.app.engine.requestSave();
    });

    bus.on('floor:dug', (floor: unknown) => {
      this.app.toasts.show(`[[pick]] ${i18n.t('dig.done', { n: (floor as number) + 1 })}`, 'good');
      this.app.renderer.focusFloor(floor as number);
      void this.app.ceremony.fire({ kind: 'dig', floor: floor as number, icon: '[[pick]]', title: i18n.t('dig.done', { n: (floor as number) + 1 }) }); // [plan4:GP-2]
    });

    // [LateGame B1-B4] big projects, caravans, mastery, weekly challenge
    bus.on('project:stage', (id: unknown, stage: unknown) => {
      const def = getProject(id as string);
      // [ux-wp3 R4] A stage of a charter project gets its moment at the lot (sound and buzz come with it).
      const all = def?.stages.length ?? 0;
      if ((stage as number) < all) void this.app.ceremony.fire({ kind: 'project', projectId: id as string, icon: '[[build]]', sound: 'complete', title: def?.name[i18n.currentLocale] ?? '', sub: i18n.t('wp3.cer.projectStage', { n: stage as number, all }) });
      this.app.toasts.show(`[[build]] ${i18n.t('proj.stageDone', { name: def?.name[i18n.currentLocale] ?? '', n: stage as number, all: def?.stages.length ?? 0 })}`, 'good');
      this.app.engine.requestSave();
    });
    bus.on('project:done', (id: unknown) => {
      const def = getProject(id as string);
      // [ux-wp3 R4] The whole project: the bigger moment (the last stage's own moment folds into this one).
      void this.app.ceremony.fire({ kind: 'project', projectId: id as string, icon: '[[trophy]]', title: def?.name[i18n.currentLocale] ?? '', sub: i18n.t('wp3.cer.projectDone') });
      this.app.toasts.show(`[[trophy]] ${i18n.t('proj.done', { name: def?.name[i18n.currentLocale] ?? '' })}`, 'good');
    });
    bus.on('caravan:complete', (r: unknown) => {
      const c = r as { partner: string; ok: boolean; levelUp: boolean; recruitName: string | null };
      const name = getPartner(c.partner)?.name[i18n.currentLocale] ?? '';
      this.app.toasts.show(c.ok ? `[[cart]] ${i18n.t('trade.home', { name })}${c.levelUp ? ` · ${i18n.t('trade.levelUp')}` : ''}${c.recruitName ? ` · ${i18n.t('mission.recruit', { name: this.app.localName(c.recruitName), ...this.app.gByName(c.recruitName) })}` : ''}` : `[[skull]] ${i18n.t('trade.ambush', { name })}`, c.ok ? 'good' : 'bad');
      this.app.engine.requestSave();
    });
    bus.on('survivor:rank', (s: unknown, rank: unknown) => {
      this.app.toasts.show(`[[medal]] ${i18n.t('mastery.up', { name: this.app.localName((s as SurvivorState).name), n: rank as number })}`);
    });
    bus.on('weekly:done', () => {
      this.app.audio.play('complete');
      this.app.toasts.show(`[[trophy]] ${i18n.t('weekly.won', { n: WEEKLY_CREDITS })}`, 'good');
      this.app.engine.requestSave();
    });

    bus.on('objective:complete', (o: unknown) => {
      const obj = o as Objective;
      this.app.audio.play('complete');
      this.app.toasts.show(`[[target]] ${i18n.t('toast.objective', { name: obj.text[i18n.currentLocale] ?? obj.text.en })}`, 'good');
      this.app.engine.requestSave();
    });

    bus.on('ruin:cleared', (info: unknown) => {
      const { ruin, loot, buildingId, lore } = info as RuinClearedInfo;
      const c = this.app.renderer.ruinCenter(ruin);
      this.app.audio.play('debris');
      const lootText = (Object.entries(loot) as [ResourceType, number][]).map(([r, v]) => `+${v} ${RESOURCE_ICONS[r] ?? ''}`);
      lootText.forEach((t, i) => setTimeout(() => this.app.popups.spawn(c.x + (i - (lootText.length - 1) / 2) * 30, c.y, t, 0xffd27a, true), i * 160)); // [ux-wp3 F10] loot is never "routine"
      if (buildingId) {
        const b = this.app.state.buildings.find(x => x.id === buildingId);
        const name = b ? getDef(b.type)?.name[i18n.currentLocale] ?? '' : '';
        setTimeout(() => this.app.audio.play('restore'), 300);
        this.app.toasts.show(`[[workshop]] ${i18n.t('ruin.restored', { name })}`, 'good');
      } else {
        this.app.toasts.show(`[[broom]] ${i18n.t('ruin.cleared', { name: RUIN_KINDS[ruin.kind].name[i18n.currentLocale] })}`, 'good');
      }
      this.app.engine.requestSave();
      if (lore) setTimeout(() => this.app.lore.queueLore(lore), 900);
    });

    bus.on('lore:found', (id: unknown) => {
      // Ruins announce their own finds after the dust settles; other finds (digging) announce here.
      if (this.app.state.ruins.some(r => r.lore === id)) return;
      setTimeout(() => this.app.lore.queueLore(id as string), 1200);
    });

    bus.on('era:advance', (era: unknown) => {
      const def = ERAS[era as number];
      if (!def) return;
      this.app.audio.play('era');
      this.app.audio.setEra(def.id);
      this.app.renderer.shake(5, 1.2);
      this.app.storyOpen = true;
      this.app.closeSheets();
      this.app.engine.requestSave();
      showEraBanner(def, () => { this.app.storyOpen = false; });
    });

    // [Long game] A new Act: its title card once nothing else holds the screen, and the beds it opens fill again.
    bus.on('act:advance', (n: unknown) => {
      const act = ACTS[(n as number) - 1];
      if (!act) return;
      this.app.engine.requestSave();
      // [plan4:GP-2] The camera steps back to show the whole bunker, the sting plays, then the title card opens (the ceremony's beat); closing the card
      // takes the camera back to where the player had it. If the ceremony is off (reduced motion keeps the sound, a hidden page skips it) the card opens at once.
      const cam = this.app.renderer.camera;
      const back = { x: cam.camX, y: cam.camY, z: cam.zoom };
      const show = () => {
        if (this.app.storyOpen || this.app.modal.isVisible || document.querySelector('.era-banner')) { setTimeout(show, 1500); return; }
        this.app.storyOpen = true;
        this.app.closeSheets();
        showActBanner(act, () => { this.app.storyOpen = false; if (!reducedMotion()) cam.focusTo(back.x, back.y, back.z); });
      };
      this.app.renderer.shake(4, 1);
      void this.app.ceremony.fire({ kind: 'act', beat: show });
    });
    // [P2] The turn of the seasons.
    bus.on('season:change', (id: unknown) => {
      const s = SEASONS.find(x => x.id === id);
      if (!s) return;
      this.app.audio.play('paper');
      this.app.toasts.show(`[[${s.icon}]] ${i18n.t('season.now', { name: s.name[i18n.currentLocale], desc: s.desc[i18n.currentLocale] })}`, 'info');
    });
    this.app.hud.onSeason = () => {
      const st = this.app.state;
      const now = seasonAt(st);
      const next = nextSeason(st);
      const loc = i18n.currentLocale;
      this.app.toasts.show(`[[${now.def.icon}]] ${i18n.t('season.forecast', { now: now.def.name[loc], desc: now.def.desc[loc], next: next.name[loc], t: i18n.formatDuration(now.left), nextDesc: next.desc[loc] })}`, 'info');
    };
    // [P4] A contract paid.
    bus.on('contract:done', (issuer: unknown) => {
      const p = getPartner(issuer as string);
      this.app.audio.play('coin');
      this.app.toasts.show(`[[cart]] ${i18n.t('contract.done', { issuer: p ? p.name[i18n.currentLocale] : i18n.t('contract.drifters') })}`, 'good');
      this.app.engine.requestSave();
    });
    bus.on('outpost:damaged', () => this.app.toasts.show(`[[flag]] ${i18n.t('outpost.hit')}`, 'bad'));
    // [P5] The ending of the run.
    bus.on('ending', (id: unknown) => {
      const ending = ENDINGS.find(e => e.id === id);
      if (!ending) return;
      this.app.engine.requestSave();
      const show = () => {
        if (this.app.storyOpen || this.app.modal.isVisible || document.querySelector('.era-banner')) { setTimeout(show, 1500); return; }
        this.app.audio.play('era');
        this.app.storyOpen = true;
        this.app.closeSheets();
        showEndingBanner(ending, () => { this.app.storyOpen = false; });
      };
      setTimeout(show, 800);
    });
    // [P5] A new timeline: choose its hardships (if any) for more Legacy.
    // [P3-5] First where the next world begins, then the hardships.
    bus.on('rebirth', () => setTimeout(() => this.app.story.chooseScenario(() => this.app.story.chooseMutators()), 1500));
    bus.on('dig:start', (_floor: unknown, total: unknown) => {
      this.app.toasts.show(`[[pick]] ${i18n.t('dig.started', { n: this.app.state.currentFloors + 1, t: i18n.formatDuration((total as number | undefined) ?? this.app.state.longGame?.dig.total ?? 0) })}`, 'info');
    });
    // [plan4:ST-3] Wings: the dig starts, and a step opens (the camera goes to the floor).
    bus.on('wing:start', (floor: unknown, side: unknown, total: unknown) => {
      this.app.toasts.show(`[[pick]] ${i18n.t('wing.started', { n: (floor as number) + 1, side: i18n.t(`wing.side.${side as string}`), t: i18n.formatDuration(total as number) })}`, 'info');
    });
    bus.on('wing:dug', (floor: unknown, side: unknown) => {
      this.app.toasts.show(`[[pick]] ${i18n.t('wing.done', { n: (floor as number) + 1, side: i18n.t(`wing.side.${side as string}`) })}`, 'good');
      this.app.renderer.focusFloor(floor as number);
      void this.app.ceremony.fire({ kind: 'dig', floor: floor as number, side: side as 'w' | 'e', icon: '[[pick]]', title: i18n.t('wing.done', { n: (floor as number) + 1, side: i18n.t(`wing.side.${side as string}`) }) }); // [plan4:GP-2]
    });
  }
}
