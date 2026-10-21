// v2 entry: load the mine save (its own key, the classic game's save is never touched), credit time away, run the loop.
import './v2.css';
import { Mine, newSave, type MineSave, type StageId } from './mine.ts';
import { MineUI } from './ui.ts';
import { MineView } from './view.ts';
import { play, unlockAudio } from './sound.ts';
import { FLOORS } from './econ.ts';

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
const mine = new Mine(save);
const awayS = (Date.now() - save.savedAt) / 1000;
const earnedAway = awayS > 30 ? mine.offline(awayS) : 0;

function persist(): void {
  mine.s.savedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(mine.s)); } catch { /* storage full: keep playing */ }
}

const view = new MineView(mine);
const ui = new MineUI(mine);

async function start(): Promise<void> {
  await document.fonts.load('700 20px Rubik').catch(() => null);
  view.topInset = 64;
  await view.init(document.getElementById('stage')!);
  view.onOpen = id => ui.openStage(id);
  view.onTap = (id: StageId) => {
    if (mine.tap(id)) play(id === 'elev' ? 'elevator' : 'click', { volume: id === 'elev' ? 0.35 : 0.6, minGapMs: 120 });
  };
  view.onDig = () => {
    const c = mine.digCost();
    if (c === null) return;
    if (mine.dig()) {
      play('dig');
      setTimeout(() => play('unlock'), 350);
      ui.toast(`נפתחה קומה ${mine.s.floors.length}: ${FLOORS[mine.s.floors.length - 1].name}`);
      persist();
    } else {
      play('error', { volume: 0.4 });
      ui.toast('אין מספיק מטבעות עדיין');
    }
  };
  mine.on(e => {
    if (e.kind === 'sell') play('coin', { volume: 0.35, rate: 1 + Math.random() * 0.15, minGapMs: 90 });
    else if (e.kind === 'unload') play('collect', { volume: 0.3, minGapMs: 200 });
  });
  window.addEventListener('pointerdown', () => unlockAudio(), { capture: true });

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); persist(); return; }
    const gap = (Date.now() - hiddenAt) / 1000;
    if (hiddenAt && gap > 5) {
      const got = mine.offline(gap);
      if (got > 0 && gap > 60) ui.welcome(got, gap, () => {});
    }
  });
  window.addEventListener('pagehide', persist);
  setInterval(persist, 5000);

  let uiAcc = 0;
  view.app.ticker.add(t => {
    let dt = Math.min(t.deltaMS / 1000, 0.25);
    const real = dt;
    while (dt > 0) { const step = Math.min(dt, 0.05); mine.step(step); dt -= step; }
    view.update(real);
    uiAcc += real;
    if (uiAcc > 0.1) { ui.update(uiAcc); uiAcc = 0; }
  });
  document.getElementById('splash')?.remove();
  if (earnedAway > 0) ui.welcome(earnedAway, awayS, () => {});
  else if (save.stats.taps === 0) ui.toast('לחץ על החדר כדי שהעובד יתחיל לעבוד');

  // dev scenes for headless screenshots: ?slot=x&scene=mid&cam=900&open=0
  if (params.get('scene') === 'mid' && mine.s.floors.length === 1) {
    mine.s.cash += 5e5;
    for (let k = 0; k < 3; k++) mine.dig();
    for (const id of ['elev', 'market', 0, 1, 2] as StageId[]) mine.hire(id);
    mine.upgrade(0, 30); mine.upgrade(1, 12); mine.upgrade('elev', 20); mine.upgrade('market', 15);
  }
  if (params.get('scene') === 'late' && mine.s.floors.length === 1) {
    mine.s.cash += 1e12;
    while (mine.dig()) { /* open every floor */ }
    for (const id of ['elev', 'market', ...mine.s.floors.map((_, i) => i)] as StageId[]) { mine.hire(id); mine.upgrade(id, 30); }
  }
  if (params.has('cam')) view.setCam(Number(params.get('cam')));
  if (params.has('open')) { const o = params.get('open')!; ui.openStage(o === 'elev' || o === 'market' ? o : Number(o)); }

  if (params.has('debug')) {
    Object.assign(window, {
      __v2: {
        mine, view, ui,
        cash: (n: number) => { mine.s.cash += n; },
        reset: () => { localStorage.removeItem(KEY); location.reload(); },
        skip: (s: number) => { mine.offline(s); },
      },
    });
  }
}

void start().catch(err => {
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal">המשחק לא הצליח לעלות: ${String(err?.message ?? err)}</div>`);
});
