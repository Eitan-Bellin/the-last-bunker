/**
 * View prototype (dev only, http://localhost:<port>/tools/viewproto.html): the same save drawn two ways, to choose a direction
 * before any game code changes.
 *   A "front": the bunker as a cross-section, but Fallout-Shelter-clean: big rooms, the painting, a name, ONE status dot.
 *   B "plan":  one floor at a time seen from above, picked with a lift on the side; rooms as boxes, people walking.
 * Tapping a room in either view opens the room on its own (focus), with three facts and one main action.
 * Reads the stage saves made by `node tools/playthrough.mjs` (store/playthrough/saves). Changes nothing.
 */
import type { BuildingInstance, BuildingType, GameState } from '../src/core/GameState';
import { getDef, roomSlots } from '../src/data/buildingDefs';
import { buildCategoryOf, type BuildCategory } from '../src/data/buildCategories';

const STAGES = ['d1', 'd4', 'd10', 'd35'];
const ART = new Set(['armory', 'canteen', 'farm', 'generator', 'hydroponics', 'laboratory', 'medbay', 'quarters', 'radioTower', 'reactor', 'storage', 'trainingRoom', 'waterPump', 'waterPurifier', 'workshop']);
const GLYPH: Record<BuildCategory, string> = { living: '🛏', food: '🌾', power: '⚡', industry: '🔧', health: '✚', defense: '🛡', surface: '☀', infra: '📦', trade: '🛒', act: '★' };
const $ = (id: string) => document.getElementById(id)!;
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

let state: GameState;
let mode: 'front' | 'plan' = 'front';
let stage = 'd10';
let planFloor = 0;

const short = (n: number) => (n < 1000 ? String(Math.floor(n)) : n < 1e6 ? `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K` : `${(n / 1e6).toFixed(1)}M`);
const nameOf = (t: BuildingType) => getDef(t)?.name.he ?? t;
const tierOf = (b: BuildingInstance) => (b.level >= 7 ? 2 : b.level >= 4 ? 1 : 0);
const artOf = (b: BuildingInstance) => (ART.has(b.type) ? `/art/rooms/${b.type}-${tierOf(b)}.webp` : null);
function status(b: BuildingInstance): { color: string; text: string } {
  if (b.isConstructing) return { color: css('--warn'), text: 'בבנייה' };
  const max = getDef(b.type)?.maxWorkers ?? 0;
  if (max > 0 && b.assignedSurvivorIds.length === 0) return { color: css('--bad'), text: 'אין עובדים' };
  if (max > 0 && b.assignedSurvivorIds.length < max) return { color: css('--warn'), text: 'חסרים עובדים' };
  return { color: css('--ok'), text: 'עובד' };
}

async function load(name: string): Promise<void> {
  const raw = await fetch(`/store/playthrough/saves/${name}-seed1.json`).then(r => r.json());
  state = (raw.state ?? raw) as GameState;
  stage = name;
  render();
}

function top(): void {
  const r = state.resources;
  const items: [string, string, boolean][] = [
    ['🍲', short(r.food.amount), r.food.amount < 50], ['💧', short(r.water.amount), r.water.amount < 50],
    ['⚡', short(r.power.amount), r.power.amount < 20], ['🧱', short(r.materials.amount), false],
    ['👥', `${state.survivors.length}`, false],
  ];
  $('top').innerHTML = items.map(([i, v, low]) => `<div class="chip${low ? ' low' : ''}"><small>${i}</small>${v}</div>`).join('');
  $('saves').innerHTML = STAGES.map(s => `<button class="${s === stage ? 'on' : ''}" data-s="${s}">יום ${s.slice(1)}</button>`).join('');
  $('modes').innerHTML = `<button class="${mode === 'front' ? 'on' : ''}" data-m="front">חזית נקייה</button><button class="${mode === 'plan' ? 'on' : ''}" data-m="plan">קומה מלמעלה</button>`;
  $('note').textContent = mode === 'front'
    ? 'אותו חתך, אבל כל חדר גדול: ציור, שם ונקודת מצב אחת. גוללים לצדדים ולמטה. לחיצה על חדר פותחת אותו.'
    : 'קומה אחת בכל פעם, מלמעלה. בוחרים קומה במעלית בצד. לחיצה על חדר פותחת אותו.';
}

