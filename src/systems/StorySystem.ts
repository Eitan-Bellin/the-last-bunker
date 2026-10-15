import type { ResourceType, SurvivorState } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { SeededRandom } from '../core/Random';
import type { ResourceSystem } from './ResourceSystem';
import type { PopulationSystem } from './PopulationSystem';
import { bus } from '../core/EventBus';
import { CHAPTERS, INTERLUDES, bindStoryState, getChapter, shownChoices, shownLines, type StoryEffect, type StoryLine } from '../data/story';
import { grantLore } from '../data/lore';
import { DIG_LORE } from '../data/ruins';
import { hexDistance } from '../data/surface';
import type { MissionReport } from '../core/GameState';

const CHAPTER_GAP = 240;
/** [ux-wp5 C3] The first team to come home from this far out finds the Genesis expedition's map. */
const MAP_FRAGMENT_RING = 5;
/** [Q1] From the late chapters on, at least an hour of play separates two chapters, so a run never ends in a flood of dialogs. */
const LATE_CHAPTER = 9;
const LATE_CHAPTER_GAP = 3600;
/** Story characters never walk out in a "someone leaves" outcome; they have their own arcs. */
const STORY_PEOPLE = new Set(['Maya', 'Gideon']);

export interface ChapterOutcome {
  lines: StoryLine[];
  gains: Partial<Record<ResourceType, number>>;
  joined: SurvivorState | null;
  /** Unnamed newcomers who came in with a group. */
  newcomers?: number;
  /** Names of the people who left. */
  left?: string[];
  /** How many people got hurt. */
  hurt?: number;
}

/**
 * Runs the storyline: notices when a chapter's moment has come, then applies the player's choice.
 * The app shows one chapter at a time; a chapter counts as told only once its dialog is finished.
 */
export class StorySystem {
  private offered: string | null = null;
  /** Chapters breathe: some play time between them, and never in the middle of a crisis. */
  private nextAllowed = -1;

  private sm: StateManager;
  private rng: SeededRandom;
  private resources: ResourceSystem;
  private population: PopulationSystem;

  constructor(sm: StateManager, rng: SeededRandom, resources: ResourceSystem, population: PopulationSystem) {
    this.sm = sm;
    this.rng = rng;
    this.resources = resources;
    this.population = population;
    // Late chapters pick their lines and choices from earlier decisions (see `when` in story.ts).
    bindStoryState(() => this.sm.state);
    // [ux-wp5 C3] Finds on the map: the Genesis expedition's map on the far road, Noa's letter in the vault.
    bus.on('mission:complete', (r: unknown) => this.mapFinds(r as MissionReport));
    bus.on('state:loaded', () => { this.caughtUp = false; });
  }

  /** [ux-wp5 C3] An older save catches up, quietly, on finds it has already earned (once per load). */
  private caughtUp = false;

  private catchUpLore(): void {
    this.caughtUp = true;
    const s = this.sm.state;
    if (!Array.isArray(s.lore)) return;
    const flags = s.storyFlags;
    if (flags.includes('story:maya')) grantLore(this.sm, 'goodbye', true);
    if (flags.includes('vaultFound')) grantLore(this.sm, 'genesisLetter', true);
    if ((s.explorationMap ?? []).some(h => h.explored && hexDistance(h.x, h.y) >= MAP_FRAGMENT_RING)) grantLore(this.sm, 'mapFragment', true);
    for (const [floor, id] of Object.entries(DIG_LORE)) if (s.currentFloors > Number(floor)) grantLore(this.sm, id, true);
  }

  private mapFinds(r: MissionReport | undefined): void {
    if (!r?.success) return;
    if (r.poi === 'genesisVault') grantLore(this.sm, 'genesisLetter');
    if (hexDistance(r.hexX, r.hexY) >= MAP_FRAGMENT_RING) grantLore(this.sm, 'mapFragment');
  }

  /** The next chapter whose moment has come (checked about once a second). */
  update(): void {
    if (this.offered) return;
    const state = this.sm.state;
    if (!state.storyFlags.includes('intro:done')) return;
    if (!this.caughtUp) this.catchUpLore();
    const now = state.stats.totalPlayTime;
    if (this.nextAllowed < 0) this.nextAllowed = now + 45;
    if (now < this.nextAllowed || now < (state.lateGame?.storyUntil ?? 0) || (state.incidents?.length ?? 0) > 0 || state.activeEvent) return;
    // [ux-wp5 C10] The numbered chapters first; when none is due and the story has been quiet for days, a short interlude.
    const due = (c: (typeof CHAPTERS)[number]) => !state.storyFlags.includes(`story:${c.id}`) && c.trigger(state);
    const ch = CHAPTERS.find(due) ?? INTERLUDES.find(due);
    if (!ch) return;
    this.offered = ch.id;
    bus.emit('story:chapter', ch.id);
  }

  /** The dialog was closed before the end (app reload etc.); offer again later. */
  release(): void {
    this.offered = null;
  }

  done(): string[] {
    return CHAPTERS.filter(c => this.sm.state.storyFlags.includes(`story:${c.id}`)).map(c => c.id);
  }

  /** Whether a choice is on offer and can be afforded. */
  canChoose(chapterId: string, key: string): boolean {
    const ch = getChapter(chapterId);
    const choice = ch ? shownChoices(ch).find(c => c.key === key) : undefined;
    if (!choice) return false;
    return !choice.effect.cost || this.resources.canAfford(this.sm.state, choice.effect.cost as Record<string, number>);
  }

