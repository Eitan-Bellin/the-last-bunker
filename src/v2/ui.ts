// v2 DOM UI: the cash bar, the upgrade sheet of a stage (floor / elevator / market), the welcome-back card and toasts.
import {
  BOOST_MUL, BOOST_S, FLOORS, MAX_LVL, elevCap, elevSpeed, floorLoad, floorWorkers, maxAffordable, milestonesPassed, nextMilestone,
  porterCap, porterSpeed, porters,
} from './econ.ts';
import { big, clock } from './format.ts';
import type { Mine, StageId } from './mine.ts';
import { isMuted, play, setMuted } from './sound.ts';

type Buy = 1 | 10 | 'max';

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

  constructor(mine: Mine) {
    this.mine = mine;
    $('#mute').textContent = isMuted() ? '🔇' : '🔊';
    $('#mute').addEventListener('click', () => {
      setMuted(!isMuted());
      $('#mute').textContent = isMuted() ? '🔇' : '🔊';
    });
    this.sheet.addEventListener('click', e => this.onSheetClick(e));
    $('#scrim').addEventListener('click', () => this.close());
    this.shownCash = mine.s.cash;
  }

  openStage(id: StageId): void {
    this.open = id;
    this.lastKey = '';
    this.sheet.classList.add('on');
    $('#scrim').classList.add('on');
    play('open', { volume: 0.5 });
    this.render();
  }

  close(): void {
    if (this.open === null) return;
    this.open = null;
    this.sheet.classList.remove('on');
    $('#scrim').classList.remove('on');
  }

  isOpen(): boolean { return this.open !== null; }

  toast(text: string): void {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  welcome(amount: number, seconds: number, onDone: () => void): void {
    const el = $('#welcome');
    el.innerHTML = `
      <div class="card">
        <h2>ברוך שובך!</h2>
        <p>בזמן שלא היית (${clock(seconds)}) המנהלים הרוויחו</p>
        <div class="amount">🪙 ${big(amount)}</div>
        <button class="go">אסוף</button>
      </div>`;
    el.classList.add('on');
    el.querySelector('.go')!.addEventListener('click', () => {
      el.classList.remove('on');
      play('coin');
      onDone();
    }, { once: true });
  }

  /** Called ~10 times a second. */
  update(dt: number): void {
    const s = this.mine.s;
    // count-up: the bar chases the real number
    this.shownCash += (s.cash - this.shownCash) * Math.min(1, dt * 8);
    if (Math.abs(s.cash - this.shownCash) < 1) this.shownCash = s.cash;
    this.cashEl.textContent = big(this.shownCash);
    const r = this.mine.rates();
    this.rateEl.textContent = `${big(r.income)} לשנייה`;
    if (this.open !== null) this.render();
  }

  private levels(id: StageId): number {
    const st = this.mine.stage(id);
    const left = this.mine.levelCap() - st.lvl;
    if (left <= 0) return 0;
    if (this.buy === 'max') return Math.max(1, Math.min(left, maxAffordable(this.mine.upgradePrice(id), st.lvl, this.mine.s.cash)));
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
    const key = [id, st.lvl, n, can, st.mgr, Math.ceil(boostLeft), Math.ceil(cdLeft), this.buy, m.mgrCost(id) <= m.s.cash, Math.round(r.income)].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    const title = id === 'elev' ? 'מעלית' : id === 'market' ? 'שוק' : `קומה ${id + 1}: ${FLOORS[id].name}`;
    const sub = id === 'elev' ? 'מעלה את הסחורה מהארגזים למחסן' : id === 'market' ? 'סבלים לוקחים מהמחסן ומוכרים בשוק' : `מייצרת ${FLOORS[id].product}`;
    const now = this.stats(id, st.lvl);
    const next = this.stats(id, Math.min(cap, st.lvl + n));
    const rate = id === 'elev' ? r.elev : id === 'market' ? r.market : r.floors[id];
    const isNeck = (id === 'elev' && r.bottleneck === 'elev') || (id === 'market' && r.bottleneck === 'market') || (typeof id === 'number' && r.bottleneck === 'floors');
    const ms = nextMilestone(st.lvl);
    const mgrHtml = st.mgr
      ? `<div class="mgr has"><div><b>מנהל עובד</b><small>עובד לבד, גם כשאתה לא במשחק</small></div>
           <button class="boost" ${m.canBoost(id) ? '' : 'disabled'}>${boostLeft > 0 ? `×${BOOST_MUL} עוד ${clock(boostLeft)}` : cdLeft > 0 ? `זירוז בעוד ${clock(cdLeft)}` : `⚡ זירוז ×${BOOST_MUL} ל-${BOOST_S / 60} דק'`}</button></div>`
      : `<div class="mgr"><div><b>אין מנהל</b><small>בלי מנהל צריך ללחוץ כדי שיעבדו</small></div>
           <button class="hire" ${m.mgrCost(id) <= m.s.cash ? '' : 'disabled'}>שכור · 🪙 ${big(m.mgrCost(id))}</button></div>`;
    this.sheet.innerHTML = `
      <div class="head"><div><h2>${title}</h2><small>${sub}</small></div><button class="x">✕</button></div>
      <div class="lvl">רמה <b>${st.lvl}</b>${n > 0 && st.lvl < cap ? ` → <b class="up">${st.lvl + n}</b>` : ''}
        ${ms ? `<span class="ms">ברמה ${ms}: ${typeof id === 'number' || id === 'market' ? '+1 עובד, ' : ''}×1.5</span>` : ''}</div>
      <table>${now.map((row, k) => `<tr><td>${row[0]}</td><td>${row[1]}</td><td class="up">${next[k][1] !== row[1] ? `→ ${next[k][1]}` : ''}</td></tr>`).join('')}
        <tr><td>תפוקה</td><td>${big(rate)}/ש'</td><td>${isNeck ? '<span class="neck">צוואר בקבוק</span>' : ''}</td></tr></table>
      <div class="buyrow">
        ${([1, 10, 'max'] as Buy[]).map(b => `<button class="amt ${this.buy === b ? 'on' : ''}" data-amt="${b}">${b === 'max' ? 'מקס' : `×${b}`}</button>`).join('')}
      </div>
      <button class="upgrade" ${can ? '' : 'disabled'}>${st.lvl >= MAX_LVL ? 'רמה מקסימלית' : st.lvl >= cap ? `תקרה ${cap} · שדרגו את המפקדה` : `שדרג · 🪙 ${big(cost)}`}</button>
      ${mgrHtml}`;
  }

  private onSheetClick(e: MouseEvent): void {
    const b = (e.target as HTMLElement).closest('button');
    if (!b || this.open === null) return;
    const id = this.open;
    if (b.classList.contains('x')) { play('click', { volume: 0.5 }); this.close(); return; }
    if (b.dataset.amt) {
      this.buy = b.dataset.amt === 'max' ? 'max' : (Number(b.dataset.amt) as 1 | 10);
      play('tab', { volume: 0.5 });
    } else if (b.classList.contains('upgrade')) {
      const n = this.levels(id);
      const before = this.mine.stage(id).lvl;
      if (this.mine.upgrade(id, n)) {
        const after = this.mine.stage(id).lvl;
        const crossed = milestonesPassed(after) > milestonesPassed(before);
        play(crossed ? 'levelup' : 'coin', { volume: crossed ? 0.9 : 0.6, rate: 0.9 + Math.random() * 0.2 });
        if (crossed) this.toast('אבן דרך! ×1.5');
      } else play('error', { volume: 0.4 });
    } else if (b.classList.contains('hire')) {
      if (this.mine.hire(id)) { play('cheer'); this.toast('מנהל נשכר — מעכשיו זה עובד לבד'); }
    } else if (b.classList.contains('boost')) {
      if (this.mine.boost(id)) play('powerUp');
    }
    this.lastKey = '';
    this.render();
  }
}
