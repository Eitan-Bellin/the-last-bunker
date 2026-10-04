import { ACTS } from '../../data/acts';
import { vibrate } from '../../utils/haptics';
import { getProject } from '../../data/projects';
import { getPartner } from '../../data/trade';
import { WEEKLY_CREDITS } from '../../data/challenges';
import { i18n } from '../../i18n/I18nManager';
import { bus } from '../../core/EventBus';
import { getDef } from '../../data/buildingDefs';
import { getResearch } from '../../data/research';
import { ACHIEVEMENTS } from '../../data/achievements';
import { RESOURCE_ICONS } from '../../ui/dom';
import type { Objective } from '../../systems/ObjectiveSystem';
import type { ResourceType, SurvivorState, SurvivorStats } from '../../core/GameState';
import { isDistrict } from '../../data/buildingDefs';
import { showActBanner, showEraBanner } from '../../ui/components/EraPanel';
import { ERAS } from '../../data/eras';
import { RUIN_KINDS } from '../../data/ruins';
import type { RuinClearedInfo } from '../../systems/RestorationSystem';
import { INCIDENTS, DISASTERS } from '../../data/incidents';
import { specOf } from '../../data/specializations';
import type { IncidentResolved } from '../../systems/IncidentSystem';
import type { ChildBorn, CoupleFormed } from '../../systems/FamilySystem';
import type { Incident } from '../../core/GameState';
import { type RaidResult } from '../../systems/EventSystem';
import type { GameApp } from '../../app';

/** What the player sees and hears when something happens in the bunker: toasts, sounds, little bursts over the rooms. */
export class FeedbackController {
  private app: GameApp;

  constructor(app: GameApp) {
    this.app = app;
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
      if (b.type === 'generator' || b.type === 'reactor' || b.type === 'reactorHall') this.app.audio.play('engineStart');
      else {
        this.app.audio.play('complete');
        setTimeout(() => this.app.audio.play('hiss', { volume: 0.6 }), 260);
      }
      const c = this.app.renderer.roomCenter(b);
      this.app.popups.spawn(c.x, c.y, '[[check]]', 0x44ff88);
    });

    bus.on('survivor:levelup', (s: unknown, stat: unknown) => {
      const survivor = s as SurvivorState;
      this.app.audio.play('levelup');
      const p = this.app.renderer.personPos(survivor.id);
      if (p) this.app.renderer.floatIcons(p.x, p.y, 'star', 5, '#ffe27a');
      this.app.toasts.show(`[[star]] ${i18n.t('toast.levelUp', {
        name: this.app.localName(survivor.name),
        level: survivor.level,
        stat: i18n.t(`stats.${stat as keyof SurvivorStats}`),
        ...this.app.gOf(survivor),
      })}`, 'good');
    });

    bus.on('survivor:died', (s: unknown) => {
      this.app.audio.play('error');
      this.app.toasts.show(`[[skull]] ${i18n.t('toast.died', { name: this.app.localName((s as SurvivorState).name), ...this.app.gOf(s as SurvivorState) })}`, 'bad');
    });

    bus.on('research:complete', (id: unknown) => {
      const def = getResearch(id as string);
      if (!def) return;
      this.app.audio.play(def.effects.some(e => e.type === 'unlock' || e.type === 'feature') ? 'unlock' : 'research');
      this.app.toasts.show(`[[research]] ${i18n.t('toast.researchDone', { name: def.name[i18n.currentLocale] ?? def.name.en })}`, 'good');
      this.app.engine.requestSave();
    });

    bus.on('achievement', (id: unknown) => {
      const a = ACHIEVEMENTS.find(x => x.id === id);
      if (!a) return;
      this.app.audio.play('achievement');
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
      vibrate([40, 60, 40]);
      this.app.toasts.show(`[[${def.icon}]] ${i18n.t('incident.started', { name: def.name[i18n.currentLocale], room: this.app.roomName(inc.buildingId) })}`, 'bad');
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
        this.app.popups.spawn(rect.x + rect.w / 2, rect.y + 30, `[[check]] ${def.name[i18n.currentLocale]}`, 0x7affb0);
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
    });
    bus.on('raid:resolved', (r: unknown) => { this.app.raidResult = r as RaidResult; });
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
    });

    // [LateGame B1-B4] big projects, caravans, mastery, weekly challenge
    bus.on('project:stage', (id: unknown, stage: unknown) => {
      const def = getProject(id as string);
      this.app.audio.play('complete');
      this.app.toasts.show(`[[build]] ${i18n.t('proj.stageDone', { name: def?.name[i18n.currentLocale] ?? '', n: stage as number, all: def?.stages.length ?? 0 })}`, 'good');
      this.app.engine.requestSave();
    });
    bus.on('project:done', (id: unknown) => {
      const def = getProject(id as string);
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
      lootText.forEach((t, i) => setTimeout(() => this.app.popups.spawn(c.x + (i - (lootText.length - 1) / 2) * 30, c.y, t, 0xffd27a), i * 160));
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
      const show = () => {
        if (this.app.storyOpen || this.app.modal.isVisible || document.querySelector('.era-banner')) { setTimeout(show, 1500); return; }
        this.app.audio.play('era');
        this.app.renderer.shake(4, 1);
        this.app.storyOpen = true;
        this.app.closeSheets();
        showActBanner(act, () => { this.app.storyOpen = false; });
      };
      setTimeout(show, 600);
    });
    bus.on('dig:start', () => {
      this.app.toasts.show(`[[pick]] ${i18n.t('dig.started', { n: this.app.state.currentFloors + 1, t: i18n.formatDuration(this.app.state.longGame?.dig.total ?? 0) })}`, 'info');
    });
  }
}
