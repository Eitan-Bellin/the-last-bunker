// v2 base screens: the bottom bar (mine / command / raids), the Command Center panel (level, builders, armory, walls),
// the raid map (camp cards, the squad on its way, the bunker's defense) and battle reports.
import { BUILDER_GEMS, CC_FLOORS, CC_LVL_CAP, CC_MAX, CC_BONUS, MAX_BUILDERS, defCap, squadPower, wallPower, type Base, type Job, type Report } from './base.ts';
import { FLOORS } from './econ.ts';
import { big, clock } from './format.ts';
import type { Mine } from './mine.ts';
import { TASK_TEXT, type Daily } from './daily.ts';
import { POINT_BONUS, PRESTIGE_MIN_CC, canRebirth, pointsFor } from './prestige.ts';
import { play } from './sound.ts';

type Tab = 'mine' | 'command' | 'raids' | 'daily';
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const ART = `${import.meta.env.BASE_URL}art/`;

const JOB_NAME: Record<Job['kind'], (j: Job) => string> = {
  dig: j => `חופרים קומה ${j.target + 1}: ${FLOORS[j.target]?.name ?? ''}`,
  cc: j => `מפקדה ← רמה ${j.target}`,
  armory: j => `נשקייה ← רמה ${j.target}`,
  walls: j => `חומות ← רמה ${j.target}`,
};

export class BaseUI {
  private mine: Mine;
  private base: Base;
  private tab: Tab = 'mine';
  private panel = $('#panel');
  private lastKey = '';
  onToast: (t: string) => void = () => {};
  onBattle: (campId: number) => void = () => {};
  onRebirth: () => void = () => {};
  private confirmRebirth = false;

  private daily: Daily;

