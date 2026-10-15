import type { GameState, ResourceType } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { plural } from '../format';
import { CARAVAN_CREW, CARGO_TIERS, MAX_RELATION, ambushChance, dealsToNext, openPartners, relationLevel, specialKey } from '../../data/trade';
import { RESOURCE_ICONS, el } from '../dom';
import { kButton, kEmpty } from '../kit';
import { describeMissing } from '../missing';
import { flowArrow } from '../rtl'; // [plan4:UX-22]
import { uiSound } from '../../audio/uiSound';
import type { InboxItem } from '../../core/state/longGame';
import '../../styles/p4-o.css'; // [phase4]

/**
 * [phase4] One partner request (what used to be an Inbox contract card): what it asks and pays, what that means in this bunker (the
 * store it leaves, or the free hands it takes), when it lapses, and Accept / Decline. Lapsing costs nothing.
 */
function requestRow(engine: GameEngine, state: GameState, item: InboxItem, changed: () => void): HTMLElement {
  const cs = engine.contractSystem;
  const d = cs.data(item);
  const p = cs.describe(item, i18n.currentLocale);
  const row = el('div', 'p4o-request');
  row.dataset.request = String(item.id);
  row.appendChild(el('div', 'p4o-request__deal', `${p.ask} ${flowArrow()} ${p.reward}`));
  let bunker: string;
  if (d.type === 'crew') {
    bunker = i18n.t('p4o.req.crewBunker', { free: cs.freeHands(state).length, t: i18n.formatDuration(d.hours * 3600) });
  } else {
    const [r, v] = Object.entries(d.give)[0] ?? ['', 0];
    const res = state.resources[r as ResourceType];
    const perH = (res?.productionRate ?? 0) * 3600;
    bunker = i18n.t('p4o.req.supplyBunker', {
      left: `${RESOURCE_ICONS[r] ?? ''} ${i18n.formatCompact(Math.max(0, (res?.amount ?? 0) - (v ?? 0)))}`,
      t: perH > 0 ? i18n.formatDuration(((v ?? 0) / perH) * 3600) : '—',
    });
  }
  const worldT = state.longGame?.meta.worldT ?? 0;
  const left = item.deadline === null ? '' : ` · ${i18n.t('p4o.req.left', { t: i18n.formatDuration(Math.max(0, item.deadline - worldT)) })}`;
  row.appendChild(el('div', `bp-hint${cs.isSafe(state, item) ? ' p4o-request__safe' : ''}`, `${bunker}${left}`));
  const why = cs.canAccept(state, item) ? null
    : d.type === 'crew' ? i18n.t('ux2d.trade.crew', { n: d.crew })
    : describeMissing(state, d.give as Record<string, number>);
  const buttons = el('div', 'btn-row p4o-request__row');
  buttons.append(
    kButton({
      label: i18n.t(d.type === 'crew' ? 'contract.send' : 'contract.deliver'),
      disabledReason: why,
      sound: d.type === 'crew' ? 'depart' : null,
      onPress: () => { if (cs.answer(item.id, 'accept')) { uiSound('coin'); engine.requestSave(); changed(); } },
    }),
    kButton({
      variant: 'secondary',
      label: i18n.t('contract.decline'),
      onPress: () => { if (cs.answer(item.id, 'decline')) { uiSound('click'); engine.requestSave(); changed(); } },
    }),
  );
  row.appendChild(buttons);
  return row;
}

/** [phase4] A partner's (or the roads') open requests under a small title; nothing when there are none. */
function requestsBox(engine: GameEngine, state: GameState, issuer: string, changed: () => void): HTMLElement | null {
  const items = engine.contractSystem.requestsOf(state, issuer);
  if (items.length === 0) return null;
  const box = el('div', 'p4o-requests');
  box.appendChild(el('div', 'p4o-requests__title', `[[inbox]] ${plural('p4o.req.title', items.length)}`));
  for (const it of items) box.appendChild(requestRow(engine, state, it, changed));
  return box;
}

const chips = (o: Partial<Record<ResourceType, number>>) => Object.entries(o).map(([r, v]) => `${RESOURCE_ICONS[r] ?? r}${v}`).join(' ');

/** [LateGame B2] Trade caravans: shown on the home hex of the surface map. */
export function renderTrade(engine: GameEngine, state: GameState, changed: () => void): HTMLElement {
  const locale = i18n.currentLocale;
  const ex = engine.explorationSystem;
  const box = el('div', 'bp trade');
  box.appendChild(el('div', 'bp-section-title', `[[cart]] ${i18n.t('trade.title')}`));
  const partners = openPartners(state);
  // [phase4] Requests from the drifters on the roads (no partner card of their own) come first.
  const roads = requestsBox(engine, state, 'drifters', changed);
  if (roads) {
    const card = el('div', 'bp-card');
    card.append(el('span', 'research-name', `[[walker]] ${i18n.t('contract.drifters')}`), roads);
    box.appendChild(card);
  }
  if (partners.length === 0) {
    box.appendChild(kEmpty('cart', i18n.t('trade.none'))); // [ux-redesign W2d] empty state
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
    const asks = requestsBox(engine, state, p.id, changed); // [phase4] the partner's requests on its own card
    if (asks) card.appendChild(asks);
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
