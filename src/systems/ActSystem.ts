import type { StateManager } from '../core/StateManager';
import { bus } from '../core/EventBus';
import { ACTS, MAX_ACT, actComplete, actOf } from '../data/acts';
import { ENDINGS, endingOf } from '../data/endings';
import type { BuildingSystem } from './BuildingSystem';
import { registerInboxKind, type InboxSystem } from './InboxSystem';
import { i18n } from '../i18n/I18nManager';

/** An ending a run may choose must score at least this much, and at least this share of the best one. */
const OPTION_MIN_SCORE = 1.5;
const OPTION_MIN_SHARE = 0.6;
/** World seconds the player has to choose before the best-scoring ending is told. */
const CHOICE_DEADLINE = 12 * 3600;

/**
 * [Long game] Moves the run to the next Act once every goal of the current one is met and its charter projects are built.
 * A new Act raises the ceilings (room level, people, depth); the beds that were held back fill up again.
 * The last Act of the release never "completes" here: finishing it is what opens Genesis (MetaSystem).
 */
export class ActSystem {
  private sm: StateManager;
  private buildings: BuildingSystem;
  private inbox: InboxSystem;

  constructor(sm: StateManager, buildings: BuildingSystem, inbox: InboxSystem) {
    this.sm = sm;
    this.buildings = buildings;
    this.inbox = inbox;
    // [P2-3] When more than one ending fits the run, the player chooses (a card; the best fit is told if nobody answers).
    registerInboxKind('ending', {
      title: 'ending.choose.title',
      body: 'ending.choose.body',
      icon: '[[trophy]]',
      choices: item => ((item.data.options as string[]) ?? []).map(id => ({ key: id, label: `ending.pick.${id}` })),
      params: item => ({
        list: ((item.data.options as string[]) ?? []).map(id => {
          const e = ENDINGS.find(x => x.id === id);
          return e ? `${e.name[i18n.currentLocale]}` : id;
        }).join(', '),
      }),
      apply: (_item, key) => this.tell(key),
    });
  }

  /** The ending is told: its flag is kept (the Legacy reads it) and the banner opens. */
  private tell(id: string): void {
    if (this.sm.state.storyFlags.some(f => f.startsWith('ending:'))) return;
    this.sm.applyDelta({ path: 'storyFlags', value: [...this.sm.state.storyFlags, `ending:${id}`] });
    bus.emit('ending', id);
  }

  /** The endings this run fits, best first (the choice card offers these). */
  endingOptions(): string[] {
    const ranked = ENDINGS.map(e => ({ id: e.id, s: e.score(this.sm.state) })).sort((a, b) => b.s - a.s);
    const floor = Math.max(OPTION_MIN_SCORE, ranked[0].s * OPTION_MIN_SHARE);
    return ranked.filter(r => r.s >= floor).slice(0, 3).map(r => r.id);
  }

  /** Genesis (or anything that needs the ending now) settles a pending choice with the best fit. */
  ensureEnding(): void {
    const state = this.sm.state;
    if (state.storyFlags.some(f => f.startsWith('ending:')) || !this.finalActComplete()) return;
    const card = this.inbox.items().find(i => i.kind === 'ending');
    if (card) this.inbox.resolve(card.id, card.fallback ?? endingOf(state).id);
    else this.tell(endingOf(state).id);
  }

  update(): void {
    const state = this.sm.state;
    const lg = state.longGame;
    if (!lg) return;
    const act = actOf(state);
    // [P5] The last Act done: the run's ending is told once (and kept for the Legacy).
    if (act.id >= MAX_ACT) {
      if (actComplete(state, act) && !state.storyFlags.some(f => f.startsWith('ending:')) && !this.inbox.items().some(i => i.kind === 'ending')) {
        const options = this.endingOptions();
        if (options.length <= 1) this.tell(options[0] ?? endingOf(state).id);
        else this.inbox.post('ending', { data: { options }, fallback: options[0], deadlineIn: CHOICE_DEADLINE });
      }
      return;
    }
    if (!actComplete(state, act)) return;
    const next = ACTS[act.id];
    this.sm.applyDeltas([
      { path: 'longGame.meta.act', value: next.id },
      { path: 'longGame.meta.actSince', value: lg.meta.worldT },
    ]);
    this.buildings.recalculateMaxPopulation(this.sm);
    bus.emit('act:advance', next.id);
  }

  /** Release 1: Genesis needs the last Act's goals and charter done. */
  finalActComplete(): boolean {
    const state = this.sm.state;
    const act = actOf(state);
    return act.id >= MAX_ACT && actComplete(state, act);
  }
}