// ---- A: the clean front view -------------------------------------------------------------------------------------------------
const SLOT = 64;
function front(): void {
  const rooms = state.buildings.filter(b => b.position.floor >= 0);
  const floors = Math.max(...rooms.map(b => b.position.floor)) + 1;
  const width = Math.max(...rooms.map(b => b.position.x + roomSlots(b.type))) * SLOT + 24;
  const tower = document.createElement('div');
  tower.className = 'tower';
  tower.style.width = `${width}px`;
  for (let f = 0; f < floors; f++) {
    const row = document.createElement('div');
    row.className = 'floor';
    row.innerHTML = `<span class="floor-tag">B${f + 1}</span>`;
    for (const b of rooms.filter(r => r.position.floor === f)) {
      const el = document.createElement('div');
      const art = artOf(b);
      const st = status(b);
      el.className = `room${art ? '' : ' flat'}`;
      el.style.insetInlineStart = `${12 + b.position.x * SLOT}px`;
      el.style.width = `${roomSlots(b.type) * SLOT - 8}px`;
      if (art) el.style.backgroundImage = `url(${art})`;
      else { el.style.background = `linear-gradient(${css(`--${buildCategoryOf(b.type)}`)}, #1a1a1a)`; el.textContent = GLYPH[buildCategoryOf(b.type)]; }
      el.insertAdjacentHTML('beforeend', `<span class="dot" style="background:${st.color}"></span><span class="name">${nameOf(b.type)}</span><span class="who">${b.assignedSurvivorIds.length ? `👤 ${b.assignedSurvivorIds.length}` : ''}</span>`);
      el.onclick = () => focus(b);
      row.appendChild(el);
    }
    tower.appendChild(row);
  }
  $('stage').replaceChildren(tower);
}

// ---- B: one floor seen from above ----------------------------------------------------------------------------------------------
const P_SLOT = 52, P_DEPTH = 150, P_HALL = 34, P_PAD = 16;
interface Walker { x: number; y: number; tx: number; ty: number; room: BuildingInstance }
let walkers: Walker[] = [];
let raf = 0;
function plan(): void {
  const floors = Math.max(...state.buildings.map(b => b.position.floor)) + 1;
  const wrap = document.createElement('div');
  wrap.className = 'plan-wrap';
  const lift = document.createElement('div');
  lift.className = 'lift';
  for (let f = 0; f < floors; f++) {
    const btn = document.createElement('button');
    btn.textContent = `B${f + 1}`;
    if (f === planFloor) btn.className = 'on';
    btn.onclick = () => { planFloor = f; render(); };
    lift.appendChild(btn);
  }
  const holder = document.createElement('div');
  holder.className = 'plan';
  const rooms = state.buildings.filter(b => b.position.floor === planFloor);
  const slots = Math.max(16, ...rooms.map(b => b.position.x + roomSlots(b.type)));
  const cv = document.createElement('canvas');
  const W = slots * P_SLOT + P_PAD * 2, H = P_DEPTH + P_HALL + P_PAD * 2 + 40;
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = `${W}px`; cv.style.height = `${H}px`;
  const g = cv.getContext('2d')!;
  g.scale(dpr, dpr);
  const box = (b: BuildingInstance) => ({ x: P_PAD + b.position.x * P_SLOT + 3, y: P_PAD + 20, w: roomSlots(b.type) * P_SLOT - 6, h: P_DEPTH });
  walkers = [];
  for (const b of rooms) {
    const r = box(b);
    for (let i = 0; i < b.assignedSurvivorIds.length; i++) {
      const x = r.x + 12 + Math.random() * (r.w - 24), y = r.y + 30 + Math.random() * (r.h - 50);
      walkers.push({ x, y, tx: x, ty: y, room: b });
    }
  }
  const draw = () => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = css('--rock'); g.fillRect(0, 0, W, H);
    // the corridor every room opens onto
    g.fillStyle = '#26241f'; g.fillRect(P_PAD, P_PAD + 20 + P_DEPTH + 6, W - P_PAD * 2, P_HALL);
    g.strokeStyle = '#3a372f'; g.setLineDash([10, 8]); g.beginPath(); g.moveTo(P_PAD, P_PAD + 20 + P_DEPTH + 6 + P_HALL / 2); g.lineTo(W - P_PAD, P_PAD + 20 + P_DEPTH + 6 + P_HALL / 2); g.stroke(); g.setLineDash([]);
    g.fillStyle = css('--muted'); g.font = '700 14px Assistant, system-ui'; g.textAlign = 'start'; g.fillText(`קומה B${planFloor + 1}`, P_PAD, P_PAD + 8);
    for (const b of rooms) {
      const r = box(b);
      const cat = buildCategoryOf(b.type);
      // floor of the room (tiles), walls, a door gap to the corridor
      g.fillStyle = css(`--${cat}`); g.globalAlpha = 0.28; g.fillRect(r.x, r.y, r.w, r.h); g.globalAlpha = 1;
      g.strokeStyle = '#0006'; g.lineWidth = 1;
      for (let tx = r.x; tx < r.x + r.w; tx += 16) { g.beginPath(); g.moveTo(tx, r.y); g.lineTo(tx, r.y + r.h); g.stroke(); }
      for (let ty = r.y; ty < r.y + r.h; ty += 16) { g.beginPath(); g.moveTo(r.x, ty); g.lineTo(r.x + r.w, ty); g.stroke(); }
      g.strokeStyle = css(`--${cat}`); g.lineWidth = 4; g.strokeRect(r.x, r.y, r.w, r.h);
      g.fillStyle = css('--rock'); g.fillRect(r.x + r.w / 2 - 12, r.y + r.h - 3, 24, 8);
      g.font = '26px system-ui'; g.textAlign = 'center'; g.fillStyle = css('--fg'); g.fillText(GLYPH[cat], r.x + r.w / 2, r.y + r.h / 2);
      g.font = '700 13px Assistant, system-ui'; g.fillText(nameOf(b.type), r.x + r.w / 2, r.y + 18);
      const st = status(b);
      g.fillStyle = st.color; g.beginPath(); g.arc(r.x + r.w - 10, r.y + 10, 6, 0, Math.PI * 2); g.fill();
    }
    for (const w of walkers) {
      if (Math.hypot(w.tx - w.x, w.ty - w.y) < 1) {
        const r = box(w.room);
        w.tx = r.x + 12 + Math.random() * (r.w - 24); w.ty = r.y + 30 + Math.random() * (r.h - 50);
      }
      w.x += (w.tx - w.x) * 0.02; w.y += (w.ty - w.y) * 0.02;
      g.fillStyle = '#f2e6c9'; g.beginPath(); g.arc(w.x, w.y, 5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#000a'; g.lineWidth = 1.5; g.stroke();
    }
    raf = requestAnimationFrame(draw);
  };
  cancelAnimationFrame(raf);
  draw();
  cv.onclick = (e) => {
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const hit = rooms.find(b => { const r = box(b); return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; });
    if (hit) focus(hit);
  };
  holder.appendChild(cv);
  wrap.append(lift, holder);
  $('stage').replaceChildren(wrap);
}

