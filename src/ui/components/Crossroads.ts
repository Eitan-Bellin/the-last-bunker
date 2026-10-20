import type { GameEngine } from '../../core/GameEngine';
import type { GameState, ResourceType } from '../../core/GameState';
import { i18n } from '../../i18n/I18nManager';
import { fmtNum, plural } from '../format';
import { RESOURCE_ICONS, costRow, el } from '../dom';
import { kButton, setKButtonLabel } from '../kit';
import { uiSound } from '../../audio/uiSound';
import { getResearch, type ResearchDef } from '../../data/research';
import { ENDINGS, endingOfDoctrine, endingScore } from '../../data/endings';
import { bunkerDefense, raidProfile, raidStrength } from '../../systems/EventSystem';
import { threatPace, threatTarget } from '../../systems/ThreatSystem';
import { describeMissing } from '../missing';
import { prepareModifiers } from '../../systems/modifiers';
import '../../styles/p4-c.css';

/**
 * [phase4] The Crossroads (strategy review C1): a doctrine fork is no longer a research node the player stumbles on. When its Act (and
 * schedule) opens it, a full-screen choice opens once, three ways side by side (stacked on a phone). Each way shows the rule it changes,
 * what that means in THIS bunker (numbers computed from the save as it would be with the doctrine), and the ending it pushes.
 * Choosing pays the price and makes it law at once (ResearchSystem.chooseDoctrine); "Decide later" leaves it waiting in Research and in
 * Command > Policies. The overlay carries the `ceremony` class, so the dialog queue (GameApp.ceremonyActive) holds other dialogs back.
 */

/** Story flag set when a fork's Crossroads has opened by itself once. */
const shownFlag = (fork: string) => `crossroads:${fork}`;

/** [phase4] The fork whose Crossroads should open by itself now (waiting and never shown), or null. For the dialog queue. */
export function crossroadsDue(engine: GameEngine, state: GameState): string | null {
  if (!state.longGame) return null;
  return engine.researchSystem.waitingForks(state).find(f => !state.storyFlags.includes(shownFlag(f))) ?? null;
}

/** [phase4] One line for the "N waiting" card. */
export function crossroadsLabel(fork: string): string {
  return i18n.t('p4c.xr.title', { fork: i18n.t(`p4c.fork.${fork}`) });
}

/** The save as it would be with this doctrine chosen (for the "in your bunker" numbers and the ending tally). */
function withDoctrine(state: GameState, id: string): GameState {
  return { ...state, research: { ...state.research, [id]: { id, completed: true, progress: 0, total: 0, isResearching: false } } };
}

