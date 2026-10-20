import type { StateManager } from '../core/StateManager';
import { bus } from '../core/EventBus';
import { ACTS, BEAT_AT, MAX_ACT, actComplete, actOf, actProgress, beatAt, firstLaw, inAct, signatureDue, signatureEta, signatureProgress, systemOpen, systemOpensIn, type ActDef } from '../data/acts';
import type { GameState } from '../core/GameState';
import type { Requirement } from './Guide';
import { bunkerDefense, raidStrength } from './EventSystem'; // [phase5] the siege
import { ENDINGS, endingOf, endingScore } from '../data/endings';
import type { BuildingSystem } from './BuildingSystem';
import { registerInboxKind, type InboxSystem } from './InboxSystem';
import { i18n } from '../i18n/I18nManager';
import { lawUpkeep, policyExtras } from '../data/laws'; // [phase4]

/** [phase4] Upkeep is charged in steps of at least this many world seconds. */
const UPKEEP_STEP = 60;

/**
 * [phase4] Notes that a law left the books (repealed by the player or lapsed), so it waits its cooldown (laws.ts lawCooldown).
 * GameEngine.repealLaw should call this too (see the phase 4 report); the Command panel calls it after a repeal.
 */
export function noteRepeal(sm: StateManager, id: string): void {
  const lg = sm.state.longGame;
  if (!lg) return;
  sm.applyDelta({ path: 'longGame.policy.repealedAt', value: { ...(policyExtras(sm.state).repealedAt ?? {}), [id]: lg.meta.worldT } });
}

// ---- [phase5] The Acts' signature problems (data/acts.ts SignatureDef) ----

/** [phase5] The siege's three waves, as shares of a usual raid's strength at this point of the run. */
export const SIEGE_WAVES = [0.8, 1.05, 1.35];

/** [phase5] What the ridge chapter's preparation adds to the defense in the siege (fortified door, drilled crews, allies on the flanks). */
export function siegePrep(s: GameState): number {
  const f = s.storyFlags;
  return 1 + (f.includes('siege:fortified') ? 0.25 : 0) + (f.includes('siege:drilled') ? 0.15 : 0) + (f.includes('siege:allies') ? 0.2 : 0);
}

/** [phase5] The siege as the lookouts see it now: the bunker's defense (with its preparation) against each wave. */
export function siegeForecast(s: GameState): { defense: number; waves: number[] } {
  const base = raidStrength(s, 0.5);
  return { defense: Math.round(bunkerDefense(s) * siegePrep(s)), waves: SIEGE_WAVES.map(k => Math.round(base * k)) };
}

type Loc = 'he' | 'en';
const L = (he: string, en: string): Record<Loc, string> => ({ he, en });