  /** Finishes a chapter with the given choice (or none); returns the reply lines and what changed. */
  finish(chapterId: string, key: string | null): ChapterOutcome {
    const ch = getChapter(chapterId);
    const out: ChapterOutcome = { lines: [], gains: {}, joined: null };
    if (!ch) return out;
    const flags = [`story:${ch.id}`];
    const choice = key ? ch.choices?.find(c => c.key === key) : undefined;
    let effect: StoryEffect | undefined = ch.effect;
    if (choice) {
      flags.push(`choice:${ch.id}:${choice.key}`);
      const success = !choice.check || this.rng.next() < choice.check(this.sm.state);
      effect = success ? choice.effect : choice.failEffect ?? choice.effect;
      // Picked against the state before the effect, the same state the opening lines were chosen from.
      out.lines = shownLines(success ? choice.reply : choice.failReply ?? choice.reply);
      if (!success) flags.push(`choice:${ch.id}:${choice.key}:failed`);
    }
    if (effect) this.apply(effect, out);
    this.sm.applyDelta({ path: 'storyFlags', value: [...new Set([...this.sm.state.storyFlags, ...flags, ...(effect?.flags ?? [])])] });
    this.sm.applyDelta({ path: 'prestige.storySeen', value: [...new Set([...(this.sm.state.prestige.storySeen ?? []), ch.id])] });
    this.offered = null;
    const gap = ch.number >= LATE_CHAPTER || ch.interlude ? LATE_CHAPTER_GAP : CHAPTER_GAP;
    this.nextAllowed = this.sm.state.stats.totalPlayTime + gap;
    // The late gap is long enough to outlive a session: it is kept in the save.
    if (gap > CHAPTER_GAP) this.sm.applyDelta({ path: 'lateGame.storyUntil', value: this.nextAllowed });
    bus.emit('story:done', ch.id);
    return out;
  }

  private apply(effect: StoryEffect, out: ChapterOutcome): void {
    if (effect.cost) {
      const spend: Record<string, number> = {};
      for (const [r, v] of Object.entries(effect.cost) as [ResourceType, number][]) spend[r] = Math.min(v, this.sm.state.resources[r].amount);
      this.resources.spend(this.sm, spend);
      for (const [r, v] of Object.entries(spend)) out.gains[r as ResourceType] = -v;
    }
    if (effect.gain) {
      this.resources.gain(this.sm, effect.gain);
      for (const [r, v] of Object.entries(effect.gain) as [ResourceType, number][]) out.gains[r] = (out.gains[r] ?? 0) + v;
    }
    if (effect.morale) {
      const now = this.sm.state.stats.totalPlayTime;
      this.sm.applyDelta({ path: 'moraleBuffs', value: [...this.sm.state.moraleBuffs, { value: effect.morale, expiresAt: now + (effect.moraleFor ?? 600) }] });
    }
    if (effect.joins && this.sm.state.survivors.length < this.sm.state.maxPopulation) {
      const j = effect.joins;
      const base = this.population.createSurvivor(this.rng);
      const s: SurvivorState = {
        ...base, name: j.name, portrait: j.portrait, traits: j.traits, happiness: 80,
        stats: { ...base.stats, ...j.stats },
      };
      this.population.addSurvivor(this.sm, s);
      out.joined = s;
    }
    if (effect.group) {
      // A group arrives together whatever the bed count: the "overcrowded" morale factor is the price
      // until new quarters are built (the plan's hard choice: people versus supplies).
      for (let i = 0; i < effect.group; i++) this.population.addSurvivor(this.sm, this.population.createSurvivor(this.rng));
      out.newcomers = effect.group;
    }
    if (effect.lore) grantLore(this.sm, effect.lore);
    if (effect.leaves) out.left = this.leave(effect.leaves);
    if (effect.hurt) out.hurt = this.injure(effect.hurt.count, effect.hurt.damage);
  }

  /** Adults at home who can walk away: singles without children first, never story characters. */
  private leave(count: number): string[] {
    const state = this.sm.state;
    const parents = new Set(state.survivors.flatMap(s => s.parentIds ?? []));
    const pool = state.survivors.filter(s => !s.child && !s.isOnMission && !STORY_PEOPLE.has(s.name));
    const singles = pool.filter(s => !s.partnerId && !parents.has(s.id));
    const order = [...this.shuffle(singles), ...this.shuffle(pool.filter(s => !singles.includes(s)))];
    // Never empty the bunker.
    const gone = order.slice(0, Math.max(0, Math.min(count, state.survivors.length - 1)));
    if (!gone.length) return [];
    const ids = new Set(gone.map(s => s.id));
    this.sm.applyDelta({
      path: 'survivors',
      value: state.survivors.filter(s => !ids.has(s.id)).map(s => (s.partnerId && ids.has(s.partnerId) ? { ...s, partnerId: null } : s)),
    });
    this.sm.applyDelta({
      path: 'buildings',
      value: this.sm.state.buildings.map(b => (b.assignedSurvivorIds.some(id => ids.has(id))
        ? { ...b, assignedSurvivorIds: b.assignedSurvivorIds.filter(id => !ids.has(id)) } : b)),
    });
    return gone.map(s => s.name);
  }

  /** Hurts up to `count` adults at home; health never drops below 15 here, the medbay does the rest. */
  private injure(count: number, damage: number): number {
    const state = this.sm.state;
    const pool = this.shuffle(state.survivors.filter(s => !s.child && !s.isOnMission));
    const ids = new Set(pool.slice(0, count).map(s => s.id));
    if (!ids.size) return 0;
    this.sm.applyDelta({
      path: 'survivors',
      value: state.survivors.map(s => (ids.has(s.id) ? { ...s, health: s.health <= 15 ? s.health : Math.max(15, s.health - damage) } : s)),
    });
    return ids.size;
  }

  private shuffle<T>(list: T[]): T[] {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
