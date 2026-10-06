import { hasKeystone } from '../data/prestige';
import { lateActTwoSystems } from '../data/acts';
import type { StateManager } from '../core/StateManager';
import type { GameState, ResourceType } from '../core/GameState';
import type { InboxItem } from '../core/state/longGame';
import { bus } from '../core/EventBus';
import { actBundle } from '../data/pricing';
import { getPartner, openPartners } from '../data/trade';
import { i18n } from '../i18n/I18nManager';
import { RESOURCE_ICONS } from '../ui/dom';
import { TUNING } from '../data/tuning';
import { registerInboxKind, type InboxSystem } from './InboxSystem';
import type { ResourceSystem } from './ResourceSystem';
import type { PopulationSystem } from './PopulationSystem';

/** People out on a contract job are stored like a project crew (assignedBuildingId = 'p_contract'). */
export const CONTRACT_CREW = 'p_contract';

/** What a contract asks: goods delivered now, or people sent out for a few hours. */
export type ContractType = 'supply' | 'crew';

export interface ContractData {
  issuer: string;
  type: ContractType;
  /** Goods to deliver (supply). */
  give: Partial<Record<ResourceType, number>>;
  /** People and hours away (crew). */
  crew: number;
  hours: number;
  reward: Partial<Record<ResourceType, number>>;
}

/** A crew job under way. */
interface Job { id: number; crew: string[]; until: number; reward: Partial<Record<ResourceType, number>>; issuer: string }

/**
 * [Q5] Goods a supply contract may ask for: the ones the bunker never has in surplus. The old rule (30% of a store, drawn
 * from food, water, materials...) asked for goods that sat at their cap anyway, so accepting cost nothing. Now the
 * ask is about an hour of the bunker's own production of one scarce good.
 */
const ASKS: ResourceType[] = ['medicine', 'scrap', 'knowledge', 'components', 'alloys', 'data'];
const FALLBACK_ASK: ResourceType[] = ['materials', 'food', 'water'];

/**
 * [Long game P4] Contracts (long-game plan, pillar D): the active play that sets an engaged player apart from a casual
 * one (pacing law L4). Every ~40 minutes of world time a partner (or the drifters on the roads) posts an offer to the
 * Decision Inbox; it waits two hours and then lapses (nothing is lost). Taking it costs goods or people's time and
 * pays hours of the Act's currency, and counts as a deal with the partner (their relation grows).
 */
export class ContractSystem {
  private sm: StateManager;
  private inbox: InboxSystem;
  private resources: ResourceSystem;
  private population: PopulationSystem;

  constructor(sm: StateManager, inbox: InboxSystem, resources: ResourceSystem, population: PopulationSystem) {
    this.sm = sm;
    this.inbox = inbox;
    this.resources = resources;
    this.population = population;
    registerInboxKind('contract', {
      title: 'contract.title',
      body: 'contract.body',
      icon: '[[cart]]',
      choices: (item, state) => {
        const d = item.data as unknown as ContractData;
        return [
          { key: 'accept', label: d.type === 'crew' ? 'contract.send' : 'contract.deliver', cost: d.type === 'supply' ? d.give as Record<string, number> : undefined, available: d.type === 'supply' || this.freeHands(state).length >= d.crew },
          { key: 'decline', label: 'contract.decline' },
        ];
      },
      apply: (item, key) => this.apply(item, key),
      params: (item, locale) => this.cardParams(item, locale),
      preview: (item, locale) => {
        const p = this.cardParams(item, locale);
        return `${p.ask}  →  ${p.reward}`;
      },
      value: item => Object.values((item.data as unknown as ContractData).reward).reduce((s, v) => s + (v ?? 0), 0),
    });
  }

