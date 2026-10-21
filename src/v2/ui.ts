// v2 DOM UI: the cash bar, the upgrade sheet of a stage (floor / elevator / market), the welcome-back card and toasts.
import {
  BOOST_MUL, BOOST_S, FLOORS, MAX_LVL, MILESTONES, OFFLINE_DOUBLE_GEMS, TURBO_GEMS, TURBO_S, elevCap, elevSpeed, floorLoad, floorWorkers,
  maxAffordable, milestonesPassed, nextMilestone, porterCap, porterSpeed, porters, toMilestone,
} from './econ.ts';
import { big, clock } from './format.ts';
import type { Mine, StageId } from './mine.ts';
import { isMuted, play, setMuted } from './sound.ts';

type Buy = 1 | 10 | 'ms' | 'max';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class MineUI {
  private cashEl = $('#cash');
  private rateEl = $('#rate');
  private sheet = $('#sheet');
  private open: StageId | null = null;
  private buy: Buy = 1;
  private shownCash = 0;
  private lastKey = '';

  private mine: Mine;
  /** The sheet moved to a stage (the view scrolls it into the top half). */
  onFocus: (id: StageId) => void = () => {};
  /** An upgrade crossed a milestone / a manager was hired (for the big celebration). */
  onMilestone: (id: StageId) => void = () => {};
  onHire: (id: StageId) => void = () => {};
  /** Gem turbo: is it on, and buying it. */
  turboLeft: () => number = () => 0;
  onTurbo: () => boolean = () => false;
  private hold: { timer: number; n: number } | null = null;

  constructor(mine: Mine) {
    this.mine = mine;
    $('#mute').textContent = isMuted() ? '🔇' : '🔊';
    $('#mute').addEventListener('click', () => {
      setMuted(!isMuted());
      $('#mute').textContent = isMuted() ? '🔇' : '🔊';
    });
    // buttons act on press (snappier, and the sheet re-renders under a slow tap); holding upgrade keeps buying
    this.sheet.addEventListener('pointerdown', e => this.onSheetPress(e));
    const stop = () => { if (this.hold) { clearTimeout(this.hold.timer); this.hold = null; } };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    $('#scrim').addEventListener('click', () => this.close());
    this.shownCash = mine.s.cash;
  }

  openStage(id: StageId): void {
    if (typeof id === 'number' && id >= this.mine.s.floors.length) return;
    this.open = id;
    this.lastKey = '';
    this.sheet.classList.add('on');
    $('#scrim').classList.add('on');
    document.body.classList.add('sheet-open');
    play('open', { volume: 0.5 });
    this.render();
    this.onFocus(id);
  }

  /** Order of the stages for the sheet's arrows: top of the mine to the bottom. */
  private order(): StageId[] { return ['market', 'elev', ...this.mine.s.floors.map((_, i) => i)]; }

  close(): void {
    if (this.open === null) return;
    this.open = null;
    this.sheet.classList.remove('on');
    $('#scrim').classList.remove('on');
    document.body.classList.remove('sheet-open');
  }

  isOpen(): boolean { return this.open !== null; }

  toast(text: string): void {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  /** The welcome-back card; doubling costs gems. onDone gets the screen point of the button (coins fly from it). */
  welcome(amount: number, seconds: number, onDone: (x: number, y: number) => void): void {
    const el = $('#welcome');
    const canDouble = this.mine.s.gems >= OFFLINE_DOUBLE_GEMS;
    el.innerHTML = `
      <div class="card">
        <h2>ברוך שובך!</h2>
        <p>בזמן שלא היית (${clock(seconds)}) המנהלים הרוויחו</p>
        <div class="amount">🪙 ${big(amount)}</div>
        <div class="two">
          <button class="go">אסוף</button>
          <button class="dbl" ${canDouble ? '' : 'disabled'}>×2 · 💎 ${OFFLINE_DOUBLE_GEMS}</button>
        </div>
      </div>`;
    el.classList.add('on');
    const done = (ev: Event, double: boolean) => {
      const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      if (double) {
        this.mine.s.gems -= OFFLINE_DOUBLE_GEMS;
        this.mine.s.cash += amount;
        this.mine.s.stats.earned += amount;
      }
      el.classList.remove('on');
      play(double ? 'achievement' : 'coin');
      onDone(r.left + r.width / 2, r.top + r.height / 2);
    };
    el.querySelector('.go')!.addEventListener('click', e => done(e, false), { once: true });
    el.querySelector('.dbl')!.addEventListener('click', e => { if (this.mine.s.gems >= OFFLINE_DOUBLE_GEMS) done(e, true); }, { once: true });
  }

  /** The turbo card: every sale ×2 for half an hour, for gems (stacks when bought again). */
  turbo(): void {
    const el = $('#welcome');
    const draw = () => {
      const left = this.turboLeft();
      const can = this.mine.s.gems >= TURBO_GEMS;
      el.innerHTML = `
        <div class="card turbo">
          <h2>⚡ טורבו</h2>
          <p>כל המכירות ×2 למשך ${TURBO_S / 60} דקות${left > 0 ? `<br><b class="up">פעיל עוד ${clock(left)}</b>` : ''}</p>
          <div class="two">
            <button class="go" ${can ? '' : 'disabled'}>${left > 0 ? 'הארך' : 'הפעל'} · 💎 ${TURBO_GEMS}</button>
            <button class="dbl no">סגור</button>
          </div>
          ${can ? '' : '<p class="muted">יהלומים מקבלים ממשימות, מיעדים, מארגזי אספקה ומפשיטות</p>'}
        </div>`;
      el.querySelector('.go')!.addEventListener('click', () => {
        if (this.onTurbo()) { play('powerUp'); el.classList.remove('on'); } else play('error', { volume: 0.4 });
      }, { once: true });
      el.querySelector('.no')!.addEventListener('click', () => { play('click', { volume: 0.5 }); el.classList.remove('on'); }, { once: true });
    };
    draw();
    el.classList.add('on');
    play('open', { volume: 0.5 });
  }

  /** Called ~10 times a second. */
  update(dt: number): void {
    const s = this.mine.s;
    // count-up: the bar chases the real number
    this.shownCash += (s.cash - this.shownCash) * Math.min(1, dt * 8);
    if (Math.abs(s.cash - this.shownCash) < 1) this.shownCash = s.cash;
    this.cashEl.textContent = big(this.shownCash);
    const r = this.mine.rates();
    const tl = this.turboLeft();
    this.rateEl.innerHTML = tl > 0 ? `<b class="tb">⚡×2 ${clock(tl)}</b>` : `+${big(r.income)}/ש'`;
    if (this.open !== null) this.render();
  }

  private levels(id: StageId): number {
    const st = this.mine.stage(id);
    const left = this.mine.levelCap() - st.lvl;
    if (left <= 0) return 0;
    if (this.buy === 'max') return Math.max(1, Math.min(left, maxAffordable(this.mine.upgradePrice(id), st.lvl, this.mine.s.cash)));
    if (this.buy === 'ms') return Math.min(left, toMilestone(st.lvl));
    return Math.min(this.buy, left);
  }

  private stats(id: StageId, lvl: number): [string, string][] {
    if (id === 'elev') return [['קיבולת', big(elevCap(lvl))], ['מהירות', `${Math.round(elevSpeed(lvl))}`]];
    if (id === 'market') return [['סבלים', String(porters(lvl))], ['כל סבל סוחב', big(porterCap(lvl))], ['מהירות', `${Math.round(porterSpeed(lvl))}`]];
    return [['עובדים', String(floorWorkers(lvl))], ['כל סחיבה', big(floorLoad(id, lvl))]];
  }

  private render(): void {
    const id = this.open;
    if (id === null) return;
    const m = this.mine;
    const st = m.stage(id);
    const n = this.levels(id);
    const cost = m.upgradeCost(id, n);
    const cap = m.levelCap();
    const can = n > 0 && cost <= m.s.cash && st.lvl < cap;
    const r = m.rates();
    const boostLeft = st.boostUntil - m.s.time;
    const cdLeft = st.boostReadyAt - m.s.time;
    const key = [id, st.lvl, n, can, st.mgr, Math.ceil(boostLeft), Math.ceil(cdLeft), this.buy, m.mgrCost(id) <= m.s.cash, Math.round(r.income), m.s.floors.length].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    const title = id === 'elev' ? 'מעלית' : id === 'market' ? 'שוק' : `קומה ${id + 1}: ${FLOORS[id].name}`;
    const sub = id === 'elev' ? 'מעלה את הסחורה מהארגזים למחסן' : id === 'market' ? 'סבלים לוקחים מהמחסן ומוכרים בשוק' : `מייצרת ${FLOORS[id].product}`;
    const now = this.stats(id, st.lvl);
    const next = this.stats(id, Math.min(cap, st.lvl + n));
    const rate = id === 'elev' ? r.elev : id === 'market' ? r.market : r.floors[id];
    const isNeck = (id === 'elev' && r.bottleneck === 'elev') || (id === 'market' && r.bottleneck === 'market') || (typeof id === 'number' && r.bottleneck === 'floors');
    const ms = nextMilestone(st.lvl);
    const prevMs = [...MILESTONES].reverse().find(x => x <= st.lvl) ?? 1;
    const msPct = ms ? Math.min(100, (100 * (st.lvl - prevMs)) / Math.max(1, ms - prevMs)) : 100;
    const order = this.order();
    const at = order.indexOf(id);
    const mgrHtml = st.mgr
      ? `<div class="mgr has"><div><b>מנהל עובד</b><small>עובד לבד, גם כשאתה לא במשחק</small></div>
           <button class="boost" ${m.canBoost(id) ? '' : 'disabled'}>${boostLeft > 0 ? `×${BOOST_MUL} עוד ${clock(boostLeft)}` : cdLeft > 0 ? `זירוז בעוד ${clock(cdLeft)}` : `⚡ זירוז ×${BOOST_MUL} ל-${BOOST_S / 60} דק'`}</button></div>`
      : `<div class="mgr"><div><b>אין מנהל</b><small>בלי מנהל צריך ללחוץ כדי שיעבדו</small></div>
           <button class="hire" ${m.mgrCost(id) <= m.s.cash ? '' : 'disabled'}>שכור · 🪙 ${big(m.mgrCost(id))}</button></div>`;
    this.sheet.innerHTML = `
      <div class="head">
        <div class="arrows"><button class="step" data-step="-1" ${at > 0 ? '' : 'disabled'}>▲</button><button class="step" data-step="1" ${at < order.length - 1 ? '' : 'disabled'}>▼</button></div>
        <div class="ttl"><h2>${title}</h2><small>${sub}</small></div><button class="x">✕</button></div>
      <div class="lvl">רמה <b>${st.lvl}</b>${n > 0 && st.lvl < cap ? ` → <b class="up">${st.lvl + n}</b>` : ''}
        ${ms ? `<span class="ms">ברמה ${ms}: ${typeof id === 'number' || id === 'market' ? '+1 עובד, ' : ''}×1.5</span>` : ''}</div>
      ${ms ? `<div class="msbar"><i style="width:${msPct.toFixed(1)}%"></i><span>עוד ${ms - st.lvl} רמות לאבן הדרך</span></div>` : ''}
      <table>${now.map((row, k) => `<tr><td>${row[0]}</td><td>${row[1]}</td><td class="up">${next[k][1] !== row[1] ? `→ ${next[k][1]}` : ''}</td></tr>`).join('')}
        <tr><td>תפוקה</td><td>${big(rate)}/ש'</td><td>${isNeck ? '<span class="neck">צוואר בקבוק</span>' : ''}</td></tr></table>
      <div class="buyrow">
        ${([1, 10, 'ms', 'max'] as Buy[]).map(b => `<button class="amt ${this.buy === b ? 'on' : ''}" data-amt="${b}">${b === 'max' ? 'מקס' : b === 'ms' ? '⭐ אבן דרך' : `×${b}`}</button>`).join('')}
      </div>
      <button class="upgrade" ${can ? '' : 'disabled'}>${st.lvl >= MAX_LVL ? 'רמה מקסימלית' : st.lvl >= cap ? `תקרה ${cap} · שדרגו את המפקדה` : `שדרג${n > 1 ? ` ×${n}` : ''} · 🪙 ${big(cost)}`}</button>
      <small class="holdtip">החזיקו את הכפתור כדי לשדרג ברצף</small>
      ${mgrHtml}`;
  }

  /** One press of the upgrade button; false when nothing was bought. */
  private upgradeOnce(id: StageId, quiet = false): boolean {
    const n = this.levels(id);
    const before = this.mine.stage(id).lvl;
    if (!this.mine.upgrade(id, n)) { if (!quiet) play('error', { volume: 0.4 }); return false; }
    const after = this.mine.stage(id).lvl;
    const crossed = milestonesPassed(after) > milestonesPassed(before);
    // rising pitch while holding: the longer the run, the higher the coin
    const climb = this.hold ? Math.min(0.6, this.hold.n * 0.03) : 0;
    play(crossed ? 'levelup' : 'coin', { volume: crossed ? 0.9 : 0.55, rate: 0.9 + climb + Math.random() * 0.1 });
    if (crossed) { this.toast('אבן דרך! ×1.5'); this.onMilestone(id); }
    return true;
  }

  private onSheetPress(e: PointerEvent): void {
    const b = (e.target as HTMLElement).closest('button');
    if (!b || this.open === null || (b as HTMLButtonElement).disabled) return;
    e.preventDefault();
    const id = this.open;
    if (b.classList.contains('x')) { play('click', { volume: 0.5 }); this.close(); return; }
    if (b.dataset.step) {
      const order = this.order();
      const next = order[order.indexOf(id) + Number(b.dataset.step)];
      if (next !== undefined) { this.open = next; play('tab', { volume: 0.5 }); this.onFocus(next); }
    } else if (b.dataset.amt) {
      this.buy = b.dataset.amt === 'max' ? 'max' : b.dataset.amt === 'ms' ? 'ms' : (Number(b.dataset.amt) as 1 | 10);
      play('tab', { volume: 0.5 });
    } else if (b.classList.contains('upgrade')) {
      if (this.upgradeOnce(id)) {
        // hold: after a beat, keep buying faster and faster until the finger lifts or the money runs out
        const tick = () => {
          if (!this.hold || this.open !== id) return;
          this.hold.n++;
          if (!this.upgradeOnce(id, true)) { this.hold = null; return; }
          this.lastKey = '';
          this.render();
          this.hold.timer = window.setTimeout(tick, Math.max(55, 170 - this.hold.n * 12));
        };
        this.hold = { n: 0, timer: window.setTimeout(tick, 380) };
      }
    } else if (b.classList.contains('hire')) {
      if (this.mine.hire(id)) { play('cheer'); this.toast('מנהל נשכר — מעכשיו זה עובד לבד'); this.onHire(id); }
    } else if (b.classList.contains('boost')) {
      if (this.mine.boost(id)) play('powerUp');
    }
    this.lastKey = '';
    this.render();
  }
}
