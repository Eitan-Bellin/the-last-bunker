import { LAWS, lawCost, lawSlots } from '../../data/laws';
import { ENDINGS, endingScore, type EndingDef } from '../../data/endings';
import type { GameEngine } from '../../core/GameEngine';
import type { GameState, ResourceType } from '../../core/GameState';
import { i18n } from '../../i18n/I18nManager';
import { ERAS, eraOf, type EraDef } from '../../data/eras';
import { Sheet } from './Sheet';
import { RESOURCE_ICONS, bar, button, costRow, el, setBar, setRich } from '../dom';
import { ACTS, actOf, type ActDef } from '../../data/acts';
import { FOREMAN_ACT, FOREMAN_ORDERS, type ForemanSystem } from '../../systems/ForemanSystem';
import { actEta, actFraction, actRequirements, nowStep, type Requirement } from '../../systems/Guide';
import type { ObjectiveAction } from '../../systems/ObjectiveSystem';
import { resourceDef } from '../../data/resources';
import { getScenario, homeShare, type HomeSite } from '../../data/scenarios';
import { wingSummary } from '../../data/wings';
import { fillSafetyCard } from './SafetyCard'; // plan4:ST-14/15

/** Sets a line of text that may hold icon tokens ([[food]]), only when it changed (the panel refreshes four times a second). */
function setLine(node: HTMLElement | null, text: string): void {
  if (!node || node.dataset.t === text) return;
  node.dataset.t = text;
  setRich(node, text);
}

/** How far ahead the forecast looks, in seconds. */
const FORECAST_SECONDS = 6 * 3600;

/** One requirement row of the Act card: a bar and the next step toward it. */
interface ReqRow {
  id: string;
  row: HTMLElement;
  bar: HTMLElement;
  label: HTMLElement;
  hint: HTMLElement;
  /** [ux-wp1 C1] The era goal's own steps, one line each. */
  subs: HTMLElement;
  /** What a tap does now (changes as the requirement's next step changes). */
  action: ObjectiveAction;
}

/**
 * The Command panel (it used to be the "Eras" panel): where the run stands and what blocks it.
 * [Q2/Q3] The first card says what to do next and why, every requirement of the Act has its own next step and a tap
 * that takes you there, a six-hour forecast shows what will run out or overflow, and the ending's lean is visible.
 * The era's own goals only show for bunkers from before the long game (there they still drive the story).
 */
export class EraPanel {
  private sheet = new Sheet('era-sheet', 'command');
  private signature = '';
  private bars: HTMLElement[] = [];
  private labels: HTMLElement[] = [];
  /** [LateGame B1] Opens the big projects panel. */
  onOpenProjects: (() => void) | null = null;
  /** [Q2] Where a tap on a step goes (the app opens the right panel). */
  onGo: ((action: ObjectiveAction) => void) | null = null;
  /** [Long game] The Act's requirement rows (its own goals, then its charter projects). */
  private reqRows: ReqRow[] = [];
  /** [Long game] Set by the app: the Foreman whose standing orders are toggled here. */
  foreman: ForemanSystem | null = null;
  /** Set by the app: the engine, for the guide and the forecast. */
  engine: GameEngine | null = null;
  private lastState: GameState | null = null;
  /** [Long game UX] The Foreman's live lines: next-round countdown, then one report per order. */
  private foremanNext: HTMLElement | null = null;
  private foremanReports: HTMLElement[] = [];
  private nowText: HTMLElement | null = null;
  private nowMeta: HTMLElement | null = null;
  private nowGo: HTMLButtonElement | null = null;
  private nowAction: ObjectiveAction = null;
  /** [ux-wp1 M2] "This Act ends in ~X at today's rates". */
  private nowEta: HTMLElement | null = null;
  private forecastBox: HTMLElement | null = null;
  private endingBars: { id: string; bar: HTMLElement; label: HTMLElement }[] = [];
  private pctLabel: HTMLElement | null = null;
  /** [plan4:ST-5] The wing width line (west/east reach and the running wing dig's time left). */
  private wingLine: HTMLElement | null = null;
  /** [plan4:ST-14/15] The Safety card's box (fire code, shut doors, emergency door button). */
  private safetyBox: HTMLElement | null = null;

