import type { GameState } from '../core/GameState';
import type { EventChoice } from '../systems/EventSystem';
import { i18n } from '../i18n/I18nManager';
import { costRow, el } from './dom';

/**
 * [ux-wp5 C2 / playtest P10] What goes under an event's choice button: its cost (as before) and a short line saying what it
 * buys or risks ("1 bed · one more pair of hands", "~1,200 water lost"), so the choice is made knowing both sides.
 */
export function choiceDetail(state: GameState, c: EventChoice, params: Record<string, string>): HTMLElement | undefined {
  const cost = c.cost ? costRow(state, c.cost as Record<string, number>) : undefined;
  if (!c.hint) return cost;
  const vars: Record<string, string | number> = { ...params };
  for (const [k, v] of Object.entries(c.hintParams ?? {})) vars[k] = typeof v === 'number' ? i18n.formatCompact(v) : v;
  const hint = el('span', 'exp-hints', i18n.t(c.hint, vars));
  if (!cost) return hint;
  const box = el('div');
  box.append(cost, hint);
  return box;
}
