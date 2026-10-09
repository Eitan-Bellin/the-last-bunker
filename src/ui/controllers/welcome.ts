import type { NightEntry, OfflineReport } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { getResearch } from '../../data/research';
import { RESOURCE_ICONS, el, setRich } from '../../ui/dom';
import type { GameState, ResourceType } from '../../core/GameState';
import { uiSound } from '../../audio/uiSound';
import { checkinSuggestions } from '../../systems/Guide';
import { portraitFor, portraitUrl } from '../../data/portraits';
import type { GameApp } from '../../app';
import { getDef } from '../../data/buildingDefs';
import { getProject } from '../../data/projects';
import { ACTS } from '../../data/acts';
import { SEASONS } from '../../data/seasons';
import { POIS } from '../../data/surface';
import { DISASTERS } from '../../data/incidents';

/** [ux-wp5 C14] The night log shows at most this many lines. */
const NIGHT_LINES = 6;

/** [plan4:GP-3] An absence longer than this (seconds) gets the short check-in instead of the long report. */
const CHECKIN_MIN_SECONDS = 600;

/** The welcome-back report and the daily supply drop. */
export class WelcomeController {
  private app: GameApp;

  constructor(app: GameApp) {
    this.app = app;
  }

  /**
   * Welcome back (S6): what was made, what overflowed full storage, who came home, what research finished,
   * and the people waiting at the door, whose answer is the first thing the player does this session.
   */
  showWelcome(report: OfflineReport | null): void {
    // [plan4:GP-3] A real absence gets the short check-in; a short one (10 minutes or less) keeps the old report.
    if (report && report.seconds > CHECKIN_MIN_SECONDS) {
      this.showCheckin(report);
      return;
    }
    this.app.welcomeOpen = true;
    // Whatever closes this dialog (a button, or another dialog taking its place) ends the "welcome is open" state.
    const onDismiss = () => { this.app.welcomeOpen = false; };
    this.app.audio.play('event');
    const state = this.app.state;
    const body = el('div', 'modal-result');
    this.fullReport(body, report);
    const waiting = state.doorWaiting ?? [];
    const close = () => {
      this.app.welcomeOpen = false;
      this.app.modal.hide();
    };
    if (waiting.length === 0) {
      const actions = [{ label: i18n.t('welcome.ok'), onClick: close }] as { label: string; className?: string; onClick: () => void }[];
      // [Economy A1] a shortcut to spend the credits the overflow earned.
      if ((report?.credits ?? 0) > 0) actions.unshift({ label: i18n.t('welcome.toShop'), className: 'btn-secondary', onClick: () => { close(); this.app.journal.showShop(this.app.state); } });
      this.app.modal.show({ icon: '[[vault]]', title: i18n.t('welcome.title'), body, actions, onDismiss });
      return;
    }
    // The doorstep: faces and names of who waited through the night.
    body.appendChild(this.doorstep(waiting));
    const beds = state.maxPopulation - state.survivors.length;
    const answer = (accept: boolean) => {
      const n = this.app.engine.answerDoor(accept);
      close();
      this.app.audio.play(accept && n > 0 ? 'cheer' : 'click');
      this.app.toasts.show(accept && n > 0 ? `[[people]] ${i18n.t('welcome.doorIn', { n })}` : `[[door]] ${i18n.t('welcome.doorAway')}`, accept && n > 0 ? 'good' : 'info');
    };
    this.app.modal.show({
      icon: '[[door]]',
      title: i18n.t('welcome.title'),
      body,
      actions: [
        { label: i18n.t('welcome.doorAccept'), className: 'btn-primary', disabled: beds <= 0, onClick: () => answer(true) },
        { label: i18n.t('welcome.doorRefuse'), className: 'btn-secondary', onClick: () => answer(false) },
      ],
      onDismiss,
    });
  }