// ---- the room on its own -------------------------------------------------------------------------------------------------------
function focus(b: BuildingInstance): void {
  const def = getDef(b.type);
  const st = status(b);
  const art = artOf(b);
  const prod = def?.production ? Object.entries(def.production).map(([r, v]) => `${r} +${(v.base + v.perLevel * (b.level - 1)).toFixed(1)}/ש׳`).join(' · ') : '—';
  const el = $('focus');
  el.innerHTML = `<button class="close" aria-label="סגירה">✕</button>
    <div class="art" style="${art ? `background-image:url(${art})` : `background:linear-gradient(${css(`--${buildCategoryOf(b.type)}`)}, #111)`}"></div>
    <div class="body">
      <h2>${nameOf(b.type)}</h2>
      <div class="facts">
        <div class="fact"><b>${b.level}</b>רמה</div>
        <div class="fact"><b>${b.assignedSurvivorIds.length}/${def?.maxWorkers ?? 0}</b>עובדים</div>
        <div class="fact"><b style="color:${st.color}">●</b>${st.text}</div>
      </div>
      <div class="note" style="padding:0">${prod}</div>
      <button class="main">${st.text === 'עובד' ? 'שדרגו' : 'שבצו עובדים'}</button>
    </div>`;
  el.classList.add('on');
  (el.querySelector('.close') as HTMLElement).onclick = () => el.classList.remove('on');
}

function render(): void {
  top();
  cancelAnimationFrame(raf);
  if (mode === 'front') front(); else plan();
}

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.dataset.s) void load(t.dataset.s);
  if (t.dataset.m) { mode = t.dataset.m as typeof mode; render(); }
});
const q = new URLSearchParams(location.search);
if (q.get('mode') === 'plan') mode = 'plan';
planFloor = Number(q.get('floor') ?? 0);
void load(q.get('stage') ?? 'd10').then(() => { const i = Number(q.get('focus') ?? -1); if (i >= 0) focus(state.buildings.filter(b => b.position.floor >= 0)[i]); });