/** Per-hour output of every room, by resource. */
function outputPerHour(engine: GameEngine, state: GameState): Partial<Record<ResourceType, number>> {
  const out: Partial<Record<ResourceType, number>> = {};
  for (const b of state.buildings) {
    for (const [r, v] of Object.entries(engine.resourceSystem.getBuildingOutput(state, b)) as [ResourceType, number][]) out[r] = (out[r] ?? 0) + v * 3600;
  }
  return out;
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtNum(Math.abs(n))}`;
const avgMorale = (s: GameState) => (s.survivors.length ? s.survivors.reduce((a, x) => a + x.happiness, 0) / s.survivors.length : 0);

/**
 * [phase4] What a doctrine means in this bunker right now, as short lines: output per hour that changes, defense, exposure (the threat
 * meter's target), morale, raids, and the rules that have no number of their own.
 */
export function doctrineInBunker(engine: GameEngine, state: GameState, def: ResearchDef): string[] {
  const after = withDoctrine(state, def.id);
  const lines: string[] = [];
  // Output: the rooms' own numbers with and without it (the modifiers and research multipliers read the save).
  const now = outputPerHour(engine, state);
  const then = outputPerHour(engine, after);
  prepareModifiers(state); // the modifiers read the real save again
  const deltas = (Object.keys({ ...now, ...then }) as ResourceType[])
    .map(r => ({ r, d: (then[r] ?? 0) - (now[r] ?? 0), base: now[r] ?? 0 }))
    .filter(x => Math.abs(x.d) >= 1 && Math.abs(x.d) >= 0.005 * Math.max(1, x.base))
    .sort((a, b) => Math.abs(b.d) / Math.max(1, b.base) - Math.abs(a.d) / Math.max(1, a.base))
    .slice(0, 3);
  for (const x of deltas) lines.push(i18n.t('p4c.b.prod', { n: signed(x.d), icon: RESOURCE_ICONS[x.r] ?? '', name: i18n.t(`resources.${x.r}`) }));
  const d0 = bunkerDefense(state), d1 = bunkerDefense(after);
  if (Math.abs(d1 - d0) >= 1) lines.push(i18n.t('p4c.b.defense', { from: fmtNum(d0), to: fmtNum(d1) }));
  const t0 = Math.round(threatTarget(state)), t1 = Math.round(threatTarget(after));
  if (t0 !== t1) lines.push(i18n.t('p4c.b.threat', { from: t0, to: t1 }));
  const morale = def.effects.reduce((s, e) => s + (e.type === 'morale' ? e.value : 0), 0);
  if (morale) lines.push(i18n.t('p4c.b.morale', { n: morale, from: Math.round(avgMorale(state)), to: Math.round(avgMorale(state) + morale) }));
  // Rules without a number of their own.
  const perDay = (s: GameState) => raidProfile(s).perDay * threatPace(s);
  switch (def.id) {
    case 'fortress':
      lines.push(i18n.t('p4c.b.fortress', { from: perDay(state).toFixed(1), to: (perDay(state) * 0.7).toFixed(1), s0: fmtNum(raidStrength(state)), s1: fmtNum(raidStrength(state) * 1.3), d: fmtNum(d1) }));
      break;
    case 'diplomacy': lines.push(i18n.t('p4c.b.diplomacy', { from: perDay(state).toFixed(1), to: perDay(after).toFixed(1) })); break;
    case 'rangers': lines.push(i18n.t('p4c.b.rangers')); break;
    case 'isolationism': lines.push(plural('p4c.b.isolationism', ((state.longGame?.world.outposts ?? []) as unknown[]).length)); break;
    case 'expansionism': lines.push(plural('p4c.b.expansionism', ((state.longGame?.world.outposts ?? []) as unknown[]).length)); break;
    case 'meritocracy': lines.push(plural('p4c.b.meritocracy', state.survivors.filter(s => !s.child).length)); break;
    case 'confederation': lines.push(i18n.t('p4c.b.confederation', { from: state.maxPopulation, to: state.maxPopulation + 15 })); break;
    case 'geothermal': lines.push(plural('p4c.b.deep', state.buildings.filter(b => b.position.floor >= state.currentFloors - 3).length)); break;
    case 'solarArray': lines.push(plural('p4c.b.top', state.buildings.filter(b => b.position.floor <= 1).length)); break;
    case 'merchantRepublic': lines.push(i18n.t('p4c.b.merchant')); break;
    default: break;
  }
  if (!lines.length) lines.push(i18n.t(def.fork === 'crossing' ? 'p4c.b.none' : 'p4c.b.rule'));
  return lines;
}

/** [phase4] "pushes The Fortress: 4.0 → 6.0" (the ending this doctrine adds to, and its score before and after). */
export function doctrineEndingLine(state: GameState, def: ResearchDef): string {
  const e = endingOfDoctrine(def.id);
  if (!e) return '';
  const after = withDoctrine(state, def.id);
  return i18n.t('p4c.xr.pushes', { icon: e.icon, name: e.name[i18n.currentLocale], from: endingScore(state, e).toFixed(1), to: endingScore(after, e).toFixed(1) });
}

/** [phase4] Which ending leads now (for the Crossroads' footer). */
function leadingEnding(state: GameState): string {
  const best = [...ENDINGS].sort((a, b) => endingScore(state, b) - endingScore(state, a))[0];
  return `${best.icon} ${best.name[i18n.currentLocale]}`;
}

/**
 * [phase4] Opens the Crossroads for a fork. Marks it shown (it never opens by itself again; Research and Command still open it).
 * `onDone(chosen)` runs when it closes: the doctrine id, or null for "Decide later".
 */
export function showCrossroads(engine: GameEngine, fork: string, onDone: (chosen: string | null) => void = () => {}): void {
  const sm = engine.stateManager;
  if (!sm.state.storyFlags.includes(shownFlag(fork))) sm.applyDelta({ path: 'storyFlags', value: [...sm.state.storyFlags, shownFlag(fork)] });
  document.querySelector('.p4c-xr')?.remove();
  const rs = engine.researchSystem;
  const locale = i18n.currentLocale;
  const overlay = el('div', 'ceremony block p4c-xr');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const forkName = i18n.t(`p4c.fork.${fork}`);
  overlay.setAttribute('aria-label', crossroadsLabel(fork));
  const inner = el('div', 'p4c-xr__inner');
  inner.append(
    el('div', 'p4c-xr__kicker', `[[flag]] ${i18n.t('p4c.xr.kicker')}`),
    el('h2', 'p4c-xr__title', crossroadsLabel(fork)),
    el('p', 'p4c-xr__hint', i18n.t('p4c.xr.hint')),
  );
  let closed = false;
  const close = (chosen: string | null) => {
    if (closed) return;
    closed = true;
    overlay.classList.remove('in');
    window.setTimeout(() => overlay.remove(), 300);
    onDone(chosen);
  };
  const grid = el('div', 'p4c-xr__grid');
  const state = sm.state;
  /** The button waiting for its second tap (a permanent choice is confirmed). */
  let armed: { id: string; btn: HTMLButtonElement; label: string } | null = null;
  for (const base of rs.forkOptions(fork)) {
    const def = rs.defOf(state, base.id) ?? base;
    const col = el('section', 'p4c-xr__col');
    col.append(el('h3', 'p4c-xr__name', `${def.icon} ${(def.name[locale] ?? def.name.en).replace(/^[^:]*:\s*/, '')}`));
    col.appendChild(el('div', 'p4c-xr__label', i18n.t('p4c.xr.rule')));
    col.appendChild(el('p', 'p4c-xr__rule', def.desc[locale] ?? def.desc.en));
    col.appendChild(el('div', 'p4c-xr__label', i18n.t('p4c.xr.bunker')));
    const ul = el('ul', 'p4c-xr__nums');
    for (const line of doctrineInBunker(engine, state, def)) ul.appendChild(el('li', '', line));
    col.appendChild(ul);
    col.appendChild(el('div', 'p4c-xr__label', i18n.t('p4c.xr.ending')));
    col.appendChild(el('p', 'p4c-xr__ending', doctrineEndingLine(state, def)));
    const cost = def.cost as Record<string, number>;
    col.appendChild(costRow(state, cost));
    const block = rs.chooseBlock(state, def.id);
    const label = `${i18n.t('p4c.xr.choose')}`;
    const btn = kButton({
      variant: 'primary', className: 'btn-primary p4c-xr__choose', label,
      disabledReason: block === 'cost' ? describeMissing(state, cost) : block === 'closed' ? i18n.t('p4c.xr.closed') : null,
      onPress: () => {
        if (!armed || armed.id !== def.id) {
          if (armed) setKButtonLabel(armed.btn, armed.label);
          armed = { id: def.id, btn, label };
          setKButtonLabel(btn, i18n.t('p4c.xr.confirm', { name: (def.name[locale] ?? def.name.en).replace(/^[^:]*:\s*/, '') }));
          return;
        }
        if (rs.chooseDoctrine(sm, def.id)) {
          uiSound('confirm');
          engine.requestSave();
          close(def.id);
        }
      },
    });
    col.appendChild(btn);
    grid.appendChild(col);
  }
  inner.appendChild(grid);
  inner.appendChild(el('p', 'p4c-xr__hint', i18n.t('p4c.xr.lead', { name: leadingEnding(state), fork: forkName })));
  inner.appendChild(kButton({ variant: 'tertiary', className: 'btn-ghost p4c-xr__later', label: i18n.t('p4c.xr.later'), onPress: () => close(null) }));
  overlay.appendChild(inner);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('in'));
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
  requestAnimationFrame(() => overlay.querySelector<HTMLElement>('.p4c-xr__choose')?.focus());
}

/** [phase4] For the Research panel and Command: the fork a doctrine id belongs to. */
export function forkOf(id: string): string | undefined {
  return getResearch(id)?.fork;
}
