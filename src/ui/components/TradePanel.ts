import type { GameState, ResourceType } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { CARAVAN_CREW, CARGO_TIERS, MAX_RELATION, ambushChance, dealsToNext, openPartners, relationLevel, specialKey } from '../../data/trade';
import { RESOURCE_ICONS, button, el } from '../dom';
import { uiSound } from '../../audio/uiSound';

const chips = (o: Partial<Record<ResourceType, number>>) => Object.entries(o).map(([r, v]) => `${RESOURCE_ICONS[r] ?? r}${v}`).join(' ');

/** [LateGame B2] Trade caravans: shown on the home hex of the surface map. */
export function renderTrade(engine: GameEngine, state: GameState, changed: () => void): HTMLElement {
  const locale = i18n.currentLocale;
  const ex = engine.explorationSystem;
  const box = el('div', 'bp trade');
  box.appendChild(el('div', 'bp-section-title', `[[cart]] ${i18n.t('trade.title')}`));
  const partners = openPartners(state);
  if (partners.length === 0) {
    box.appendChild(el('div', 'bp-hint', i18n.t('trade.none')));
    return box;
  }
  // The pair that would go: the most charming healthy people who are free.
  const pair = state.survivors.filter(s => !s.isOnMission && !s.child && s.health > 40).sort((a, b) => b.stats.charisma - a.stats.charisma).slice(0, CARAVAN_CREW);
  for (const p of partners) {
    const lvl = relationLevel(state, p.id);
    const card = el('div', 'bp-card');
    const head = el('div', 'bp-row');
    const next = dealsToNext(state, p.id);
    head.append(
      el('span', 'research-name', `${p.icon} ${p.name[locale]}`),
      el('span', 'bp-hint', `${'[[star]]'.repeat(lvl)}${'·'.repeat(MAX_RELATION - lvl)}${next ? ` ${i18n.t('trade.next', { n: next })}` : ''}`),
    );
    card.append(head, el('div', 'bp-hint', p.desc[locale]));
    const out = state.activeMissions.find(m => m.type === 'caravan' && m.partner === p.id);
    if (out) {
      card.appendChild(el('div', 'bp-hint', `[[cart]] ${i18n.t('trade.out', { t: i18n.formatDuration(out.total - out.progress) })}`));
    } else {
      const row = el('div', 'btn-row');
      for (const tier of CARGO_TIERS) {
        const cargo = ex.cargoFor(state, p.id, tier.id);
        const ok = ex.canSendCaravan(state, p.id, pair.map(s => s.id), tier.id);
        row.appendChild(button(`${i18n.t(`trade.tier.${tier.id}`)}${cargo ? ` · ${chips(cargo)}` : ''}`, 'btn-secondary', () => {
          uiSound('depart');
          if (ex.sendCaravan(p.id, pair.map(s => s.id), tier.id)) { engine.requestSave(); changed(); }
        }, !ok));
      }
      card.appendChild(row);
      card.appendChild(el('div', 'bp-hint', `[[skull]] ${i18n.t('trade.risk', { n: Math.round(ambushChance(state, p.id) * 100), t: i18n.formatDuration(ex.caravanDuration(state, p.id)) })}`));
    }
    for (let n = 1; n <= lvl; n++) {
      const deal = p.specials[n - 1];
      if (state.lateGame.trade.specials.includes(specialKey(p.id, n))) continue;
      card.appendChild(button(`[[gift]] ${chips(deal.cost)} → ${chips(deal.gain)}`, 'btn-small', () => {
        if (ex.doSpecial(p.id, n)) { uiSound('click'); engine.requestSave(); changed(); }
      }, !ex.canSpecial(state, p.id, n)));
    }
    box.appendChild(card);
  }
  box.appendChild(el('div', 'bp-hint', i18n.t('trade.hint', { n: CARAVAN_CREW })));
  return box;
}
