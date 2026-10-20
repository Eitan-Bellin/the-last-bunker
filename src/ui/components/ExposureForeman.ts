import type { GameEngine } from '../../core/GameEngine';
import type { GameState } from '../../core/GameState';
import { i18n } from '../../i18n/I18nManager';
import { el } from '../dom';
import { fmtNum } from '../format';
import { kButton } from '../kit';
import { crewCount, getDef } from '../../data/buildingDefs';
import { specOf } from '../../data/specializations';
import { quickFixCost } from '../../data/incidents';
import { AUTO_PAY_STEPS, RAID_FIGHT_STEPS, costShare, foremanPolicy, type ForemanPolicy } from '../../systems/ForemanSystem';
import { actCurrency } from '../../systems/ThreatSystem';
import { bunkerDefense, raidStrength, raidTribute, winChance } from '../../systems/EventSystem';
import { doctrineAwayTruce } from '../../systems/ResearchSystem';
import '../../styles/p4b-d.css';

/**
 * [phase4b] (C5) The Foreman as strategy: the card on the Command's Policies tab shows only the real policies: the away raid policy, the
 * resource priority ("the Act's currency first") and the incident auto-pay ceiling, plus the one order that trades something (shut the
 * doors in trouble). The chores (deliveries, staffing, training; maintenance is the crew's) run by themselves and are not shown.
 *
 * Wiring (EraPanel, the lead's): `renderForeman(state)` returns `renderForemanPolicies(this.engine!, () => { this.signature = ''; this.refresh(...) })`,
 * its signature adds `foremanPoliciesSig(state)`, and `refreshForeman` calls `refreshForemanPolicies(state)`.
 */

/** What changes the card's drawing (the EraPanel signature adds it): the policies, the door order and the "in your bunker" numbers. */
export function foremanPoliciesSig(state: GameState): string {
  const p = foremanPolicy(state);
  const lg = state.longGame;
  return `${p.fightAt}|${p.otherwise}|${p.priority}|${p.autoPay}|${lg?.foreman.orders.sealOnAlarm ? 1 : 0}|${Math.round(awayOdds(state) * 20)}|${actCurrency(state)}`;
}

/** The odds the Foreman would weigh against a gang sized up now (the middle of the band, holding the door). */
function awayOdds(state: GameState): number {
  const def = bunkerDefense(state);
  return winChance(def, raidStrength(state, 0.5));
}

/** Free places in the rooms that make the Act's currency (what "the Act's currency first" would fill). */
function actPlaces(state: GameState): number {
  const cur = actCurrency(state);
  let n = 0;
  for (const b of state.buildings) {
    if (b.isConstructing) continue;
    const makes = cur in ((getDef(b.type)?.production ?? {}) as Record<string, unknown>) || cur in ((specOf(b)?.extra ?? {}) as Record<string, unknown>);
    if (makes) n += Math.max(0, (getDef(b.type)?.maxWorkers ?? 0) - crewCount(state, b));
  }
  return n;
}

let liveLine: HTMLElement | null = null;
let liveFix: HTMLElement | null = null;

/** A row of choices; the chosen one is pressed (a shape, the check, not colour alone). */
function seg<T>(label: string, options: { v: T; text: string }[], current: T, pick: (v: T) => void): HTMLElement {
  const row = el('div', 'p4bd-seg');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', label);
  for (const o of options) {
    const b = el('button', 'p4bd-seg__btn', o.text);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(o.v === current));
    b.addEventListener('click', () => { if (o.v !== current) pick(o.v); });
    row.appendChild(b);
  }
  return row;
}

