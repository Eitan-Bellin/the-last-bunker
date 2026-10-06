import type { StateManager } from '../core/StateManager';
import type { ChronicleEntry } from '../core/state/longGame';
import { bus } from '../core/EventBus';
import { RESEARCH } from '../data/research';

/** Longest chronicle kept (the oldest entries go first). */
const MAX_ENTRIES = 400;

/**
 * [Q14] The Chronicle: the run's milestones in order (Acts, eras, projects, chapters, doctrines, laws, depth, deaths, the ending),
 * kept in the save so a player can look back, and so later runs can show what the earlier ones were. It only listens: nothing in the
 * game reads it back except its own panel.
 */
export class ChronicleSystem {
  private sm: StateManager;

  constructor(sm: StateManager) {
    this.sm = sm;
    bus.on('act:advance', (n: unknown) => this.note('act', undefined, n as number));
    bus.on('era:advance', (n: unknown) => this.note('era', undefined, n as number));
    bus.on('project:done', (id: unknown) => this.note('project', id as string));
    bus.on('story:done', (id: unknown) => this.note('chapter', id as string));
    bus.on('ending', (id: unknown) => this.note('ending', id as string));
    bus.on('floor:dug', (n: unknown) => this.note('floor', undefined, n as number));
    bus.on('outpost:start', () => this.note('outpost', undefined, (this.sm.state.longGame?.world.outposts.length ?? 0)));
    bus.on('research:complete', (id: unknown) => {
      // Only the choices that shape a run: doctrines (forks), not every node.
      if (RESEARCH.some(r => r.id === id && r.fork)) this.note('doctrine', id as string);
    });
    bus.on('raid:resolved', (r: unknown) => {
      if ((r as { key?: string }).key === 'loseBig') this.note('raidLost');
    });
    bus.on('survivor:died', (s: unknown) => this.note('death', (s as { name?: string }).name ?? ''));
    bus.on('rebirth', (gain: unknown) => this.note('genesis', undefined, gain as number));
  }

  /** Adds an entry stamped with the world clock (days from it) and the run it belongs to. */
  note(k: string, id?: string, n?: number): void {
    const lg = this.sm.state.longGame;
    if (!lg) return;
    const entry: ChronicleEntry = { t: Math.round(lg.meta.worldT), k, run: lg.meta.runIndex };
    if (id !== undefined) entry.id = id;
    if (n !== undefined) entry.n = n;
    const list = [...(lg.chronicle ?? []), entry];
    this.sm.applyDelta({ path: 'longGame.chronicle', value: list.length > MAX_ENTRIES ? list.slice(list.length - MAX_ENTRIES) : list });
  }
}