  show(state: GameState): void {
    this.signature = '';
    this.refresh(state);
    this.sheet.show();
  }

  hide(): void {
    this.sheet.hide();
  }

  /** [plan4:ST-9] Scrolls the wing line into view and lets it glow for a moment (the "what's new" card's "Show me"). */
  revealWings(): void {
    const line = this.wingLine;
    if (!line) return;
    requestAnimationFrame(() => {
      line.scrollIntoView({ block: 'center', behavior: 'auto' });
      line.classList.add('wing-hl');
      setTimeout(() => line.classList.remove('wing-hl'), 3200);
    });
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  private longGame(state: GameState): boolean {
    return !!state.longGame && !state.longGame.meta.legacy;
  }

  refresh(state: GameState): void {
    const era = eraOf(state);
    const act = state.longGame ? actOf(state) : null;
    this.lastState = state;
    const orders = FOREMAN_ORDERS.map(o => (state.longGame?.foreman.orders[o] ? 1 : 0)).join('') + (state.longGame?.policy.laws ?? []).join(',');
    const sig = `${era.id}|${act?.id ?? 0}|${orders}|${state.tutorialStep}|${i18n.currentLocale}`;
    if (sig !== this.signature) {
      this.signature = sig;
      this.render(era, act);
    }
    if (act && this.engine) this.refreshAct(state, act);
    this.refreshForeman(state);
    era.next.forEach((g, i) => {
      const [c, t] = g.progress(state);
      setBar(this.bars[i], (Math.min(c, t) / t) * 100);
      if (this.labels[i]) this.labels[i].textContent = t > 1 ? `${Math.min(c, t)}/${t}` : c >= t ? '✓' : '';
    });
  }

  /** The live parts of the Act cards: the "next step" line, every requirement's bar and hint, the forecast, the ending's lean. */
  private refreshAct(state: GameState, act: ActDef): void {
    const engine = this.engine!;
    const reqs = actRequirements(engine, state, act);
    reqs.forEach((r, i) => {
      const row = this.reqRows[i];
      if (!row) return;
      setBar(row.bar, r.fraction * 100);
      // [ux-wp1 P15] "0/6 · 2 in progress": work already running counts where the player can see it.
      const count = r.progress[1] > 1 ? `${r.progress[0]}/${r.progress[1]}` : '';
      row.label.textContent = r.done ? '✓' : (r.pending ?? 0) > 0 ? `${count}${count ? ' · ' : ''}${i18n.t('wp1.inProgress', { n: r.pending ?? 0 })}` : count;
      setLine(row.hint, r.done ? '' : r.text);
      this.refreshSubs(row.subs, r.done ? undefined : r.subs);
      row.row.classList.toggle('done', r.done);
      row.action = r.action;
    });
    // [ux-wp1 A1] The same step as the bottom card and the check-in: the tutorial's while it lasts, then the Act's.
    const pick = nowStep(engine, state);
    if (this.nowText) {
      if (pick) {
        setLine(this.nowText, `${pick.icon} ${pick.text}`);
        this.nowAction = pick.action;
        setLine(this.nowMeta, pick.tutorial ? i18n.t('wp1.tutorialThen', { act: act.name[i18n.currentLocale] }) : pick.title);
      } else {
        setLine(this.nowText, i18n.t(act.id >= ACTS.length ? 'guide.genesis' : 'command.actDone'));
        this.nowAction = act.id >= ACTS.length ? { kind: 'genesis' } : null;
        setLine(this.nowMeta, '');
      }
      if (this.nowGo) this.nowGo.style.display = this.nowAction ? '' : 'none';
    }
    if (this.nowEta) {
      // [ux-wp1 M2] When the Act should end at today's rates (a lower bound when some step can't be timed).
      const e = actEta(reqs);
      const what = e.slowest ? e.slowest.title : '';
      const text = e.seconds >= 60 && e.slowest
        ? i18n.t(e.known ? 'wp1.actEta' : 'wp1.actEtaMin', { t: i18n.formatDuration(e.seconds), what })
        : '';
      setLine(this.nowEta, text ? `[[clock]] ${text}` : '');
      this.nowEta.style.display = text ? '' : 'none';
    }
    if (this.pctLabel) this.pctLabel.textContent = `${Math.floor(Math.min(0.99, actFraction(engine, state, act)) * 100)}%`;
    this.refreshWings(state);
    fillSafetyCard(this.safetyBox, engine, state); // plan4:ST-14/15
    this.refreshForecast(state);
    this.refreshEndings(state);
  }

  /** [plan4:ST-5] "Wing width: west X/Y, east X/Y" (X = widest floor now, Y = what the Act and depth allow) and the next wing's ETA. */
  private refreshWings(state: GameState): void {
    if (!this.wingLine || !this.engine) return;
    const w = wingSummary(state, 'w'), e = wingSummary(state, 'e');
    if (w.max <= 0 && e.max <= 12 && w.have <= 0 && e.have <= 12) { setLine(this.wingLine, `[[build]] ${i18n.t('wing.line.closed')}`); return; }
    const ds = this.engine.digSystem;
    const etas = ds.slots(state).filter(i => ds.dig(state, i)?.kind === 'wing').map(i => ds.eta(state, i)).filter(t => isFinite(t));
    const next = etas.length ? ` · ${i18n.t('wing.line.eta', { t: i18n.formatDuration(Math.min(...etas)) })}` : '';
    setLine(this.wingLine, `[[build]] ${i18n.t('wing.line', { wh: w.have, wm: w.max, eh: e.have, em: e.max })}${next}`);
  }

  /** [N1] The first card: the one thing to do now, what it is for, and a button that takes you there. */
  private renderNow(): HTMLElement {
    const card = el('div', 'bp-card now-card');
    card.appendChild(el('div', 'bp-section-title', `[[target]] ${i18n.t('command.now')}`));
    this.nowText = el('div', 'now-text');
    this.nowMeta = el('div', 'bp-hint now-meta');
    this.nowGo = button(i18n.t('command.go'), 'btn-primary btn-small now-go', () => this.onGo?.(this.nowAction));
    this.nowEta = el('div', 'bp-hint now-eta');
    card.append(this.nowText, this.nowMeta, this.nowEta, this.nowGo);
    return card;
  }

  /** [ux-wp1 C1] The era's steps under its Act goal: "✓ Restore the generator", "• Clear 6 areas 4/6". */
  private refreshSubs(box: HTMLElement, subs: Requirement['subs']): void {
    const lines = (subs ?? []).map(s => `${s.done ? '✓' : '•'} ${s.text}${!s.done && s.count ? ` ${s.count}` : ''}`);
    const sig = lines.join('|');
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.replaceChildren(...lines.map((l, i) => el('div', `req-sub${subs![i].done ? ' done' : ''}`, l)));
    box.style.display = lines.length ? '' : 'none';
  }

  /** [Long game] The Act card: its name, what it allows, and every requirement with its own next step. */
  private renderAct(act: ActDef): HTMLElement {
    const locale = i18n.currentLocale;
    const card = el('div', 'bp-card act-card');
    this.pctLabel = el('span', 'act-pct');
    const head = el('div', 'act-head');
    head.append(el('div', 'act-name', act.name[locale]), this.pctLabel);
    card.append(
      head,
      el('div', 'era-tagline', act.tagline[locale]),
      el('div', 'act-limits', i18n.t('act.limits', { level: act.levelCap, people: act.popCap, floors: act.floorCap })),
    );
    if (act.opens) card.appendChild(el('div', 'bp-hint', act.opens[locale]));
    // [plan4:ST-5] How wide the bunker may grow, and how wide it is.
    this.wingLine = el('div', 'act-limits');
    card.appendChild(this.wingLine);
    // [P2] How tempting the bunker looks out there.
    if (this.lastState?.longGame) {
      const t = this.lastState.longGame.threat;
      const calm = t.breatherUntil > this.lastState.longGame.meta.worldT;
      card.appendChild(el('div', 'act-limits', `[[skull]] ${i18n.t('threat.meter', { n: Math.round(t.meter) })}${calm ? ` · ${i18n.t('threat.breather', { t: i18n.formatDuration(t.breatherUntil - this.lastState.longGame.meta.worldT) })}` : ''}`));
    }
    const last = act.id >= ACTS.length;
    card.appendChild(el('div', 'bp-section-title', last ? i18n.t('act.goalsGenesis') : i18n.t('act.goalsNext', { name: ACTS[act.id].name[locale] })));
    this.reqRows = [];
    const reqs: Requirement[] = this.engine && this.lastState ? actRequirements(this.engine, this.lastState, act) : [];
    for (const r of reqs) {
      const row = el('button', 'req-row');
      const top = el('div', 'era-goal');
      const label = el('span', 'era-goal-count');
      top.append(el('span', 'era-goal-text', `${r.icon} ${r.title}`), label);
      const b = bar(0, 'accent');
      const hint = el('div', 'bp-hint req-hint');
      const subs = el('div', 'bp-hint req-subs');
      subs.style.display = 'none';
      row.append(top, b, hint, subs);
      const entry: ReqRow = { id: r.id, row, bar: b, label, hint, subs, action: r.action };
      row.addEventListener('click', () => { if (entry.action) this.onGo?.(entry.action); });
      card.appendChild(row);
      this.reqRows.push(entry);
    }
    const steps = el('div', 'era-timeline');
    for (const a of ACTS) {
      const step = el('div', `era-step ${a.id < act.id ? 'past' : a.id === act.id ? 'current' : 'future'}`);
      step.append(el('span', 'era-dot'), el('span', 'era-step-name', a.name[locale]));
      steps.appendChild(step);
    }
    card.appendChild(steps);
    return card;
  }

  /** [N1] Six hours ahead at today's rates: what runs dry, what overflows (and is wasted), what grows. */
  private renderForecast(): HTMLElement {
    const card = el('div', 'bp-card forecast-card');
    card.appendChild(el('div', 'bp-section-title', `[[clock]] ${i18n.t('command.forecast')}`));
    this.forecastBox = el('div', 'forecast');
    card.append(this.forecastBox, el('div', 'bp-hint', i18n.t('command.forecastHint')));
    return card;
  }

  private refreshForecast(state: GameState): void {
    const box = this.forecastBox;
    if (!box || !box.isConnected) return;
    const act = state.longGame?.meta.act ?? 1;
    const rows: HTMLElement[] = [];
    const resources = (Object.keys(state.resources) as ResourceType[]).filter(r => {
      const def = resourceDef(r);
      if (!def || r === 'power' || r === 'isotope7' || r === 'credits' || r === 'blueprints' || r === 'vaultCoins') return false;
      const opens = def.act ?? 0;
      return opens === 0 || (act >= opens && opens >= act - 1);
    });
    for (const r of resources) {
      const res = state.resources[r];
      const net = res.productionRate - res.consumptionRate;
      const cap = res.cap;
      const finite = isFinite(cap) && cap > 0;
      let text = i18n.t('command.steady');
      let kind = '';
      if (net < -0.0005 && res.amount > 0) {
        const t = res.amount / -net;
        if (t < FORECAST_SECONDS) { text = i18n.t('command.empty', { t: i18n.formatDuration(t) }); kind = 'bad'; }
        else text = `${i18n.formatCompact(Math.max(0, res.amount + net * FORECAST_SECONDS))}`;
      } else if (net > 0.0005 && finite) {
        const t = (cap - res.amount) / net;
        if (t <= 0) { text = i18n.t('command.full'); kind = 'warn'; }
        else if (t < FORECAST_SECONDS) { text = i18n.t('command.fullIn', { t: i18n.formatDuration(t) }); kind = 'warn'; }
        else text = `${i18n.formatCompact(Math.min(cap, res.amount + net * FORECAST_SECONDS))}`;
      } else if (res.amount <= 0 && net < 0) { text = i18n.t('command.empty', { t: '0' }); kind = 'bad'; }
      const row = el('div', `forecast-row ${kind}`);
      row.append(el('span', 'forecast-res', `${RESOURCE_ICONS[r] ?? ''} ${i18n.t(`resources.${r}`)}`), el('span', 'forecast-now', i18n.formatCompact(res.amount)), el('span', 'forecast-then', text));
      rows.push(row);
    }
    const sig = rows.map(r => r.textContent).join('|');
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.replaceChildren(...rows);
  }

  /** [P3-5] The bunkers of earlier timelines and what they send home. */
  private renderHomes(homes: HomeSite[]): HTMLElement {
    const locale = i18n.currentLocale;
    const card = el('div', 'bp-card homes-card');
    card.appendChild(el('div', 'bp-section-title', `[[vault]] ${i18n.t('home.title')}`));
    card.appendChild(el('div', 'bp-hint', i18n.t('home.hint')));
    for (const h of homes) {
      const name = getScenario(h.scenario).name[locale];
      card.appendChild(el('div', 'home-row', i18n.t('home.line', { name, act: ACTS[Math.min(ACTS.length, h.act) - 1]?.name[locale] ?? String(h.act), pct: Math.round(homeShare(h) * 100) })));
    }
    return card;
  }

  /** [Q8] Where the ending leans: each ending's score and what raises it. */
  private renderEndings(): HTMLElement {
    const locale = i18n.currentLocale;
    const card = el('div', 'bp-card endings-card');
    card.appendChild(el('div', 'bp-section-title', `[[flag]] ${i18n.t('command.endings')}`));
    card.appendChild(el('div', 'bp-hint', i18n.t('command.endingsHint')));
    this.endingBars = [];
    for (const e of ENDINGS) {
      const row = el('div', 'ending-row');
      const top = el('div', 'era-goal');
      const label = el('span', 'era-goal-count');
      top.append(el('span', 'era-goal-text', `${e.icon} ${e.name[locale]}`), label);
      const b = bar(0, 'accent');
      row.append(top, b, el('div', 'bp-hint', e.drivers[locale]));
      card.appendChild(row);
      this.endingBars.push({ id: e.id, bar: b, label });
    }
    return card;
  }

  private refreshEndings(state: GameState): void {
    if (this.endingBars.length === 0) return;
    const scores = ENDINGS.map(e => ({ e, s: endingScore(state, e) }));
    const max = Math.max(1, ...scores.map(x => x.s));
    const lead = scores.reduce((a, b) => (b.s > a.s ? b : a)).e.id;
    for (const { e, s } of scores) {
      const row = this.endingBars.find(x => x.id === e.id);
      if (!row) continue;
      setBar(row.bar, (s / max) * 100);
      row.label.textContent = e.id === lead ? `★ ${s.toFixed(1)}` : s.toFixed(1);
    }
  }

  /** [P3] Laws: a few slots, each law a clear trade. */
  private renderLaws(state: GameState): HTMLElement {
    const locale = i18n.currentLocale;
    const box = el('div', 'foreman laws');
    const active = state.longGame?.policy.laws ?? [];
    const slots = lawSlots(state);
    box.appendChild(el('div', 'bp-section-title', `[[books]] ${i18n.t('laws.title', { n: active.length, slots })}`));
    box.appendChild(costRow(state, lawCost(state)));
    for (const l of LAWS) {
      const on = active.includes(l.id);
      const row = el('div', 'foreman-row');
      const text = el('span', 'foreman-text');
      text.append(el('div', '', `${l.icon} ${l.name[locale]}`), el('div', 'bp-hint', l.desc[locale]));
      const can = on || (active.length < slots && this.engine!.resourceSystem.canAfford(state, lawCost(state)));
      row.append(text, button(i18n.t(on ? 'laws.repeal' : 'laws.enact'), on ? 'btn-secondary btn-small' : 'btn-primary btn-small', () => {
        if (on) this.engine!.repealLaw(l.id); else this.engine!.enactLaw(l.id);
        this.signature = '';
        this.refresh(this.engine!.stateManager.state);
      }, !can));
      box.appendChild(row);
    }
    return box;
  }

  /** [Long game] The Foreman's standing orders: routine handed over, each a clear on/off switch with what it last did. */
  private renderForeman(state: GameState): HTMLElement {
    const box = el('div', 'foreman');
    box.appendChild(el('div', 'bp-section-title', `[[worker]] ${i18n.t('foreman.title')}`));
    box.appendChild(el('div', 'bp-hint', i18n.t('foreman.hint')));
    this.foremanReports = [];
    for (const o of FOREMAN_ORDERS) {
      const on = !!state.longGame?.foreman.orders[o];
      const row = el('div', `foreman-row ${on ? 'on' : 'off'}`);
      const text = el('span', 'foreman-text');
      const report = el('div', 'bp-hint foreman-report');
      text.append(el('div', '', i18n.t(`foreman.${o}`)), report);
      this.foremanReports.push(report);
      const sw = button(on ? `✓ ${i18n.t('settings.on')}` : i18n.t('settings.off'), `btn-small foreman-switch ${on ? 'btn-primary' : 'btn-secondary'}`, () => {
        this.foreman?.set(o, !on);
        this.signature = '';
        if (this.lastState) this.refresh(this.lastState);
      });
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', String(on));
      row.append(text, sw);
      box.appendChild(row);
    }
    this.foremanNext = el('div', 'bp-hint');
    box.appendChild(this.foremanNext);
    return box;
  }

  /** The live part of the Foreman box: what each order did on its last round and when the next one comes. */
  private refreshForeman(state: GameState): void {
    const f = this.foreman;
    if (!f || !this.foremanNext?.isConnected) return;
    const anyOn = FOREMAN_ORDERS.some(o => f.isOn(state, o));
    this.foremanNext.textContent = anyOn ? i18n.t('foreman.next', { t: i18n.formatDuration(Math.ceil(f.nextRoundIn())) }) : i18n.t('foreman.allOff');
    FOREMAN_ORDERS.forEach((o, i) => {
      const r = f.last[o];
      const line = this.foremanReports[i];
      if (!line) return;
      line.textContent = !f.isOn(state, o) ? '' : r ? i18n.t(`foreman.report.${r.key}`, { n: r.n ?? 0 }) : i18n.t('foreman.report.waiting');
    });
  }

  private render(era: EraDef, act: ActDef | null): void {
    const locale = i18n.currentLocale;
    this.sheet.setTitle(`[[flag]] ${i18n.t('era.title')}`);
    const root = el('div', 'era command');
    const state = this.lastState;
    const longGame = !!state && this.longGame(state);
    this.nowText = this.nowMeta = this.nowGo = null;
    this.nowEta = null;
    this.forecastBox = null;
    this.pctLabel = null;
    this.endingBars = [];
    if (act && this.engine && state) {
      root.appendChild(this.renderNow());
      this.safetyBox = el('div', 'safety-box'); root.appendChild(this.safetyBox); // plan4:ST-14/15
      root.appendChild(this.renderAct(act));
      root.appendChild(button(`[[build]] ${i18n.t('proj.open')}`, 'btn-primary', () => this.onOpenProjects?.())); // [LateGame B1]
      root.appendChild(this.renderForecast());
      if (act.id >= 2) root.appendChild(this.renderEndings());
      const homes = (state.longGame?.meta.homes ?? []) as HomeSite[];
      if (homes.length > 0) root.appendChild(this.renderHomes(homes));
      const extras = el('div', 'bp-card');
      if (act.id >= FOREMAN_ACT && this.foreman) extras.appendChild(this.renderForeman(state));
      if (lawSlots(state) > 0) extras.appendChild(this.renderLaws(state));
      if (extras.childElementCount > 0) root.appendChild(extras);
    }
    // The era is the bunker's look and mood; only a bunker from before the long game still plays toward its goals.
    const head = el('div', `era-head era-${era.key}${longGame ? ' compact' : ''}`);
    head.append(
      el('div', 'era-num', i18n.t('era.number', { n: era.id + 1 })),
      el('div', 'era-name', era.name[locale]),
      el('div', 'era-tagline', era.tagline[locale]),
    );
    root.appendChild(head);
    this.bars = [];
    this.labels = [];
    if (!longGame) {
      if (era.next.length) {
        const goals = el('div', 'bp-card');
        goals.appendChild(el('div', 'bp-section-title', i18n.t('era.nextGoals', { name: ERAS[era.id + 1].name[locale] })));
        for (const g of era.next) {
          const row = el('div', 'era-goal');
          const label = el('span', 'era-goal-count');
          row.append(el('span', 'era-goal-text', g.text[locale]), label);
          const b = bar(0, 'accent');
          goals.append(row, b);
          this.bars.push(b);
          this.labels.push(label);
        }
        root.appendChild(goals);
      } else {
        root.appendChild(el('div', 'bp-card bp-hint', i18n.t('era.final')));
      }
      const timeline = el('div', 'era-timeline');
      for (const e of ERAS) {
        const step = el('div', `era-step ${e.id < era.id ? 'past' : e.id === era.id ? 'current' : 'future'}`);
        step.append(el('span', 'era-dot'), el('span', 'era-step-name', e.name[locale]));
        timeline.appendChild(step);
      }
      root.appendChild(timeline);
    }
    this.sheet.body.replaceChildren(root);
  }
}

/** [Long game] Full-screen title card when a new Act begins: what it opens. */
export function showActBanner(act: ActDef, onDone: () => void): void {
  const locale = i18n.currentLocale;
  const overlay = el('div', 'era-banner act-banner');
  const inner = el('div', 'era-banner-inner');
  inner.append(
    el('div', 'era-banner-kicker', i18n.t('act.new')),
    el('div', 'era-banner-name', act.name[locale]),
    el('div', 'era-banner-tagline', act.tagline[locale]),
    el('p', 'era-banner-story', i18n.t('act.opens', { level: act.levelCap, people: act.popCap, floors: act.floorCap })),
  );
  if (act.opens) inner.appendChild(el('p', 'era-banner-story', act.opens[locale]));
  const btn = el('button', 'btn btn-primary', i18n.t('era.continue'));
  inner.appendChild(btn);
  overlay.appendChild(inner);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('in'));
  btn.addEventListener('click', () => {
    overlay.classList.remove('in');
    setTimeout(() => overlay.remove(), 600);
    onDone();
  });
}

