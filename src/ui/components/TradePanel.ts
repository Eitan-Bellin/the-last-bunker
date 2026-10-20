import type { GameState, ResourceType } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { plural } from '../format';
import { CARAVAN_CREW, CARGO_TIERS, MAX_RELATION, ambushChance, dealsToNext, getPartner, openPartners, relationLevel, specialKey } from '../../data/trade';
import type { InboxItem } from '../../core/state/longGame';
import { RESOURCE_ICONS, el } from '../dom';
import { kButton, kEmpty } from '../kit';
import { describeMissing } from '../missing';
import { flowArrow } from '../rtl'; // [plan4:UX-22]
import { uiSound } from '../../audio/uiSound';

const chips = (o: Partial<Record<ResourceType, number>>) => Object.entries(o).map(([r, v]) => `${RESOURCE_ICONS[r] ?? r}${v}`).join(' ');

/**
 * [phase4b] A partner's requests (the old Inbox contracts): what it asks, what it pays, what it means in this bunker, and Accept / Decline.
 * Shown on the partner's card here and on its map marker's card (SurfacePanel).
 */
export function renderRequests(engine: GameEngine, state: GameState, issuer: string, changed: () => void): HTMLElement | null {
  const cs = engine.contractSystem;
  const list = cs.requests(state, issuer);
  if (list.length === 0) return null;
  const box = el('div', 'p4bo-requests');
  box.appendChild(el('div', 'p4bo-requests__title', `[[cart]] ${plural('p4bO.req.title', list.length)}`));
  for (const item of list) box.appendChild(requestCard(engine, state, item, changed));
  return box;
}

function requestCard(engine: GameEngine, state: GameState, item: InboxItem, changed: () => void): HTMLElement {
  const cs = engine.contractSystem;
  const d = cs.data(item);
  const p = cs.describe(item, i18n.currentLocale);
  const card = el('div', `p4bo-request${cs.isSafe(state, item) ? ' is-safe' : ''}`);
  const deal = el('div', 'p4bo-request__deal');
  deal.append(el('span', 'p4bo-request__line', i18n.t('p4bO.req.asks', { list: p.ask })), el('span', 'p4bo-request__line', i18n.t('p4bO.req.pays', { list: p.reward })));
  card.appendChild(deal);
  const b = cs.inBunker(state, item);
  const worldT = state.longGame?.meta.worldT ?? 0;
  const lapse = item.deadline === null ? '' : ` · ${i18n.t('p4bO.req.left', { t: i18n.formatDuration(Math.max(0, item.deadline - worldT)) })}`;
  const here = d.type === 'crew'
    ? i18n.t('p4bO.req.crewBunker', { free: b.free ?? 0, t: i18n.formatDuration(d.hours * 3600) })
    : b.hours !== undefined
      ? i18n.t('p4bO.req.supplyBunker', { left: i18n.formatCompact(b.left ?? 0), t: i18n.formatDuration(b.hours * 3600) })
      : i18n.t('p4bO.req.supplyLeft', { left: i18n.formatCompact(b.left ?? 0) });
  card.appendChild(el('div', 'bp-hint', `[[vault]] ${here}${lapse}`));
  if (cs.isSafe(state, item)) card.appendChild(el('div', 'p4bo-request__safe', `[[check]] ${i18n.t('contract.safe')}`));
  const row = el('div', 'p4bo-request__row');
  const can = cs.canAccept(state, item);
  row.append(
    kButton({
      label: i18n.t(d.type === 'crew' ? 'contract.send' : 'contract.deliver'),
      disabledReason: can ? null : d.type === 'crew' ? i18n.t('ux2d.trade.crew', { n: d.crew }) : describeMissing(state, d.give as Record<string, number>),
      sound: d.type === 'crew' ? 'depart' : 'coin',
      onPress: () => { if (cs.answer(item.id, 'accept')) { engine.requestSave(); changed(); } },
    }),
    kButton({
      variant: 'secondary',
      label: i18n.t('contract.decline'),
      onPress: () => { if (cs.answer(item.id, 'decline')) { uiSound('click'); engine.requestSave(); changed(); } },
    }),
  );
  card.appendChild(row);
  return card;
}