  /** The people at the door: faces, names and (when beds are short) the warning. Shared by the old report and the details of the check-in. */
  private doorstep(waiting: NonNullable<GameState['doorWaiting']>): HTMLElement {
    const state = this.app.state;
    const door = el('div', 'welcome-door');
    const row = el('div', 'modal-portraits');
    for (const p of waiting) {
      const img = el('img', 'modal-portrait');
      img.src = portraitUrl(portraitFor(p));
      img.alt = '';
      row.appendChild(img);
    }
    const names = waiting.map(p => this.app.localName(p.name)).join(', ');
    door.append(row, el('p', 'modal-body', `[[door]] ${i18n.t(waiting.length === 1 ? 'welcome.doorOne' : 'welcome.door', { n: waiting.length, names })}`));
    const beds = state.maxPopulation - state.survivors.length;
    if (beds < waiting.length) door.appendChild(el('p', 'bp-hint negative-text', i18n.t(beds <= 0 ? 'welcome.doorNoBeds' : 'welcome.doorBeds', { n: Math.max(0, beds) })));
    return door;
  }

  /** The long report, exactly as it was: what was made, what overflowed, who came home, what finished, what struck. */
  private fullReport(body: HTMLElement, report: OfflineReport | null): void {
    const state = this.app.state;
    const locale = i18n.currentLocale;
    if (report) {
      body.appendChild(el('p', 'modal-body', this.awayText(report)));
      if (Object.keys(report.gained).length > 0) {
        body.appendChild(el('p', 'modal-sub', i18n.t('welcome.produced')));
        body.appendChild(this.gainsList(report.gained));
      }
      // [Economy A1/A3] Overflow became credits (and fed the active project) instead of being lost.
      const converted = report.converted ?? {};
      if ((report.credits ?? 0) > 0 || Object.keys(report.absorbed ?? {}).length > 0) {
        if (report.credits > 0) {
          body.appendChild(el('p', 'modal-sub', `[[storage]] ${i18n.t('welcome.converted', { credits: report.credits })}`));
          body.appendChild(this.gainsList(converted));
        }
        if (Object.keys(report.absorbed ?? {}).length > 0) {
          body.appendChild(el('p', 'modal-sub', i18n.t('welcome.absorbed')));
          body.appendChild(this.gainsList(report.absorbed));
        }
        body.appendChild(el('p', 'bp-hint', i18n.t('welcome.convertedHint')));
      }
      const wasted = report.wasted ?? {};
      if (Object.keys(wasted).length > 0) {
        body.appendChild(el('p', 'modal-sub negative-text', `[[storage]] ${i18n.t('welcome.wasted')}`));
        body.appendChild(this.gainsList(Object.fromEntries(Object.entries(wasted).map(([r, v]) => [r, -(v ?? 0)]))));
        body.appendChild(el('p', 'bp-hint', i18n.t('welcome.wastedHint')));
      }
      if (report.missions > 0) body.appendChild(el('p', 'modal-sub', `[[backpack]] ${i18n.t('welcome.missions', { n: report.missions })}`));
      if (report.research?.length) {
        const names = report.research.map(id => (getResearch(id) ?? this.app.engine.researchSystem.defOf(state, id))?.name[locale] ?? id).join(', ');
        body.appendChild(el('p', 'modal-sub', `[[research]] ${i18n.t('welcome.research', { names })}`));
      }
      // [Danger C4] the soft version of what struck while away
      const dg = report.danger;
      if (dg && (dg.raids > 0 || dg.disasters.length > 0)) {
        const parts: string[] = [];
        if (dg.raids > 0) parts.push(i18n.t('welcome.danger.raids', { n: dg.raids, lost: dg.raidsLost }));
        if (dg.disasters.length > 0) parts.push(i18n.t('welcome.danger.disasters', { n: dg.disasters.length }));
        if (dg.hurt > 0) parts.push(i18n.t('welcome.danger.hurt', { n: dg.hurt }));
        body.appendChild(el('p', 'modal-sub negative-text', `[[warning]] ${i18n.t('welcome.danger.title')} ${parts.join(' · ')}`));
        if (dg.died.length > 0) body.appendChild(el('p', 'modal-sub negative-text', `[[skull]] ${i18n.t('welcome.danger.died', { names: dg.died.map(n => this.app.localName(n)).join(', ') })}`));
        else body.appendChild(el('p', 'bp-hint', i18n.t('welcome.danger.hint')));
      }
      // [ux-wp5 C14] The night log (the check-in shows it in its own section).
      if (report.seconds <= CHECKIN_MIN_SECONDS) {
        const night = this.nightLog(report);
        if (night) body.append(el('p', 'modal-sub', `[[moon]] ${i18n.t('night.title')}`), night);
      }
    }
  }