/** [P5] The run's ending: its name and story, before Genesis. */
export function showEndingBanner(ending: EndingDef, onDone: () => void): void {
  const locale = i18n.currentLocale;
  const overlay = el('div', 'era-banner ending-banner');
  const inner = el('div', 'era-banner-inner');
  inner.append(
    el('div', 'era-banner-kicker', i18n.t('ending.kicker')),
    el('div', 'era-banner-name', `${ending.icon} ${ending.name[locale]}`),
    el('p', 'era-banner-story', ending.text[locale]),
    el('div', 'era-banner-tagline', i18n.t('ending.next')),
  );
  const btn = el('button', 'btn btn-primary', i18n.t('era.continue'));
  inner.appendChild(btn);
  overlay.appendChild(inner);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('in'));
  btn.addEventListener('click', () => {
    overlay.classList.remove('in');
    setTimeout(() => overlay.remove(), 600);
    onDone();
  });
}

/** Full-screen title card when a new era begins. */
export function showEraBanner(era: EraDef, onDone: () => void): void {
  const locale = i18n.currentLocale;
  const overlay = el('div', `era-banner era-${era.key}`);
  const inner = el('div', 'era-banner-inner');
  inner.append(
    el('div', 'era-banner-kicker', i18n.t('era.newEra')),
    el('div', 'era-banner-name', era.name[locale]),
    el('div', 'era-banner-tagline', era.tagline[locale]),
    el('p', 'era-banner-story', era.story[locale]),
  );
  const btn = el('button', 'btn btn-primary', i18n.t('era.continue'));
  inner.appendChild(btn);
  overlay.appendChild(inner);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('in'));
  btn.addEventListener('click', () => {
    overlay.classList.remove('in');
    setTimeout(() => overlay.remove(), 600);
    onDone();
  });
}
