// v2 battle simulation: the squad storms a raider camp (barricade, watchtower, raiders). Units run in, stop in range and
// trade shots; the barricade shields the raiders until it falls; the player has three artillery barrages. Pure logic
// with its own seeded random, so the odds shown on a camp card come from running this same battle many times.

export type Side = 'us' | 'them';
export interface BUnit { id: number; side: Side; look: number; x: number; lane: number; hp: number; max: number; dmg: number; cd: number; t: number; stopX: number; state: 'run' | 'aim' | 'dead'; deadAt: number }
export interface BStruct { kind: 'tower' | 'wall'; x: number; w: number; hp: number; max: number; dmg: number; cd: number; t: number; broken: boolean }
export type BEvent =
  | { kind: 'shot'; from: number | 'tower'; side: Side; x0: number; lane0: number; x1: number; lane1: number; hit: boolean; dmg: number }
  | { kind: 'death'; id: number }
  | { kind: 'break'; struct: 'tower' | 'wall' }
  | { kind: 'incoming'; x: number; at: number }
  | { kind: 'boom'; x: number };

export const RANGE = 300;
const SPEED = 150;
export const WALL_X = 282;
export const TOWER_X = 86;
const BARRAGE_R = 75;
export const BARRAGES = 3;
export const TIME_LIMIT = 60;

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BattleSetup { squadPower: number; squadSize: number; campPower: number; raiders: number; seed: number }

export class BattleSim {
  units: BUnit[] = [];
  wall: BStruct;
  tower: BStruct;
  time = 0;
  result: 'win' | 'lose' | null = null;
  barrages = BARRAGES;
  private pending: { x: number; at: number }[] = [];
  private rnd: () => number;
  private listeners: ((e: BEvent) => void)[] = [];
  private P: number;
  /** Each side's luck this battle (crits, cover, nerves): what makes the odds a percentage, not a certainty. */
  private luck: Record<Side, number>;

  constructor(s: BattleSetup) {
    this.rnd = mulberry(s.seed);
    const P = (this.P = s.squadPower);
    const E = s.campPower;
    this.luck = { us: 0.5 + this.rnd(), them: 0.5 + this.rnd() };
    let id = 0;
    for (let i = 0; i < s.squadSize; i++) {
      const hp = (P * 14) / s.squadSize;
      this.units.push({ id: id++, side: 'us', look: i % 2, x: 760 + i * 46 + this.rnd() * 20, lane: i % 3, hp, max: hp, dmg: (P * 1.0) / s.squadSize, cd: 0.9 + this.rnd() * 0.3, t: this.rnd(), stopX: 0, state: 'run', deadAt: 0 });
    }
    for (let i = 0; i < s.raiders; i++) {
      const hp = (E * 5) / s.raiders;
      const x = 130 + i * (110 / Math.max(1, s.raiders - 1)) + this.rnd() * 12;
      this.units.push({ id: id++, side: 'them', look: i % 2, x, lane: (i + 1) % 3, hp, max: hp, dmg: (E * 0.75) / s.raiders, cd: 1.0 + this.rnd() * 0.4, t: this.rnd(), stopX: x, state: 'aim', deadAt: 0 });
    }
    this.wall = { kind: 'wall', x: WALL_X, w: 140, hp: E * 4.5, max: E * 4.5, dmg: 0, cd: 1, t: 0, broken: false };
    this.tower = { kind: 'tower', x: TOWER_X, w: 110, hp: E * 5, max: E * 5, dmg: E * 0.9, cd: 1.6, t: 0.5, broken: false };
  }

  on(fn: (e: BEvent) => void): void { this.listeners.push(fn); }
  private emit(e: BEvent): void { for (const fn of this.listeners) fn(e); }

  alive(side: Side): BUnit[] { return this.units.filter(u => u.side === side && u.state !== 'dead'); }

  /** Calls an artillery barrage onto x (lands after 0.8 s). */
  barrage(x: number): boolean {
    if (this.barrages <= 0 || this.result) return false;
    this.barrages--;
    const at = this.time + 0.8;
    this.pending.push({ x, at });
    this.emit({ kind: 'incoming', x, at });
    return true;
  }

  private damageUnit(u: BUnit, d: number): void {
    if (u.state === 'dead') return;
    if (u.side === 'them' && !this.wall.broken) d *= 0.4; // behind cover
    u.hp -= d;
    if (u.hp <= 0) {
      u.hp = 0;
      u.state = 'dead';
      u.deadAt = this.time;
      this.emit({ kind: 'death', id: u.id });
    }
  }

  private damageStruct(s: BStruct, d: number): void {
    if (s.broken) return;
    s.hp -= d;
    if (s.hp <= 0) {
      s.hp = 0;
      s.broken = true;
      this.emit({ kind: 'break', struct: s.kind });
    }
  }