  constructor(mine: Mine, base: Base, daily: Daily) {
    this.mine = mine;
    this.base = base;
    this.daily = daily;
    $('#nav').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.tab) this.show(b.dataset.tab as Tab);
    });
    this.panel.addEventListener('click', e => this.onClick(e));
    $('#report').addEventListener('click', e => {
      if ((e.target as HTMLElement).closest('button')) this.nextReport();
    });
  }

  show(tab: Tab): void {
    if (tab === this.tab) tab = 'mine';
    this.tab = tab;
    play('tab', { volume: 0.5 });
    document.querySelectorAll<HTMLButtonElement>('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    this.panel.classList.toggle('on', tab !== 'mine');
    this.lastKey = '';
    this.render();
  }

  /** Called ~10 times a second. */
  update(): void {
    const now = Date.now();
    const b = this.base.s;
    $('#gems').textContent = String(this.mine.s.gems);
    const next = [...b.jobs].sort((x, y) => x.endAt - y.endAt)[0];
    $('#builders').textContent = `👷 ${this.base.freeBuilders()}/${b.builders}${next ? ` · ${clock((next.endAt - now) / 1000)}` : ''}`;
    $('#nav [data-tab="command"]').classList.toggle('dot', this.base.freeBuilders() > 0 && (this.base.ccCost() ?? Infinity) <= this.mine.s.cash);
    this.daily.update(now);
    $('#nav [data-tab="daily"]').classList.toggle('dot', this.daily.claimable() > 0);
    $('#nav [data-tab="raids"]').classList.toggle('dot', (!b.squad || b.squad.returnAt <= now) && b.camps.some(c => c.respawnAt === null && this.base.chance(c) > 0.6));
    if (this.tab !== 'mine') this.render();
    if (!$('#report').classList.contains('on') && this.base.unseen().length) this.nextReport();
  }

  private nextReport(): void {
    const el = $('#report');
    const r = this.base.unseen().pop();
    if (!r) { el.classList.remove('on'); return; }
    r.seen = true;
    el.innerHTML = this.reportCard(r);
    el.classList.add('on');
    play(r.win ? 'cheer' : r.kind === 'defense' ? 'siren' : 'error', { volume: 0.7 });
  }

  private reportCard(r: Report): string {
    const title = r.kind === 'attack' ? (r.win ? 'ניצחון!' : 'החוליה נסוגה') : (r.win ? 'הדפתם את הפושטים!' : 'פושטים פרצו לבונקר');
    const body = r.kind === 'attack'
      ? (r.win ? `החוליה כבשה את ${r.camp} וחזרה עם שלל` : `${r.camp} היה חזק מדי. שדרגו את הנשקייה ונסו שוב`)
      : (r.win ? 'החומות החזיקו. הפושטים ברחו' : `הם לקחו 🪙 ${big(r.lost)}. חומות חזקות יותר יעצרו אותם`);
    return `<div class="card ${r.win ? 'win' : 'lose'}"><h2>${title}</h2><p>${body}</p>
      ${r.win && (r.loot || r.gems) ? `<div class="amount">${r.loot ? `🪙 ${big(r.loot)}` : ''} ${r.gems ? `💎 ${r.gems}` : ''}</div>` : ''}
      <button class="go">המשך</button></div>`;
  }

  private render(): void {
    const now = Date.now();
    const html = this.tab === 'command' ? this.commandHtml(now) : this.tab === 'raids' ? this.raidsHtml(now) : this.tab === 'daily' ? this.dailyHtml(now) : '';
    const key = html;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.panel.innerHTML = html;
  }

  private jobRow(j: Job, now: number): string {
    const p = Math.min(1, (now - j.startAt) / Math.max(1, j.endAt - j.startAt));
    return `<div class="job"><div class="jt"><b>${JOB_NAME[j.kind](j)}</b><small>${clock((j.endAt - now) / 1000)}</small></div>
      <div class="bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div>
      <button class="rush" data-rush="${j.kind}">💎 ${this.base.rushGems(j, now)} סיים עכשיו</button></div>`;
  }

  private commandHtml(now: number): string {
    const b = this.base.s;
    const cash = this.mine.s.cash;
    const cc = b.cc;
    const ccCost = this.base.ccCost();
    const ccJob = this.base.busy('cc');
    const nextLines = cc < CC_MAX ? [
      CC_FLOORS[cc + 1] > CC_FLOORS[cc] ? `קומה ${CC_FLOORS[cc + 1]} נפתחת לחפירה` : '',
      CC_LVL_CAP[cc + 1] > CC_LVL_CAP[cc] ? `תקרת שדרוג ${CC_LVL_CAP[cc + 1]}` : '',
      CC_BONUS[cc + 1] > CC_BONUS[cc] ? `בונוס מכירה +${Math.round(CC_BONUS[cc + 1] * 100)}%` : '',
      `נשקייה וחומות עד רמה ${defCap(cc + 1)}`,
    ].filter(Boolean) : [];
    const free = this.base.freeBuilders() > 0;
    const def = (kind: 'armory' | 'walls', title: string, icon: string, pow: (l: number) => number) => {
      const lvl = b[kind];
      const c = this.base.defCost(kind);
      const job = this.base.busy(kind);
      return `<div class="row"><div class="ic">${icon}</div><div class="rt"><b>${title} · רמה ${lvl}</b>
        <small>כוח ${big(pow(lvl))}${c !== null ? ` ← ${big(pow(lvl + 1))}` : ''}</small></div>
        ${job ? `<span class="busy">בבנייה · ${clock((job.endAt - now) / 1000)}</span>`
          : c === null ? `<span class="busy">דרושה מפקדה ${Math.floor((lvl - 1) / 2) + 1}</span>`
          : `<button class="buy" data-def="${kind}" ${c <= cash && free ? '' : 'disabled'}>🪙 ${big(c)} · ⏱ ${clock(this.base.defTime(kind))}</button>`}</div>`;
    };
    const bg = this.base.builderGems();
    return `<div class="phead"><h2>מפקדה</h2><small>הלב של הבונקר: כל רמה פותחת קומות ומעלה את תקרת השדרוג</small></div>
      <div class="cc">
        <div class="cclvl"><span>רמה</span><b>${cc}</b><span>מתוך ${CC_MAX}</span></div>
        <div class="ccnext">${ccJob ? `<b>משדרגים לרמה ${ccJob.target}…</b>` : cc < CC_MAX ? `<b>ברמה ${cc + 1}:</b><ul>${nextLines.map(l => `<li>${l}</li>`).join('')}</ul>` : '<b>רמה מקסימלית</b>'}
          ${!ccJob && ccCost !== null ? `<button class="buy big" data-cc="1" ${ccCost <= cash && free ? '' : 'disabled'}>שדרג · 🪙 ${big(ccCost)} · ⏱ ${clock(this.base.ccTime())}</button>` : ''}
        </div>
      </div>
      <h3>בנאים ${this.base.freeBuilders()}/${b.builders}</h3>
      ${b.jobs.length ? b.jobs.map(j => this.jobRow(j, now)).join('') : '<p class="muted">כל הבנאים פנויים</p>'}
      ${bg !== null ? `<button class="buy" data-builder="1" ${bg <= this.mine.s.gems ? '' : 'disabled'}>👷 בנאי נוסף · 💎 ${bg}</button>` : ''}
      <h3>הגנה ותקיפה</h3>
      ${def('armory', 'נשקייה', '⚔️', squadPower)}
      ${def('walls', 'חומות', '🧱', wallPower)}
      ${this.rebirthHtml()}
      <p class="muted classic"><a href="./classic.html">למשחק הקלאסי (השמירה הישנה) ←</a></p>`;
  }

  private dailyHtml(now: number): string {
    const d = this.daily;
    const end = new Date(now);
    end.setUTCHours(24, 0, 0, 0);
    const rows = d.s.tasks.map((t, i) => {
      const done = t.progress >= t.target;
      return `<div class="job"><div class="jt"><b>${TASK_TEXT[t.kind](big(t.target))}</b><small>${big(t.progress)}/${big(t.target)}</small></div>
        <div class="bar"><i style="width:${(100 * t.progress / t.target).toFixed(1)}%"></i></div>
        ${t.claimed ? '<span class="busy">✓ נאסף</span>' : `<button class="buy" data-claim="${i}" ${done ? '' : 'disabled'}>אסוף · 💎 ${t.gems}</button>`}</div>`;
    }).join('');
    const ready = d.chestReady();
    return `<div class="phead"><h2>משימות היום</h2><small>משימות חדשות בעוד ${clock((end.getTime() - now) / 1000)}</small></div>
      ${rows}
      <div class="chest ${ready ? 'ready' : ''}"><div class="ic">🎁</div><div class="rt"><b>תיבת היום</b><small>סיימו את שלוש המשימות: 💎 15 + 🪙 ${big(d.chestCoins())}</small></div>
        ${d.s.chest ? '<span class="busy">✓ נפתחה</span>' : `<button class="buy" data-chest="1" ${ready ? '' : 'disabled'}>פתח</button>`}</div>`;
  }

  private rebirthHtml(): string {
    const s = this.mine.s;
    const p = s.prestige ?? { count: 0, points: 0, lifetime: 0 };
    const gain = pointsFor(s.stats.earned);
    const ok = canRebirth(s);
    const pct = (n: number) => `${Math.round(n * POINT_BONUS * 100)}%`;
    return `<h3>בונקר חדש ${p.count ? `· הבונקר ה-${p.count + 1}` : ''}</h3>
      <div class="rebirth">
        <p>מתחילים מכרה חדש מאפס, עם בונוס קבוע לכל המכירות. נשמרים: יהלומים, בנאים והבונוס.</p>
        <div class="rb"><span>הבונוס היום</span><b>+${pct(p.points)}</b></div>
        <div class="rb"><span>בונקר חדש עכשיו ייתן</span><b class="up">+${pct(gain)}</b></div>
        ${this.confirmRebirth && ok
          ? `<div class="confirm"><b>בטוח? המכרה, המפקדה והמטבעות יתאפסו.</b><div class="cb"><button class="buy" data-rebirth="yes">כן, בונקר חדש</button><button class="rush" data-rebirth="no">ביטול</button></div></div>`
          : `<button class="buy big" data-rebirth="ask" ${ok ? '' : 'disabled'}>${ok ? `🏗️ הקם בונקר חדש · +${pct(gain)}` : s.base && s.base.cc < PRESTIGE_MIN_CC ? `נפתח במפקדה רמה ${PRESTIGE_MIN_CC}` : 'הרוויחו עוד כדי לקבל בונוס'}</button>`}
      </div>`;
  }

  private raidsHtml(now: number): string {
    const b = this.base.s;
    const q = b.squad;
    const camps = b.camps.map(c => {
      const ch = this.base.chance(c);
      const resting = !!q && q.returnAt > now;
      const beaten = c.respawnAt !== null;
      return `<div class="camp ${beaten ? 'beaten' : ''}" style="background-image:url(${ART}biomes/${c.biome}.webp)">
        <div class="cshade"></div>
        <div class="ctop"><b>${c.name}</b><span class="pow">⚔️ ${big(c.power)}</span></div>
        ${beaten ? `<div class="cmid">נכבש · מחנה חדש בעוד ${clock(((c.respawnAt ?? now) - now) / 1000)}</div>`
          : `<div class="cmid"><span>🪙 ${big(c.loot)}</span><span>💎 ${c.gems}</span><span class="odds ${ch > 0.66 ? 'g' : ch > 0.4 ? 'y' : 'r'}">סיכוי ${Math.round(ch * 100)}%</span></div>`}
        ${beaten ? '' : resting ? `<div class="cmid muted">החוליה נחה · ${clock((q!.returnAt - now) / 1000)}</div>` : `<button class="buy" data-attack="${c.id}">⚔️ תקוף</button>`}
      </div>`;
    }).join('');
    const nextRaid = b.cc >= 2 ? `פשיטה הבאה על הבונקר בעוד ${clock((b.nextRaidAt - now) / 1000)}` : 'פושטים יתחילו להגיע אחרי מפקדה רמה 2';
    return `<div class="phead"><h2>פשיטות</h2><small>שלחו את החוליה למחנות שודדים, חזרו עם שלל ויהלומים</small></div>
      <div class="stats"><span>⚔️ החוליה: <b>${big(this.base.power())}</b></span><span>🧱 החומות: <b>${big(this.base.defense())}</b></span></div>
      <div class="camps">${camps}</div>
      <p class="muted">${nextRaid}</p>
      ${b.reports.length ? `<h3>יומן קרבות</h3>${b.reports.slice(0, 5).map(r => `<div class="log ${r.win ? 'w' : 'l'}">${r.kind === 'attack' ? `⚔️ ${r.camp}: ${r.win ? `ניצחון +🪙${big(r.loot)} +💎${r.gems}` : 'נסיגה'}` : `🛡️ פשיטה על הבונקר: ${r.win ? 'נהדפה +💎1' : `אבדו 🪙${big(r.lost)}`}`}</div>`).join('')}` : ''}`;
  }

  private onClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    const now = Date.now();
    let ok = false;
    let msg = '';
    if (btn.dataset.claim) {
      const ok2 = this.daily.claim(Number(btn.dataset.claim));
      play(ok2 ? 'coin' : 'error', { volume: 0.8 });
      this.lastKey = '';
      this.render();
      return;
    }
    if (btn.dataset.chest) {
      const ok2 = this.daily.openChest();
      play(ok2 ? 'achievement' : 'error', { volume: 0.9 });
      if (ok2) this.onToast('תיבת היום נפתחה! 💎 15');
      this.lastKey = '';
      this.render();
      return;
    }
    if (btn.dataset.rebirth) {
      if (btn.dataset.rebirth === 'yes') { play('levelup'); this.onRebirth(); return; }
      this.confirmRebirth = btn.dataset.rebirth === 'ask';
      play('click', { volume: 0.5 });
      this.lastKey = '';
      this.render();
      return;
    }
    if (btn.dataset.cc) { ok = this.base.startCC(now); msg = 'הבנאים התחילו לשדרג את המפקדה'; }
    else if (btn.dataset.def) { ok = this.base.startDef(btn.dataset.def as 'armory' | 'walls', now); msg = 'הבנייה התחילה'; }
    else if (btn.dataset.builder) { ok = this.base.hireBuilder(); msg = 'בנאי חדש הצטרף'; }
    else if (btn.dataset.rush) {
      const j = this.base.busy(btn.dataset.rush as Job['kind']);
      ok = !!j && this.base.rush(j, now);
    } else if (btn.dataset.attack) {
      const id = Number(btn.dataset.attack);
      if (this.base.canAttack(id, now)) { this.onBattle(id); return; }
    }
    play(ok ? (btn.dataset.attack ? 'depart' : btn.dataset.rush ? 'complete' : 'build') : 'error', { volume: ok ? 0.8 : 0.4 });
    if (ok && msg) this.onToast(msg);
    this.lastKey = '';
    this.render();
  }
}

export { BUILDER_GEMS, MAX_BUILDERS };