/** [LateGame B2] Trade caravans: shown on the home hex of the surface map. [phase4b] With each partner's requests on its card. */
export function renderTrade(engine: GameEngine, state: GameState, changed: () => void): HTMLElement {
  const locale = i18n.currentLocale;
  const ex = engine.explorationSystem;
  const box = el('div', 'bp trade');
  box.appendChild(el('div', 'bp-section-title', `[[cart]] ${i18n.t('trade.title')}`));
  const partners = openPartners(state);
  // [phase4b] One tap for every request that costs nothing the bunker would miss (was in the bell).
  const cs = engine.contractSystem;
  const safe = cs.requests(state).filter(i => cs.isSafe(state, i)).length;
  if (safe >= 2) {
    box.appendChild(kButton({
      variant: 'secondary',
      className: 'btn-secondary p4bo-requests__all',
      label: `[[check]] ${i18n.t('p4bO.req.acceptSafe', { n: safe })}`,
      onPress: () => { if (cs.acceptSafe() > 0) { engine.requestSave(); changed(); } },
    }));
  }
  // [phase4b] The roads: requests from drifters (no partner, no relation), and from any partner whose road is not open for caravans yet.
  const shown = new Set(partners.map(p => p.id));
  const others = [...new Set(cs.requests(state).map(i => cs.data(i).issuer))].filter(id => !shown.has(id as never));
  let roads = false;
  for (const id of others) {
    const reqs = renderRequests(engine, state, id, changed);
    if (!reqs) continue;
    roads = true;
    const pd = getPartner(id);
    const card = el('div', 'bp-card');
    card.append(el('div', 'research-name', pd ? `${pd.icon} ${pd.name[locale]}` : `[[walker]] ${i18n.t('contract.drifters')}`), reqs);
    box.appendChild(card);
  }
  if (partners.length === 0) {
    if (!roads) box.appendChild(kEmpty('cart', i18n.t('trade.none'))); // [ux-redesign W2d] empty state
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
      el('span', 'bp-hint', `${'[[star]]'.repeat(lvl)}${'·'.repeat(MAX_RELATION - lvl)}${next ? ` ${plural('trade.next', next)}` : ''}`),
    );
    card.append(head, el('div', 'bp-hint', p.desc[locale]));
    card.dataset.partner = p.id; // [phase4b] the map marker scrolls here
    const reqs = renderRequests(engine, state, p.id, changed); // [phase4b] the partner's requests, first thing on its card
    if (reqs) card.appendChild(reqs);
    const out = state.activeMissions.find(m => m.type === 'caravan' && m.partner === p.id);
    if (out) {
      card.appendChild(el('div', 'bp-hint', `[[cart]] ${i18n.t('trade.out', { t: i18n.formatDuration(out.total - out.progress) })}`));
    } else {
      const row = el('div', 'btn-row');
      for (const tier of CARGO_TIERS) {
        const cargo = ex.cargoFor(state, p.id, tier.id);
        const ok = ex.canSendCaravan(state, p.id, pair.map(s => s.id), tier.id);
        // [ux-redesign W2d] A caravan that cannot leave says why.
        const why = ok ? null
          : ex.teamsFull(state) ? i18n.t('surface.teamsFull')
          : pair.length < CARAVAN_CREW ? i18n.t('ux2d.trade.crew', { n: CARAVAN_CREW })
          : !cargo ? i18n.t('ux2d.trade.noCargo')
          : '';
        row.appendChild(kButton({
          variant: 'secondary',
          label: `${i18n.t(`trade.tier.${tier.id}`)}${cargo ? ` · ${chips(cargo)}` : ''}`,
          disabledReason: why,
          sound: 'depart',
          onPress: () => {
            if (ex.sendCaravan(p.id, pair.map(s => s.id), tier.id)) { engine.requestSave(); changed(); }
          },
        }));
      }
      card.appendChild(row);
      card.appendChild(el('div', 'bp-hint', `[[skull]] ${i18n.t('trade.risk', { n: Math.round(ambushChance(state, p.id) * 100), t: i18n.formatDuration(ex.caravanDuration(state, p.id)) })}`));
    }
    for (let n = 1; n <= lvl; n++) {
      const deal = p.specials[n - 1];
      if (state.lateGame.trade.specials.includes(specialKey(p.id, n))) continue;
      card.appendChild(kButton({
        variant: 'secondary',
        className: 'btn-small',
        label: `[[gift]] ${chips(deal.cost)} ${flowArrow()} ${chips(deal.gain)}`, /* [plan4:UX-22] */
        disabledReason: ex.canSpecial(state, p.id, n) ? null : describeMissing(state, deal.cost as Record<string, number>),
        onPress: () => { if (ex.doSpecial(p.id, n)) { uiSound('click'); engine.requestSave(); changed(); } },
      }));
    }
    box.appendChild(card);
  }
  box.appendChild(el('div', 'bp-hint', i18n.t('trade.hint', { n: CARAVAN_CREW })));
  return box;
}
