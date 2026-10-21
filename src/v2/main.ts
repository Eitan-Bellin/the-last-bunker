// v2 entry: load the mine save (its own key, the classic game's save is never touched), credit time away, run the loop.
import './v2.css';
import { Mine, newSave, type MineSave, type StageId } from './mine.ts';
import { MineUI } from './ui.ts';
import { MineView } from './view.ts';
import { play, unlockAudio } from './sound.ts';
import { FLOORS, TURBO_GEMS, TURBO_S } from './econ.ts';
import { Goals, goalText } from './goals.ts';
import { bump, flyTo } from './juice.ts';
import type { DropPrize } from './juice.ts';
import { Base, newBase, CC_FLOORS } from './base.ts';
import { BaseUI } from './baseui.ts';
import { BattleView } from './battleview.ts';
import { prestigeMul, rebirth } from './prestige.ts';
import { Daily } from './daily.ts';
import { big, clock } from './format.ts';

const params = new URLSearchParams(location.search);
const KEY = `lastbunker_v2${params.get('slot') ? `_${params.get('slot')}` : ''}`;

function load(): MineSave {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as MineSave;
      if (s.v === 1 && Array.isArray(s.floors) && s.floors.length > 0) return s;
    }
  } catch { /* corrupted: start fresh, but keep the bad copy */
    try { localStorage.setItem(`${KEY}_bad`, localStorage.getItem(KEY) ?? ''); } catch { /* ignore */ }
  }
  return newSave();
}

const save = load();
save.base ??= newBase(Date.now());
if (save.gems === undefined || Number.isNaN(save.gems)) save.gems = 15;
const mine = new Mine(save);
const base = new Base(mine, save.base);
mine.levelCap = () => base.levelCap();
mine.saleMul = () => (1 + base.incomeBonus()) * prestigeMul(save.prestige);
mine.liveMul = () => ((save.turboUntil ?? 0) > Date.now() ? 2 : 1);
const awayS = (Date.now() - save.savedAt) / 1000;
base.step(Date.now());
const earnedAway = awayS > 30 ? mine.offline(awayS) : 0;

function persist(): void {
  if (rebirthing) return;
  mine.s.savedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(mine.s)); } catch { /* storage full: keep playing */ }
}