  private cardParams(item: InboxItem, locale: string): Record<string, string> {
    const d = item.data as unknown as ContractData;
    const partner = getPartner(d.issuer);
    const list = (o: Partial<Record<ResourceType, number>>) => Object.entries(o).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''} ${i18n.formatCompact(v ?? 0)}`).join('  ');
    return {
      issuer: partner ? partner.name[locale as 'he' | 'en'] : i18n.t('contract.drifters'),
      ask: d.type === 'crew' ? i18n.t('contract.askCrew', { n: d.crew, h: d.hours }) : list(d.give),
      reward: list(d.reward),
    };
  }

  /**
   * [Q4/Q9] Whether taking a contract costs the bunker nothing it would miss: a supply contract leaves the asked store
   * above a safe share of its cap; a crew job needs idle hands (it never pulls people off their rooms).
   */
  isSafe(state: GameState, item: InboxItem): boolean {
    const d = item.data as unknown as ContractData;
    if (d.type === 'crew') return state.survivors.filter(s => !s.child && !s.isOnMission && s.health > 50 && !s.assignedBuildingId).length >= d.crew;
    return Object.entries(d.give).every(([r, v]) => {
      const res = state.resources[r as ResourceType];
      return !!res && res.amount - (v ?? 0) >= (isFinite(res.cap) ? res.cap : 0) * TUNING.contractSafeShare;
    });
  }

  /** Takes every safe contract in the inbox; returns how many. */
  acceptSafe(): number {
    let n = 0;
    for (const item of this.open(this.sm.state)) {
      if (this.isSafe(this.sm.state, item) && this.inbox.resolve(item.id, 'accept')) n++;
    }
    return n;
  }

  /** Contracts start with the second Act (the first is learned without them). */
  active(state: GameState): boolean {
    return lateActTwoSystems(state); // [Q7] from day ~4, not the moment Act II begins
  }

  open(state: GameState): InboxItem[] {
    return (state.longGame?.inbox.items ?? []).filter(i => i.kind === 'contract');
  }

  /** Adults who could go out on a job now (idle first). */
  freeHands(state: GameState): string[] {
    const ok = state.survivors.filter(s => !s.child && !s.isOnMission && s.health > 50 && !(s.assignedBuildingId ?? '').startsWith('p_'));
    return [...ok.filter(s => !s.assignedBuildingId), ...ok.filter(s => s.assignedBuildingId)].map(s => s.id);
  }

  private jobs(): Job[] {
    return ((this.sm.state.longGame?.world.contracts ?? []) as Job[]);
  }

  private apply(item: InboxItem, key: string): void {
    if (key !== 'accept') return;
    const d = item.data as unknown as ContractData;
    const lg = this.sm.state.longGame;
    if (!lg) return;
    if (d.type === 'supply') {
      this.pay(d.reward, d.issuer);
      return;
    }
    const crew = this.freeHands(this.sm.state).slice(0, d.crew);
    if (crew.length < d.crew) return;
    for (const id of crew) this.population.assignSurvivorToBuilding(this.sm, id, null);
    const set = new Set(crew);
    this.sm.applyDelta({ path: 'survivors', value: this.sm.state.survivors.map(s => (set.has(s.id) ? { ...s, assignedBuildingId: CONTRACT_CREW } : s)) });
    const job: Job = { id: item.id, crew, until: lg.meta.worldT + d.hours * 3600, reward: d.reward, issuer: d.issuer };
    this.sm.applyDelta({ path: 'longGame.world.contracts', value: [...this.jobs(), job] });
  }

  private pay(reward: Partial<Record<ResourceType, number>>, issuer: string): void {
    this.resources.gain(this.sm, reward);
    // A contract is a deal: the partner's relation grows (the drifters have none).
    if (issuer !== 'drifters') {
      const trade = this.sm.state.lateGame.trade;
      const deals = { ...(trade.deals ?? {}) };
      deals[issuer] = (deals[issuer] ?? 0) + 1;
      this.sm.applyDelta({ path: 'lateGame.trade', value: { ...trade, deals } });
    }
    const done = (this.sm.state.stats as unknown as { contractsDone?: number }).contractsDone ?? 0;
    this.sm.applyDelta({ path: 'stats.contractsDone', value: done + 1 });
    bus.emit('contract:done', issuer, reward);
  }

  /** A deterministic 0..1 roll for the n-th contract (same answer online and away). */
  private roll(n: number, salt: number): number {
    let x = (this.sm.state.randomSeed ^ (n * 2654435761) ^ (salt * 40503)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 2246822507) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 3266489909) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  private makeOffer(n: number): ContractData {
    const state = this.sm.state;
    const act = state.longGame?.meta.act ?? 2;
    const issuers = ['drifters', ...openPartners(state).map(p => p.id)];
    const issuer = issuers[Math.floor(this.roll(n, 1) * issuers.length)];
    const type: ContractType = this.roll(n, 2) < 0.6 ? 'supply' : 'crew';
    const hours = type === 'crew' ? TUNING.contractRewardHours * 1.6 : TUNING.contractRewardHours;
    // [P5] The Cartographer keystone: contracts pay a quarter more.
    const k = hasKeystone(state, 'ksCartographer') ? 1.25 : 1;
    // Paid in the same mix prices ask for, so a contract helps with every currency the Act needs.
    const reward = actBundle(act, hours * k);
    const give: Partial<Record<ResourceType, number>> = {};
    if (type === 'supply') {
      // The bunker's own production of a scarce good is the yardstick; goods it does not make yet are never asked for.
      const open = ASKS.filter(r => (state.resources[r]?.productionRate ?? 0) > 0.001 && (state.resources[r]?.cap ?? 0) > 0);
      const pool = open.length > 0 ? open : FALLBACK_ASK;
      const ask = pool[Math.floor(this.roll(n, 3) * pool.length)];
      const res = state.resources[ask];
      const cap = res?.cap ?? 0;
      const perHour = (res?.productionRate ?? 0) * 3600;
      const want = (perHour > 0 ? perHour : (isFinite(cap) ? cap : 100) * 0.3) * TUNING.contractAskHours * (0.8 + 0.4 * this.roll(n, 7));
      give[ask] = Math.max(10, Math.round(Math.min(want, (isFinite(cap) ? cap : want) * 0.5)));
    }
    return { issuer, type, give, crew: type === 'crew' ? 2 + Math.floor(this.roll(n, 4) * 2) : 0, hours: type === 'crew' ? 1 + Math.floor(this.roll(n, 5) * 2) : 0, reward };
  }

  update(): void {
    const state = this.sm.state;
    const lg = state.longGame;
    if (!lg) return;
    const now = lg.meta.worldT;
    // Crews back from their jobs: paid and home.
    const jobs = this.jobs();
    const back = jobs.filter(j => now >= j.until);
    if (back.length) {
      this.sm.applyDelta({ path: 'longGame.world.contracts', value: jobs.filter(j => now < j.until) });
      for (const j of back) {
        const set = new Set(j.crew);
        this.sm.applyDelta({ path: 'survivors', value: this.sm.state.survivors.map(s => (set.has(s.id) && s.assignedBuildingId === CONTRACT_CREW ? { ...s, assignedBuildingId: null } : s)) });
        this.pay(j.reward, j.issuer);
      }
    }
    if (!this.active(state)) return;
    const next = (lg.world as unknown as { nextContractAt?: number }).nextContractAt ?? 0;
    if (next === 0) {
      this.sm.applyDelta({ path: 'longGame.world.nextContractAt', value: now + TUNING.contractEvery });
      return;
    }
    if (now < next) return;
    const n = lg.world.seq + 1;
    this.sm.applyDeltas([
      { path: 'longGame.world.seq', value: n },
      { path: 'longGame.world.nextContractAt', value: now + TUNING.contractEvery * (0.7 + this.roll(n, 6) * 0.6) },
    ]);
    if (this.open(this.sm.state).length >= TUNING.contractMaxOpen) return;
    const data = this.makeOffer(n);
    this.inbox.post('contract', { data: data as unknown as Record<string, unknown>, deadlineIn: TUNING.contractDeadline, fallback: 'decline' });
  }
}