/** [phase5] What to do about the Act's signature now, in plain words (the goal line's second line). */
export function signatureHint(s: GameState, act: ActDef): Record<Loc, string> {
  const sig = act.signature;
  if (!sig) return L('', '');
  const f = s.storyFlags;
  if (f.includes(`story:${sig.chapter}`)) return L('', '');
  const fmt = (t: number) => i18n.formatDuration(Math.max(60, t));
  const beatTold = !sig.beat || f.includes(`story:${sig.beat}`);
  if (!beatTold) {
    const p = actProgress(s, act);
    if (p >= BEAT_AT) return L('בקרוב: ברגע השקט הבא', 'Soon: at the next quiet moment');
    const pct = Math.floor(Math.min(0.99, p) * 100);
    return L(`יתחיל כשהמערכה תגיע בערך לחצי הדרך (עכשיו ${pct}%)`, `Begins when the Act is about half done (now ${pct}%)`);
  }
  const eta = signatureEta(s, act.id) ?? 0;
  switch (sig.id) {
    case 'toll':
      return s.survivors.length < 6 ? L('זרים יגיעו כשיגורו כאן 6 אנשים', 'Strangers will come once 6 people live here') : L('חכו לדפיקה בדלת', 'Wait for the knock on the door');
    case 'winter':
      return eta > 0 ? L(`השלג יגיע בעוד ${fmt(eta)}. אגרו אוכל ופנו מיטות.`, `The snow comes in ${fmt(eta)}. Store food and free some beds.`) : L('השלג כבר כאן. השבט מחכה בדלת.', 'The snow is here. The Clan is waiting at the door.');
    case 'firstLaw': {
      if (firstLaw(s)) return L('המושבה מתאספת לכתוב את החוק על הקיר', 'The colony gathers to write the law on the wall');
      if (!systemOpen(s, 'laws')) {
        const t = systemOpensIn(s, 'laws');
        return isFinite(t) ? L(`החוקים ייפתחו בעוד ${fmt(t)}`, `Laws open in ${fmt(t)}`) : L('החוקים עוד סגורים', 'Laws are not open yet');
      }
      return L('העבירו חוק: מרכז הפיקוד, לשונית מדיניות', 'Pass a law: Command, Policies tab');
    }
    case 'siege': {
      if (f.includes('siege:done')) return L('המצור נגמר. ספרו מה נשאר.', 'The siege is over. Count what is left.');
      const fc = siegeForecast(s);
      const w = fc.waves.join(' / ');
      return L(`הצבא יגיע לחומה בעוד ${fmt(eta)} · ההגנה שלכם ${fc.defense}, הגלים ${w}. שומרים בנשקייה ושלבי החומה מעלים אותה.`,
        `The army reaches the Wall in ${fmt(eta)} · your defense ${fc.defense}, the waves ${w}. Guards in the Armory and the Wall's stages raise it.`);
    }
    case 'north':
      return eta > 0 ? L(`המשלחת יוצאת בעוד ${fmt(eta)}. כל מאחז שאתם מחזיקים הופך את הדרך לבטוחה יותר.`, `The expedition leaves in ${fmt(eta)}. Every outpost you hold makes the road safer.`) : L('המשלחת מוכנה לצאת', 'The expedition is ready to leave');
    case 'vote':
      return eta > 0 ? L(`ההצבעה בעוד ${fmt(eta)}. ההשפעה שבידיכם קונה קולות.`, `The vote is in ${fmt(eta)}. The influence you hold buys voices.`) : L('הקלפיות פתוחות', 'The ballot boxes are open');
    case 'ark':
      return f.includes('project:ark') ? L('התיבה מוכנה. בחרו מה נכנס בה.', 'The Ark is ready. Choose what goes in.') : L('השלימו את התיבה (פרויקט המערכה), ואז בחרו מה נכנס בה', 'Finish the Ark (Act project), then choose what goes in');
  }
  return L('', '');
}

/**
 * [phase5] The signature as a requirement row (the same shape Guide.actRequirements gives the Act's goals), for the Command panel and the
 * guide. Null when the Act has no signature.
 */