const view = new MineView(mine);
const ui = new MineUI(mine);
const daily = new Daily(mine, base, save.daily, Date.now());
save.daily = daily.s;
const bui = new BaseUI(mine, base, daily);
const goals = new Goals(mine, base, save.goals);
save.goals = goals.s;
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
/** A short vibration on phones that have it (Android); silently nothing elsewhere. */
const buzz = (ms: number | number[]) => { try { navigator.vibrate?.(ms); } catch { /* not allowed */ } };
bui.onToast = t => ui.toast(t);
bui.onRebirth = () => {
  const next = rebirth(mine.s, Date.now());
  next.savedAt = Date.now();
  try {
    localStorage.setItem(`${KEY}_before_rebirth`, JSON.stringify(mine.s));
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { return; }
  rebirthing = true;
  location.reload();
};
let rebirthing = false;

async function start(): Promise<void> {
  await document.fonts.load('700 20px Rubik').catch(() => null);
  view.topInset = 64;
  await view.init(document.getElementById('stage')!);
  const battle = new BattleView(view.app);
  view.app.stage.addChild(battle.root);
  bui.onBattle = campId => {
    const c = base.s.camps.find(x => x.id === campId);
    if (!c) return;
    const now = Date.now();
    void battle.start(base.battleSetup(c), c, win => {
      base.endBattle(campId, win, Date.now());
      persist();
    }).catch(err => ui.toast(`הקרב לא נטען: ${String(err)}`));
  };
  view.ccTier = () => (base.s.cc >= 7 ? 3 : base.s.cc >= 4 ? 2 : 1);
  view.onCommand = () => bui.show('command');
  view.onOpen = id => ui.openStage(id);
  view.onTap = (id: StageId) => { play(id === 'elev' ? 'elevator' : 'click', { volume: id === 'elev' ? 0.35 : 0.5, rate: 0.95 + Math.random() * 0.15, minGapMs: 70 }); buzz(6); };
  ui.onFocus = id => {
    // room under the sheet so even the lowest floor can sit at the top of the screen
    view.bottomPad = ($('#sheet').offsetHeight || 0) + 80;
    view.focusStage(id);
  };
  const closeSheet = ui.close.bind(ui);
  ui.close = () => { closeSheet(); view.bottomPad = 0; };
  ui.onMilestone = id => { view.cheer(id, '×1.5!'); play('rankUp', { volume: 0.7 }); buzz([30, 40, 30]); };
  ui.onHire = id => view.cheer(id, 'מנהל!', 0x9cf09c);
  ui.turboLeft = () => Math.max(0, ((save.turboUntil ?? 0) - Date.now()) / 1000);
  ui.onTurbo = () => {
    if (mine.s.gems < TURBO_GEMS) return false;
    mine.s.gems -= TURBO_GEMS;
    save.turboUntil = Math.max(Date.now(), save.turboUntil ?? 0) + TURBO_S * 1000;
    ui.toast('⚡ טורבו! כל המכירות ×2');
    persist();
    return true;
  };
  $('#hud .gems').addEventListener('click', () => ui.turbo());
  $('#jump').addEventListener('click', () => { play('click', { volume: 0.4 }); view.scrollTop(); });

  // the goal bar: tap a finished goal to collect, an open one to go where it is done
  const goalEl = $('#goal');
  let goalKey = '';
  const drawGoal = () => {
    const [p, t] = goals.progress();
    const done = p >= t;
    const key = `${goals.s.idx}|${p}|${t}|${done}`;
    if (key === goalKey) return;
    goalKey = key;
    goalEl.classList.toggle('done', done);
    goalEl.innerHTML = `<span class="gi">${done ? '✅' : '🎯'}</span>
      <span class="gt"><b>${goalText(goals.cur)}</b><i class="gb"><i style="width:${(100 * p / t).toFixed(1)}%"></i></i></span>
      <span class="gr">${done ? 'אסוף!' : t > 1 ? `${p}/${t}` : ''}<small>💎${goals.gems()}</small></span>`;
  };
  goalEl.addEventListener('click', () => {
    if (goals.done()) {
      const r = goalEl.getBoundingClientRect();
      const pay = goals.claim();
      if (!pay) return;
      play('achievement', { volume: 0.8 });
      buzz(20);
      flyTo($('#hud .gems'), r.left + r.width / 2, r.top + r.height / 2, '💎', 4);
      flyTo($('#hud .coin'), r.left + r.width / 2, r.top + r.height / 2, '🪙', 6);
      ui.toast(`יעד הושלם! 💎 ${pay.gems} · 🪙 ${big(pay.coins)}`);
      goalKey = '';
      persist();
      return;
    }
    play('click', { volume: 0.4 });
    const go = goals.go();
    if (go === 'dig') view.focusStage('dig');
    else if (go === 'command' || go === 'raids') bui.show(go);
    else if (go !== 'none') {
      if (typeof go === 'number' && go >= mine.s.floors.length) view.focusStage('dig');
      else ui.openStage(go);
    }
  });

  // supply drops: a crate parachutes into view every couple of minutes of play
  let dropIn = 40;
  view.onDropOpen = (prize: DropPrize, sx: number, sy: number) => {
    goals.dropCaught();
    buzz(25);
    if (prize.kind === 'coins') {
      mine.s.cash += prize.amount;
      mine.s.stats.earned += prize.amount;
      play('reveal', { volume: 0.8 });
      flyTo($('#hud .coin'), sx, sy, '🪙', 9);
      ui.toast(`ארגז אספקה! 🪙 ${big(prize.amount)}`);
    } else if (prize.kind === 'gems') {
      mine.s.gems += prize.amount;
      play('achievement', { volume: 0.9 });
      flyTo($('#hud .gems'), sx, sy, '💎', prize.amount + 3);
      ui.toast(`ארגז נדיר! 💎 ${prize.amount}`);
    } else {
      const until = mine.s.time + prize.seconds;
      for (const id of ['elev', 'market', ...mine.s.floors.map((_, i) => i)] as StageId[]) {
        const st = mine.stage(id);
        st.boostUntil = Math.max(st.boostUntil, until);
      }
      play('powerUp', { volume: 0.9 });
      ui.toast(`⚡ כל המכרה ×2 ל-${prize.seconds} שניות!`);
    }
    persist();
  };
  const rollPrize = (): DropPrize => {
    const r = Math.random();
    if (r < 0.12) return { kind: 'gems', amount: 1 + Math.floor(Math.random() * 3) };
    if (r < 0.27) return { kind: 'frenzy', seconds: 60 };
    return { kind: 'coins', amount: Math.max(30, mine.rates().income * (60 + Math.random() * 90)) };
  };
  let lastFly = 0;
  view.onDig = () => {
    const c = mine.digCost();
    if (c === null) return;
    const job = base.busy('dig');
    if (job) { bui.show('command'); return; }
    if (!base.canDigMore()) {
      play('error', { volume: 0.4 });
      ui.toast(`כדי לחפור עוד צריך מפקדה רמה ${CC_FLOORS.findIndex(n => n > mine.s.floors.length)}`);
      bui.show('command');
      return;
    }
    if (base.freeBuilders() <= 0) { play('error', { volume: 0.4 }); ui.toast('כל הבנאים עסוקים'); return; }
    if (base.startDig(Date.now())) {
      play('dig');
      ui.toast(`הבנאים התחילו לחפור: ${FLOORS[mine.s.floors.length].name}`);
      persist();
    } else {
      play('error', { volume: 0.4 });
      ui.toast('אין מספיק מטבעות עדיין');
    }
  };
  view.digInfo = () => {
    const now = Date.now();
    const job = base.busy('dig');
    const c = mine.digCost() ?? 0;
    if (job) return { text: `⛏ חופרים… ${clock((job.endAt - now) / 1000)}`, color: 0xffd9a0, progress: (now - job.startAt) / Math.max(1, job.endAt - job.startAt) };
    if (!base.canDigMore()) return { text: `🔒 מפקדה רמה ${CC_FLOORS.findIndex(n => n > mine.s.floors.length)}`, color: 0xff9b7b, progress: null };
    return { text: `⛏ ${big(c)} · ⏱ ${clock(base.digTime())}`, color: c <= mine.s.cash ? 0x9cf09c : 0xffd36b, progress: null };
  };
  base.on(e => {
    if (e.kind === 'jobDone') {
      play('complete', { volume: 0.8 });
      if (e.job.kind === 'dig') {
        setTimeout(() => play('unlock'), 300);
        setTimeout(() => view.cheer(e.job.target, 'קומה חדשה!', 0x9cf09c), 500);
        ui.toast(`נפתחה קומה ${e.job.target + 1}: ${FLOORS[e.job.target].name}`);
      } else if (e.job.kind === 'cc') { ui.toast(`המפקדה עלתה לרמה ${e.job.target}!`); play('rankUp'); }
      else ui.toast(`${e.job.kind === 'armory' ? 'הנשקייה' : 'החומות'} עלו לרמה ${e.job.target}`);
      persist();
    }
  });
  mine.on(e => {
    if (e.kind === 'sell') {
      play('coin', { volume: 0.35, rate: 1 + Math.random() * 0.15, minGapMs: 90 });
      // a coin flies from the stalls into the counter (when the surface is on screen)
      const t = performance.now();
      if (!view.deep() && t - lastFly > 280 && !battle.active) {
        lastFly = t;
        const p = view.toScreen(e.x, 340);
        flyTo($('#hud .coin'), p.x, p.y, '🪙', 1);
      }
    }
    else if (e.kind === 'unload') play('collect', { volume: 0.3, minGapMs: 200 });
  });
  window.addEventListener('pointerdown', () => unlockAudio(), { capture: true });

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); persist(); return; }
    const gap = (Date.now() - hiddenAt) / 1000;
    if (hiddenAt && gap > 5) {
      const got = mine.offline(gap);
      if (got > 0 && gap > 60) ui.welcome(got, gap, (x, y) => flyTo($('#hud .coin'), x, y, '🪙', 10));
    }
  });
  window.addEventListener('pagehide', persist);
  setInterval(persist, 5000);

  let uiAcc = 0;
  view.app.ticker.add(t => {
    let dt = Math.min(t.deltaMS / 1000, 0.25);
    const real = dt;
    while (dt > 0) { const step = Math.min(dt, 0.05); mine.step(step); dt -= step; }
    view.world.visible = !battle.active;
    if (battle.active) battle.update(real);
    else view.update(real);
    uiAcc += real;
    if (!battle.active && !document.hidden && !view.hasDrop() && mine.s.stats.taps >= 3) {
      dropIn -= real;
      if (dropIn <= 0) { view.spawnDrop(rollPrize()); play('whoosh', { volume: 0.5 }); dropIn = 90 + Math.random() * 60; }
    }
    if (uiAcc > 0.1) {
      base.step(Date.now());
      ui.update(uiAcc);
      bui.update();
      drawGoal();
      view.recommend = ui.isOpen() || battle.active ? null : mine.bestUpgrade();
      $('#jump').classList.toggle('on', view.deep());
      $('#hud .gems').classList.toggle('turbo-on', ui.turboLeft() > 0);
      uiAcc = 0;
    }
  });
  document.getElementById('splash')?.remove();
  if (earnedAway > 0) ui.welcome(earnedAway, awayS, (x, y) => flyTo($('#hud .coin'), x, y, '🪙', 10));
  else if (save.stats.taps === 0) ui.toast('לחץ על החדר כדי שהעובד יתחיל לעבוד');

  // dev scenes for headless screenshots: ?slot=x&scene=mid&cam=900&open=0
  if (params.get('scene') === 'mid' && mine.s.floors.length === 1) {
    base.s.cc = 4;
    mine.s.cash += 5e5;
    for (let k = 0; k < 3; k++) mine.dig();
    for (const id of ['elev', 'market', 0, 1, 2] as StageId[]) mine.hire(id);
    mine.upgrade(0, 30); mine.upgrade(1, 12); mine.upgrade('elev', 20); mine.upgrade('market', 15);
  }
  if (params.get('scene') === 'late' && mine.s.floors.length === 1) {
    base.s.cc = 7;
    mine.s.cash += 1e12;
    while (mine.dig()) { /* open every floor */ }
    for (const id of ['elev', 'market', ...mine.s.floors.map((_, i) => i)] as StageId[]) { mine.hire(id); mine.upgrade(id, 30); }
  }
  if (params.has('cam')) view.setCam(Number(params.get('cam')));
  if (params.has('tab')) bui.show(params.get('tab') as 'command' | 'raids' | 'daily');
  if (params.has('battle')) { base.step(Date.now()); setTimeout(() => bui.onBattle(base.s.camps[Number(params.get('battle')) || 0].id), 300); }
  if (params.has('open')) { const o = params.get('open')!; ui.openStage(o === 'elev' || o === 'market' ? o : Number(o)); }

  if (params.has('debug')) {
    Object.assign(window, {
      __v2: {
        mine, view, ui,
        cash: (n: number) => { mine.s.cash += n; },
        base,
        gems: (n: number) => { mine.s.gems += n; },
        reset: () => { localStorage.removeItem(KEY); location.reload(); },
        goals,
        drop: (k?: 'coins' | 'gems' | 'frenzy') => view.spawnDrop(k === 'gems' ? { kind: 'gems', amount: 2 } : k === 'frenzy' ? { kind: 'frenzy', seconds: 60 } : rollPrize()),
        skip: (s: number) => { mine.offline(s); },
      },
    });
  }
}

void start().catch(err => {
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal">המשחק לא הצליח לעלות: ${String(err?.message ?? err)}</div>`);
});
