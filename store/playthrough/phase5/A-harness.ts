// [phase5] Agent A's stage-save harness: loads a stage save, then plays sessions (online minutes with a story/inbox bot, hours away) and
// reports when the Act's mid-Act beat and signature come, the siege numbers, and the Act advance. Run by A-harness.mjs.
import { GameEngine } from '../../../src/core/GameEngine';
import { migrateState, type GameState } from '../../../src/core/GameState';
import { bus } from '../../../src/core/EventBus';
import { ACTS, actOf, actProgress, signatureEta } from '../../../src/data/acts';
import { getChapter } from '../../../src/data/story';
import { siegeForecast } from '../../../src/systems/ActSystem';
import { installDeterminism } from '../../../tools/sim/core';

export interface HarnessOpts { days: number; online: number; away: number; force?: number }

export function runFromSave(name: string, json: string, o: HarnessOpts): string[] {
  const det = installDeterminism(1);
  const out: string[] = [];
  try {
    const e = new GameEngine();
    const state = migrateState(JSON.parse(json) as GameState);
    (e as unknown as { adoptState: (s: GameState) => void }).adoptState(state);
    const sm = e.stateManager;
    const s = () => sm.state;
    const day = () => ((s().longGame?.meta.worldT ?? 0) / 86400).toFixed(2);
    const log = (m: string) => out.push(`${name} d${day()} act ${s().longGame?.meta.act}: ${m}`);
    let pending: string | null = null;
    const offs = [
      bus.on('story:chapter', (id: unknown) => { pending = id as string; }),
      bus.on('act:advance', (n: unknown) => log(`ACT ADVANCE -> ${n}`)),
      bus.on('siege:resolved', (r: unknown) => log(`siege resolved ${JSON.stringify(r)}`)),
    ];
    const act0 = actOf(s());
    log(`start: progress ${(actProgress(s()) * 100).toFixed(0)}% goals ${JSON.stringify(act0.goals.map(g => g.progress(s())))} sig ${act0.signature?.id}`);
    if (act0.signature?.id === 'siege') log(`siege forecast now ${JSON.stringify(siegeForecast(s()))}`);
    if (o.force !== undefined) {
      // Pretend the Act's other goals are this far along (so the beat can be seen on a save that is early in its Act).
      const real = actProgress;
      void real;
    }
    const answer = () => {
      if (!pending) return;
      const ch = getChapter(pending);
      const key = ch?.choices?.find(c => e.storySystem.canChoose(ch.id, c.key))?.key ?? null;
      e.storySystem.finish(pending, ch?.choices?.length ? key ?? ch.choices[ch.choices.length - 1].key : null);
      const flags = s().storyFlags.filter(f => f.startsWith(`choice:${pending}:`));
      log(`chapter ${pending} -> ${flags.join(',')} (eta sig ${signatureEta(s(), s().longGame!.meta.act)})`);
      pending = null;
    };
    const end = (s().longGame?.meta.worldT ?? 0) + o.days * 86400;
    while ((s().longGame?.meta.worldT ?? 0) < end) {
      for (let t = 0; t < o.online; t++) {
        e.advance(1, 'online');
        if (t % 10 === 0) answer();
      }
      e.simulate(o.away, 1);
      const a = actOf(s());
      const eta = signatureEta(s(), a.id);
      if (a.signature?.id === 'siege' && eta !== null && !s().storyFlags.includes('siege:done')) log(`siege in ${(eta / 3600).toFixed(1)}h forecast ${JSON.stringify(siegeForecast(s()))}`);
    }
    const a = actOf(s());
    log(`end: progress ${(actProgress(s()) * 100).toFixed(0)}% sig ${a.signature?.id} flags ${s().storyFlags.filter(f => /^(sig:|siege:|law:first|story:(frost|winter|quarrel|firstLaw|ridge|siege|signal|northStation|factions|firstVote|lastCensus|arkChapter))/.test(f)).join(',')}`);
    offs.forEach(f => f());
    void ACTS;
  } catch (err) {
    out.push(`${name} FAILED ${(err as Error).stack}`);
  } finally {
    det.restore();
  }
  return out;
}