export function signatureRequirement(s: GameState, act: ActDef = actOf(s)): Requirement | null {
  const sig = act.signature;
  if (!sig) return null;
  const locale = i18n.currentLocale as Loc;
  const progress = signatureProgress(s, sig);
  const done = progress[0] >= progress[1];
  const hint = signatureHint(s, act)[locale];
  const beat = !sig.beat || s.storyFlags.includes(`story:${sig.beat}`);
  const eta = done ? 0 : beat ? signatureEta(s, act.id) ?? Infinity : Infinity;
  const action = sig.id === 'siege' ? { kind: 'rooms' as const, type: 'armory' as const } : sig.id === 'north' ? { kind: 'surface' as const } : sig.id === 'ark' ? { kind: 'projects' as const } : { kind: 'command' as const };
  // Waiting for its moment, it is never "the step" (Guide.pickRequirement skips locked rows): only passing Act III's law is a thing to do.
  const actionable = sig.id === 'firstLaw' && beat && !firstLaw(s) && systemOpen(s, 'laws');
  return {
    id: 'signature', icon: sig.icon, title: sig.text[locale], text: done ? sig.text[locale] : hint || sig.text[locale], progress,
    fraction: done ? 1 : beat ? 0.5 : 0, done, immediate: false, eta, action: done ? null : action, locked: !done && !actionable,
  };
}

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
    const ranked = ENDINGS.map(e => ({ id: e.id, s: endingScore(this.sm.state, e) })).sort((a, b) => b.s - a.s);
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
    this.chargeUpkeep(); // [phase4]
    const act = actOf(state);
    this.signatureTick(act); // [phase5]
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

  /** [phase5] Adds run flags (story flags reset with Genesis, so these belong to this run). */
  private flag(...add: string[]): void {
    const flags = this.sm.state.storyFlags;
    const fresh = add.filter(f => !flags.includes(f));
    if (fresh.length) this.sm.applyDelta({ path: 'storyFlags', value: [...flags, ...fresh] });
  }

  /**
   * [phase5] The signature's clockwork, online and away: when the mid-Act beat was told (the warning's clock starts), the first law the
   * colony passed (Act III), and the siege itself (Act IV), resolved by the numbers when its day comes.
   */
  private signatureTick(act: ActDef): void {
    const state = this.sm.state;
    const lg = state.longGame;
    const sig = act.signature;
    if (!lg || lg.meta.legacy || !sig) return;
    if (sig.beat && state.storyFlags.includes(`story:${sig.beat}`) && beatAt(state, act.id) === null) this.flag(`sig:beat${act.id}:${Math.round(lg.meta.worldT)}`);
    if (!firstLaw(state) && lg.policy.laws.length > 0) this.flag(`law:first:${lg.policy.laws[0]}`);
    if (sig.id === 'siege' && inAct(state, 4) && !state.storyFlags.includes('siege:done') && signatureDue(state, 4)) this.resolveSiege();
  }

  /**
   * [phase5] Act IV's siege: three waves against the bunker's defense (its walls, guards and people, the Wall's stages, the ridge chapter's
   * preparation). Every wave held counts; the chapter "The Siege" then tells it and settles the cost. Never a dead end: a broken siege is
   * a worse chapter, not a stuck Act.
   */
  resolveSiege(): { held: number; outcome: 'held' | 'bent' | 'broke'; defense: number; waves: number[] } {
    const fc = siegeForecast(this.sm.state);
    const held = fc.waves.filter(w => fc.defense >= w).length;
    const outcome = held >= fc.waves.length ? 'held' : held > 0 ? 'bent' : 'broke';
    this.flag('siege:done', `siege:${outcome}`, `siege:waves:${held}`);
    const res = { held, outcome, defense: fc.defense, waves: fc.waves } as const;
    bus.emit('siege:resolved', res);
    return { ...res, waves: [...res.waves] };
  }

  /**
   * [phase4] Laws cost upkeep per hour of world time (online and away). What can't be paid lapses the newest law (it then waits its
   * cooldown) and tells the app ('law:lapsed', id).
   */
  private chargeUpkeep(): void {
    const sm = this.sm;
    const lg = sm.state.longGame;
    if (!lg) return;
    const now = lg.meta.worldT;
    const since = policyExtras(sm.state).upkeepAt;
    if (since === undefined || since > now || lg.policy.laws.length === 0) {
      if (since !== now) sm.applyDelta({ path: 'longGame.policy.upkeepAt', value: now });
      return;
    }
    const dt = now - since;
    if (dt < UPKEEP_STEP) return;
    sm.applyDelta({ path: 'longGame.policy.upkeepAt', value: now });
    let short = false;
    for (const [r, perHour] of Object.entries(lawUpkeep(sm.state))) {
      const res = sm.state.resources[r as keyof typeof sm.state.resources];
      if (!res || !perHour) continue;
      const due = perHour * lg.policy.laws.length * dt / 3600;
      if (res.amount < due) short = true;
      sm.applyDelta({ path: `resources.${r}.amount`, value: Math.max(0, res.amount - due) });
    }
    if (!short) return;
    const lapsed = lg.policy.laws[lg.policy.laws.length - 1];
    sm.applyDelta({ path: 'longGame.policy.laws', value: lg.policy.laws.slice(0, -1) });
    noteRepeal(sm, lapsed);
    bus.emit('law:lapsed', lapsed);
  }

  /** Release 1: Genesis needs the last Act's goals and charter done. */
  finalActComplete(): boolean {
    const state = this.sm.state;
    const act = actOf(state);
    return act.id >= MAX_ACT && actComplete(state, act);
  }
}