  /** The enemy target nearest to an attacker of `side` standing at x. */
  private target(side: Side, x: number): { unit?: BUnit; struct?: BStruct; x: number; lane: number } | null {
    if (side === 'us') {
      if (!this.wall.broken) return { struct: this.wall, x: this.wall.x + 50, lane: 1 };
      const raiders = this.alive('them').sort((a, b) => b.x - a.x);
      if (raiders.length) return { unit: raiders[0], x: raiders[0].x, lane: raiders[0].lane };
      if (!this.tower.broken) return { struct: this.tower, x: this.tower.x + 30, lane: 1 };
      return null;
    }
    const us = this.alive('us').filter(u => u.state === 'aim' || u.x < 720);
    if (!us.length) return null;
    const t = us.sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
    return { unit: t, x: t.x, lane: t.lane };
  }

  step(dt: number): void {
    if (this.result) return;
    this.time += dt;
    for (const u of this.units) {
      if (u.state === 'dead') continue;
      const tg = this.target(u.side, u.x);
      if (!tg) continue;
      if (u.side === 'us' && u.state === 'run') {
        const want = tg.x + RANGE - 30 - u.lane * 22;
        u.x -= SPEED * dt;
        if (u.x <= want) { u.x = Math.max(u.x, want); u.state = 'aim'; u.t = this.rnd() * 0.4; }
        continue;
      }
      // advance when the target fell back out of range
      if (u.side === 'us' && u.x - tg.x > RANGE + 10) { u.state = 'run'; continue; }
      u.t -= dt;
      if (u.t > 0) continue;
      u.t = u.cd;
      const hit = this.rnd() < 0.72;
      const d = u.dmg * u.cd * (0.4 + this.rnd() * 1.2) * this.luck[u.side];
      this.emit({ kind: 'shot', from: u.id, side: u.side, x0: u.x, lane0: u.lane, x1: tg.x, lane1: tg.lane, hit, dmg: hit ? d : 0 });
      if (hit) {
        if (tg.unit) this.damageUnit(tg.unit, d);
        else if (tg.struct) this.damageStruct(tg.struct, d);
      }
    }
    // the watchtower fires at the squad
    if (!this.tower.broken) {
      this.tower.t -= dt;
      if (this.tower.t <= 0) {
        this.tower.t = this.tower.cd;
        const tg = this.target('them', this.tower.x);
        if (tg?.unit && tg.unit.x - this.tower.x < RANGE + 160) {
          const hit = this.rnd() < 0.75;
          const d = this.tower.dmg * this.tower.cd;
          this.emit({ kind: 'shot', from: 'tower', side: 'them', x0: this.tower.x + 20, lane0: -6, x1: tg.x, lane1: tg.lane, hit, dmg: hit ? d : 0 });
          if (hit) this.damageUnit(tg.unit, d);
        }
      }
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const b = this.pending[i];
      if (b.at > this.time) continue;
      this.pending.splice(i, 1);
      this.emit({ kind: 'boom', x: b.x });
      const dmg = this.P * 1.7 * (0.6 + this.rnd() * 0.8);
      for (const u of this.units) if (u.side === 'them' && Math.abs(u.x - b.x) < BARRAGE_R) this.damageUnit(u, dmg * (u.side === 'them' && !this.wall.broken ? 2.5 : 1));
      for (const s of [this.wall, this.tower]) if (Math.abs(s.x + s.w / 2 - b.x) < BARRAGE_R + s.w / 2) this.damageStruct(s, dmg * 1.2);
    }
    if (!this.alive('them').length && this.tower.broken) this.result = 'win';
    else if (!this.alive('us').length || this.time > TIME_LIMIT) this.result = 'lose';
  }

  /** A simple player: barrages on the barricade, then on the raiders, then on the tower. */
  autoBarrage(): void {
    if (this.barrages <= 0 || this.time < 2.5 + (BARRAGES - this.barrages) * 3) return;
    const raiders = this.alive('them');
    const x = !this.wall.broken ? WALL_X + 40 : raiders.length ? raiders[0].x : TOWER_X + 50;
    this.barrage(x);
  }
}

/** Odds of winning for a typical player (auto barrages), from simulating the battle many times. */
export function estimateWin(s: Omit<BattleSetup, 'seed'>, runs = 30): number {
  let wins = 0;
  for (let k = 0; k < runs; k++) {
    const b = new BattleSim({ ...s, seed: 1000 + k * 7919 });
    while (!b.result) { b.autoBarrage(); b.step(0.1); }
    if (b.result === 'win') wins++;
  }
  return wins / runs;
}

export const squadSizeFor = (armory: number) => Math.min(7, 3 + Math.floor(armory / 2));
export const raidersFor = (campId: number) => 3 + (campId % 3);