  /** "You were away 3 h" (and, past the 24-hour cap, how much of it the bunker counted). [ux-wp5 bugs D3 / C14] */
  private awayText(report: OfflineReport): string {
    const real = report.realSeconds ?? report.seconds;
    if (real <= report.seconds + 120) return i18n.t('welcome.away', { time: i18n.formatDuration(report.seconds) });
    const long = (s: number) => (s >= 36 * 3600 ? i18n.t('night.days', { n: Math.round(s / 86400) }) : i18n.formatDuration(s));
    return i18n.t('night.capped', { real: long(real), counted: i18n.formatDuration(report.seconds) });
  }

  /**
   * [ux-wp5 C14 / bugs D1 D2 / retention R7] The night log: 3 to 6 short lines with names. Who was lost, born or paired up, what
   * the raids and disasters took and who they hurt, what was dug, finished or cleared. Null when nothing like that happened.
   */
  nightLog(report: OfflineReport): HTMLElement | null {
    const lines = this.nightLines(report);
    if (lines.length === 0) return null;
    const box = el('div', 'checkin-lines night-log');
    for (const l of lines.slice(0, NIGHT_LINES)) box.appendChild(el('p', `checkin-line${l.bad ? ' negative-text' : ''}`, l.text));
    return box;
  }

  private nightLines(report: OfflineReport): { text: string; bad?: boolean; rank: number }[] {
    const app = this.app;
    const locale = i18n.currentLocale;
    const nm = (n: string) => app.localName(n);
    const list = (names: string[]) => {
      const shown = [...new Set(names)].slice(0, 3).map(nm).join(', ');
      return names.length > 3 ? shown + i18n.t('night.more', { n: new Set(names).size - 3 }) : shown;
    };
    const log: NightEntry[] = report.log ?? [];
    const of = (k: NightEntry['k']) => log.filter(e => e.k === k);
    const out: { text: string; bad?: boolean; rank: number }[] = [];
    // Deaths: from the log and from the raids and disasters (the same name once).
    const dead = [...new Set([...of('died').flatMap(e => e.names ?? []), ...(report.danger?.died ?? [])])];
    if (dead.length) out.push({ text: `[[skull]] ${i18n.t('night.died', { names: list(dead), ...(dead.length === 1 ? app.gByName(dead[0]) : {}) })}`, bad: true, rank: 0 });
    for (const e of of('born').slice(0, 2)) {
      const [child, a, b] = e.names ?? [];
      if (!child) continue;
      const g = app.gByName(child);
      out.push({ text: `[[baby]] ${b ? i18n.t('night.born', { child: nm(child), a: nm(a ?? ''), b: nm(b), ...g }) : i18n.t('night.bornOne', { child: nm(child), a: nm(a ?? ''), ...g })}`, rank: 1 });
    }
    // Raids and disasters, with who was hurt and what was taken.
    const dg = report.danger;
    if (dg && dg.raids > 0) {
      const key = dg.raidsLost > 0 ? (dg.raids === 1 ? 'night.raidLostOne' : 'night.raidsLost') : (dg.raids === 1 ? 'night.raidOne' : 'night.raids');
      out.push({ text: `[[skull]] ${i18n.t(key, { n: dg.raids, lost: dg.raidsLost })}`, bad: dg.raidsLost > 0, rank: 2 });
    }
    if (dg && dg.disasters.length > 0) {
      const names = [...new Set(dg.disasters)].map(k => DISASTERS[k]?.name[locale] ?? k).join(', ');
      out.push({ text: `[[warning]] ${i18n.t('night.disasters', { names })}`, bad: true, rank: 2 });
    }
    const nd = report.nightDanger;
    if (nd && (nd.hurt.length > 0 || Object.keys(nd.lost).length > 0)) {
      const parts: string[] = [];
      if (nd.hurt.length) parts.push(i18n.t('night.hurt', { names: list(nd.hurt) }));
      const lost = (Object.entries(nd.lost) as [ResourceType, number][]).filter(([, v]) => v < 0)
        .map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''}−${i18n.formatCompact(Math.abs(v))}`).join(' ');
      if (lost) parts.push(i18n.t('night.lost', { list: lost }));
      out.push({ text: `[[bandage]] ${parts.join(' · ')}`, bad: true, rank: 3 });
    }
    for (const e of of('couple').slice(0, 2)) {
      const [a, b] = e.names ?? [];
      if (a && b) out.push({ text: `[[heart]] ${i18n.t('night.couple', { a: nm(a), b: nm(b) })}`, rank: 4 });
    }
    for (const e of of('act')) out.push({ text: `[[flag]] ${i18n.t('night.act', { name: ACTS[(e.n ?? 1) - 1]?.name[locale] ?? String(e.n) })}`, rank: 1 });
    for (const e of of('project')) out.push({ text: `[[build]] ${i18n.t('night.project', { name: getProject(e.id)?.name[locale] ?? e.id ?? '' })}`, rank: 2 });
    const stages = of('stage').filter(e => !of('project').some(p => p.id === e.id));
    if (stages.length) {
      const last = stages[stages.length - 1];
      out.push({ text: `[[build]] ${i18n.t('night.stage', { name: getProject(last.id)?.name[locale] ?? last.id ?? '', n: last.n ?? 1 })}`, rank: 5 });
    }
    const digs = of('dig');
    if (digs.length) {
      const deepest = Math.max(...digs.map(e => e.n ?? 0));
      out.push({ text: `[[pick]] ${i18n.t(digs.length === 1 ? 'night.dig' : 'night.digs', { n: deepest, count: digs.length })}`, rank: 5 });
    }
    const ruins = of('ruin');
    if (ruins.length) out.push({ text: `[[broom]] ${i18n.t(ruins.length === 1 ? 'night.ruinOne' : 'night.ruins', { n: ruins.length })}`, rank: 6 });
    for (const e of of('recruit').slice(0, 2)) {
      const n = e.names?.[0];
      if (n) out.push({ text: `[[person]] ${i18n.t('night.recruit', { name: nm(n), ...app.gByName(n) })}`, rank: 6 });
    }
    for (const e of of('find').slice(0, 2)) {
      const poi = e.id ? POIS[e.id] : undefined;
      if (poi) out.push({ text: `[[map]] ${i18n.t('night.find', { name: poi.name[locale] ?? poi.name.en })}`, rank: 6 });
    }
    const built = of('built');
    if (built.length) {
      const names = [...new Set(built.map(e => getDef(e.id as never)?.name[locale] ?? e.id ?? ''))];
      const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? i18n.t('night.more', { n: names.length - 3 }) : '');
      out.push({ text: `[[build]] ${i18n.t('night.built', { names: shown })}`, rank: 7 });
    }
    for (const e of of('grown').slice(0, 1)) {
      const n = e.names?.[0];
      if (n) out.push({ text: `[[person]] ${i18n.t('night.grown', { name: nm(n), ...app.gByName(n) })}`, rank: 7 });
    }
    const season = of('season').pop();
    if (season) out.push({ text: `[[sun]] ${i18n.t('night.season', { name: SEASONS.find(s => s.id === season.id)?.name[locale] ?? season.id ?? '' })}`, rank: 8 });
    return out.sort((a, b) => a.rank - b.rank);
  }

  // ---- [plan4:GP-3] the check-in: what happened, what waits, what to do now ----

  /**
   * The short welcome after a real absence (UX-19 / GP-3): three parts in one scroll, one big button, the old report folded under "Details".
   * What happened is at most four lines; Waiting is at most three cards with one button each; Now is up to three one-tap suggestions.
   */
  private showCheckin(report: OfflineReport): void {
    const app = this.app;
    app.welcomeOpen = true;
    const onDismiss = () => { app.welcomeOpen = false; };
    app.audio.play('event');
    const state = app.state;
    const body = el('div', 'checkin');
    const close = () => {
      app.welcomeOpen = false;
      app.modal.hide();
      // People still at the door get their own question (accept or send away) a little later, not on top of the first tap.
      if ((app.state.doorWaiting?.length ?? 0) > 0) app.dialogs.snooze('welcome', 90_000);
    };

    body.appendChild(el('p', 'checkin-away', this.awayText(report)));

    // 1. What happened
    body.appendChild(el('h3', 'checkin-h', i18n.t('checkin.happened')));
    const lines = this.happenedLines(report);
    const happened = el('div', 'checkin-lines');
    for (const l of lines.length > 0 ? lines : [el('p', 'checkin-line', `[[moon]] ${i18n.t('checkin.quiet')}`)]) happened.appendChild(l);
    body.appendChild(happened);

    // [ux-wp5 C14] 1b. The night log: the people and places behind the numbers.
    const night = this.nightLog(report);
    if (night) {
      body.appendChild(el('h3', 'checkin-h', i18n.t('night.title')));
      body.appendChild(night);
    }

    // 2. Waiting: one card, one button each
    const cards = this.waitingCards();
    if (cards.length > 0) {
      body.appendChild(el('h3', 'checkin-h', i18n.t('checkin.waiting')));
      const box = el('div', 'checkin-cards');
      for (const c of cards) box.appendChild(c);
      body.appendChild(box);
    }

    // 3. Now: three suggestions from the guide, each a tap to the right panel
    const sug = checkinSuggestions(app.engine, state, 3);
    if (sug.length > 0) {
      body.appendChild(el('h3', 'checkin-h', i18n.t('checkin.now')));
      const box = el('div', 'checkin-sugs');
      for (const s of sug) {
        const b = el('button', 'btn btn-secondary checkin-sug');
        b.append(el('span', 'checkin-sug-icon', s.icon), el('span', 'checkin-sug-text', s.text));
        b.addEventListener('click', () => { uiSound('click'); close(); app.runAction(s.action); });
        box.appendChild(b);
      }
      body.appendChild(box);
    }

    // The old report, unchanged, folded away.
    const details = el('div', 'checkin-details');
    const toggle = el('button', 'btn btn-ghost checkin-toggle');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.append(el('span', '', i18n.t('checkin.details')), el('span', 'checkin-chev', '▾'));
    const full = el('div', 'modal-result checkin-full');
    full.hidden = true;
    this.fullReport(full, report);
    if (report.credits > 0) {
      const shop = el('button', 'btn btn-secondary checkin-shop', i18n.t('welcome.toShop'));
      shop.addEventListener('click', () => { close(); app.journal.showShop(app.state); });
      full.appendChild(shop);
    }
    const waiting = state.doorWaiting ?? [];
    if (waiting.length > 0) full.appendChild(this.doorstep(waiting));
    toggle.addEventListener('click', () => {
      full.hidden = !full.hidden;
      toggle.setAttribute('aria-expanded', String(!full.hidden));
      toggle.classList.toggle('open', !full.hidden);
      if (!full.hidden) full.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    details.append(toggle, full);
    body.appendChild(details);

    app.modal.show({
      icon: '[[vault]]',
      title: i18n.t('welcome.title'),
      body,
      actions: [{ label: i18n.t('checkin.continue'), className: 'btn-primary checkin-continue', onClick: close }],
      onDismiss,
    });
  }

  /** At most four lines: what was made, the storage story, who came home and what finished, and what struck. */
  private happenedLines(report: OfflineReport): HTMLElement[] {
    const state = this.app.state;
    const locale = i18n.currentLocale;
    const out: HTMLElement[] = [];
    const top = Object.entries(report.gained).filter(([, v]) => (v ?? 0) > 0).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 4);
    if (top.length > 0) {
      const line = el('div', 'checkin-line');
      line.append(el('span', 'checkin-line-text', `[[hourglass]] ${i18n.t('checkin.produced')}`), this.gainsList(Object.fromEntries(top) as Partial<Record<ResourceType, number>>));
      out.push(line);
    }
    const lost = Object.keys(report.wasted ?? {}).length > 0;
    if ((report.credits ?? 0) > 0 || lost) {
      const text = [(report.credits ?? 0) > 0 ? i18n.t('checkin.converted', { credits: report.credits }) : '', lost ? i18n.t('checkin.wasted') : ''].filter(Boolean).join(' · ');
      out.push(el('p', `checkin-line${lost ? ' negative-text' : ''}`, `[[storage]] ${text}`));
    }
    const done: string[] = [];
    if (report.missions > 0) done.push(`[[backpack]] ${i18n.t('welcome.missions', { n: report.missions })}`);
    if (report.research?.length) {
      const names = report.research.map(id => (getResearch(id) ?? this.app.engine.researchSystem.defOf(state, id))?.name[locale] ?? id).join(', ');
      done.push(`[[research]] ${i18n.t('welcome.research', { names })}`);
    }
    if (done.length > 0) out.push(el('p', 'checkin-line', done.join(' · ')));
    const dg = report.danger;
    // [ux-wp5 C14] The night log tells raids and disasters with names; this summary line stays for reports without it.
    if (dg && !report.nightDanger && (dg.raids > 0 || dg.disasters.length > 0)) {
      const parts: string[] = [];
      if (dg.raids > 0) parts.push(i18n.t('welcome.danger.raids', { n: dg.raids, lost: dg.raidsLost }));
      if (dg.disasters.length > 0) parts.push(i18n.t('welcome.danger.disasters', { n: dg.disasters.length }));
      if (dg.hurt > 0) parts.push(i18n.t('welcome.danger.hurt', { n: dg.hurt }));
      if (dg.died.length > 0) parts.push(i18n.t('welcome.danger.died', { names: dg.died.map(n => this.app.localName(n)).join(', ') }));
      out.push(el('p', 'checkin-line negative-text', `[[warning]] ${parts.join(' · ')}`));
    }
    return out.slice(0, 4);
  }

  /** The things that wait for a tap: today's crate, safe contracts, the people at the door. At most three, one button each. */
  private waitingCards(): HTMLElement[] {
    const app = this.app;
    const state = app.state;
    const cards: HTMLElement[] = [];
    const card = (icon: string, text: string, label: string, onClick: (done: (msg: string) => void) => void, disabled = false, note?: string): HTMLElement => {
      const c = el('div', 'checkin-card');
      const main = el('div', 'checkin-card-main');
      const t = el('span', 'checkin-card-text', `${icon} ${text}`);
      main.appendChild(t);
      if (note) main.appendChild(el('span', 'bp-hint negative-text', note));
      const b = el('button', 'btn btn-primary checkin-card-btn', label);
      b.disabled = disabled;
      b.addEventListener('click', () => {
        if (b.disabled) return;
        uiSound('confirm');
        onClick(msg => {
          // Done: the card says so and keeps its place, so nothing below it jumps.
          b.disabled = true;
          b.textContent = '✓';
          b.classList.replace('btn-primary', 'btn-secondary');
          setRich(t, msg);
          c.classList.add('done');
        });
      });
      c.append(main, b);
      return c;
    };
    if (app.engine.supplySystem.isReady(state)) {
      cards.push(card('[[gift]]', i18n.t('checkin.crate'), i18n.t('checkin.collect'), done => {
        const claim = app.engine.supplySystem.claim();
        if (!claim) return;
        app.engine.requestSave();
        app.audio.play('achievement');
        const got = Object.entries(claim.gains).map(([r, v]) => `${RESOURCE_ICONS[r as ResourceType] ?? ''}${i18n.formatCompact(Math.round(v ?? 0))}`).join(' ');
        done(`[[gift]] ${i18n.t('checkin.crateDone')} ${got}`.trim());
      }));
    }
    // [plan4:GP-1] Daily orders that are done and not yet taken (and the day chest): one tap takes them all, quietly (the card says what happened).
    const daily = app.engine.dailySystem;
    const dsum = daily.summary(state);
    if (dsum.claimable > 0) {
      cards.push(card('[[target]]', i18n.t('checkin.daily', { n: dsum.claimable }), i18n.t('daily.claimAll'), done => {
        daily.claimAll(true);
        if (daily.chestReady()) daily.claimChest(true);
        app.engine.requestSave();
        app.audio.play('coin');
        done(`[[target]] ${i18n.t('checkin.dailyDone')}`);
      }));
    }
    const cs = app.engine.contractSystem;
    const safe = (state.longGame?.inbox.items ?? []).filter(i => i.kind === 'contract' && cs.isSafe(state, i)).length;
    if (safe > 0) {
      cards.push(card('[[cart]]', i18n.t(safe === 1 ? 'checkin.contractsOne' : 'checkin.contracts', { n: safe }), i18n.t('checkin.acceptAll'), done => {
        const n = cs.acceptSafe();
        if (n > 0) app.engine.requestSave();
        app.audio.play('click');
        done(`[[cart]] ${i18n.t('checkin.contractsDone')}`);
      }));
    }
    const waiting = state.doorWaiting ?? [];
    if (waiting.length > 0) {
      const beds = state.maxPopulation - state.survivors.length;
      const names = waiting.map(p => app.localName(p.name)).join(', ');
      cards.push(card('[[door]]', i18n.t(waiting.length === 1 ? 'checkin.doorOne' : 'checkin.door', { n: waiting.length, names }), i18n.t('welcome.doorAccept'), done => {
        const n = app.engine.answerDoor(true);
        app.audio.play(n > 0 ? 'cheer' : 'click');
        done(`[[people]] ${i18n.t('welcome.doorIn', { n })}`);
      }, beds <= 0, beds < waiting.length ? i18n.t(beds <= 0 ? 'welcome.doorNoBeds' : 'welcome.doorBeds', { n: Math.max(0, beds) }) : undefined));
    }
    return cards.slice(0, 3);
  }

  gainsList(gains: Partial<Record<ResourceType, number>>): HTMLElement {
    const list = el('div', 'gains-list');
    for (const [r, v] of Object.entries(gains) as [ResourceType, number][]) {
      if (!v) continue;
      list.appendChild(el('span', `gain-chip ${v > 0 ? 'positive' : 'negative'}`, `${RESOURCE_ICONS[r] ?? ''} ${v > 0 ? '+' : '−'}${Math.abs(Math.round(v))}`));
    }
    return list;
  }

  /** The daily supply drop: open today's crate (NICE3). */
  openSupplyDrop(): void {
    const claim = this.app.engine.supplySystem.claim();
    if (!claim) return;
    this.app.engine.requestSave();
    this.app.audio.play('achievement');
    const body = el('div', 'modal-result');
    body.appendChild(el('p', 'modal-body', i18n.t('supply.desc')));
    body.appendChild(this.gainsList(claim.gains));
    body.appendChild(el('p', 'modal-sub', `[[hourglass]] ${i18n.t('rush.gift', { n: claim.rush })}`));
    if (Object.keys(claim.gains).length === 0) body.appendChild(el('p', 'bp-hint', i18n.t('supply.full')));
    body.appendChild(el('p', 'modal-sub', `[[fire]] ${i18n.t('supply.streak', { n: claim.streak })}`));
    body.appendChild(el('p', 'bp-hint', i18n.t('supply.tomorrow')));
    this.app.modal.show({ icon: '[[gift]]', title: i18n.t('supply.title'), body, actions: [{ label: i18n.t('event.ok'), onClick: () => this.app.modal.hide() }] });
  }
}