export function renderForemanPolicies(engine: GameEngine, onChange: () => void): HTMLElement {
  const state = engine.stateManager.state;
  const f = engine.foremanSystem;
  const p = foremanPolicy(state);
  const cur = i18n.t(`resources.${actCurrency(state)}`);
  const set = (patch: Partial<ForemanPolicy>) => {
    f.setPolicy(patch);
    engine.notifyInteraction();
    engine.requestSave();
    onChange();
  };
  const box = el('div', 'foreman p4bd-policies');
  box.appendChild(el('div', 'bp-section-title', `[[worker]] ${i18n.t('p4bD.policy.title')}`));
  box.appendChild(el('div', 'bp-hint', i18n.t('p4bD.policy.chores')));

  // 1. Raids while away: fight at X% or better, else pay or hide.
  const raid = el('div', 'p4bd-policy');
  raid.appendChild(el('div', 'p4bd-policy__name', `[[armory]] ${i18n.t('p4bD.policy.raid')}`));
  raid.appendChild(seg(i18n.t('p4bD.policy.raid'), RAID_FIGHT_STEPS.map(v => ({ v, text: i18n.t('p4bD.policy.atLeast', { pct: Math.round(v * 100) }) })), p.fightAt, v => set({ fightAt: v })));
  raid.appendChild(el('div', 'bp-hint', i18n.t('p4bD.policy.elseLabel')));
  raid.appendChild(seg(i18n.t('p4bD.policy.elseLabel'), [
    { v: 'pay' as const, text: i18n.t('p4bD.policy.else.pay') },
    { v: 'hide' as const, text: i18n.t('p4bD.policy.else.hide') },
  ], p.otherwise, v => set({ otherwise: v })));
  liveLine = el('div', 'bp-hint p4bd-live');
  raid.appendChild(liveLine);
  if (doctrineAwayTruce(state)) raid.appendChild(el('div', 'bp-hint', `[[flag]] ${i18n.t('p4bD.policy.truce')}`));
  box.appendChild(raid);

  // 2. Resource priority: where the free hands go.
  const prio = el('div', 'p4bd-policy');
  prio.appendChild(el('div', 'p4bd-policy__name', `[[worker]] ${i18n.t('p4bD.policy.priority')}`));
  prio.appendChild(seg(i18n.t('p4bD.policy.priority'), [
    { v: 'even' as const, text: i18n.t('p4bD.policy.prio.even') },
    { v: 'act' as const, text: i18n.t('p4bD.policy.prio.act', { cur }) },
  ], p.priority, v => set({ priority: v })));
  prio.appendChild(el('div', 'bp-hint', p.priority === 'act' ? i18n.t('p4bD.policy.prio.act.hint', { cur, n: actPlaces(state) }) : i18n.t('p4bD.policy.prio.even.hint')));
  box.appendChild(prio);

  // 3. The incident auto-pay ceiling.
  const pay = el('div', 'p4bd-policy');
  pay.appendChild(el('div', 'p4bd-policy__name', `[[fire]] ${i18n.t('p4bD.policy.autoPay')}`));
  pay.appendChild(seg(i18n.t('p4bD.policy.autoPay'), AUTO_PAY_STEPS.map(v => ({ v, text: v <= 0 ? i18n.t('p4bD.policy.never') : i18n.t('p4bD.policy.upTo', { pct: Math.round(v * 100) }) })), p.autoPay, v => set({ autoPay: v })));
  pay.appendChild(el('div', 'bp-hint', i18n.t('p4bD.policy.autoPayHint')));
  liveFix = el('div', 'bp-hint p4bd-live');
  pay.appendChild(liveFix);
  box.appendChild(pay);

  // The one order that trades something: shut the doors around trouble (power, cut-off rooms).
  const on = f.isOn(state, 'sealOnAlarm');
  const doors = el('div', 'p4bd-switch');
  const sw = kButton({
    variant: on ? 'primary' : 'secondary',
    label: on ? `✓ ${i18n.t('settings.on')}` : i18n.t('settings.off'),
    onPress: () => { f.set('sealOnAlarm', !on); engine.requestSave(); onChange(); },
  });
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(on));
  sw.setAttribute('aria-label', i18n.t('p4bD.policy.doors'));
  doors.append(el('span', 'p4bd-policy__name', `[[door]] ${i18n.t('p4bD.policy.doors')}`), sw);
  box.appendChild(doors);

  refreshForemanPolicies(state, engine);
  return box;
}

/** The live lines of the card: what the Foreman would do with a raid now, and what a quick fix asks of the stores. */
export function refreshForemanPolicies(state: GameState, engine?: GameEngine): void {
  if (liveLine?.isConnected || (liveLine && engine)) {
    const p = foremanPolicy(state);
    const odds = awayOdds(state);
    const toll = raidTribute(state);
    const c = actCurrency(state);
    const verdict = odds >= p.fightAt ? 'fight' : p.otherwise === 'pay' ? 'pay' : 'hide';
    const text = (state.era ?? 0) < 2 ? i18n.t('p4bD.exp.noRaids')
      : i18n.t('p4bD.policy.raidNow', { pct: Math.round(odds * 100), toll: fmtNum(toll[c] ?? 0), cur: i18n.t(`resources.${c}`), verdict: i18n.t(`p4bD.policy.would.${verdict}`) });
    if (liveLine.textContent !== text) liveLine.textContent = text;
  }
  if (liveFix?.isConnected || (liveFix && engine)) {
    const fix = Math.round(Math.min(999, costShare(state, quickFixCost(state, 'fire')) * 100));
    const paid = engine?.foremanSystem.paid ?? 0;
    const text = i18n.t('p4bD.policy.autoPayNow', { fix: isFinite(fix) ? fix : 100, paid });
    if (liveFix.textContent !== text) liveFix.textContent = text;
  }
}
