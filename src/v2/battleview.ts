// v2 battle screen: a raider camp on the biome painting, the 3D squad running in from the right, rifle fire with muzzle
// flashes and tracers, hit puffs, the barricade and watchtower breaking, artillery the player calls by tapping.
import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { BARRAGES, BattleSim, TIME_LIMIT, type BattleSetup, type BEvent, type BUnit } from './battle.ts';
import { Worker3D, loadPeople } from './people.ts';
import { Particles, softDot } from './roomfx.ts';
import { play } from './sound.ts';
import { big, clock } from './format.ts';

const ART = `${import.meta.env.BASE_URL}art/`;
const W = 720;
/** Ground line of the battlefield layers inside their 720 x 360 frame. */
const FRAME_GROUND = 360 - 1.2 * 54;
const LANE_DY = 13;

interface Layer { x: number; y: number; w: number; h: number }
interface Fx { g: Graphics | Sprite | Text; life: number; max: number; vy?: number }

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class BattleView {
  readonly root = new Container();
  private app: Application;
  private sim: BattleSim | null = null;
  private world = new Container();
  private back = new Container();
  private props = new Container();
  private unitsLayer = new Container();
  private fxLayer = new Container();
  private parts = new Particles();
  private smoke = new Particles(false);
  private figs = new Map<number, Worker3D>();
  private bars = new Graphics();
  private tower = new Sprite(Texture.EMPTY);
  private wall = new Sprite(Texture.EMPTY);
  private layers: Record<string, Layer> = {};
  private fxs: Fx[] = [];
  private markers: { g: Graphics; at: number; x: number }[] = [];
  private gy = 600;
  private viewW = 440;
  private camX = 280;
  private scale = 1;
  private shake = 0;
  private ended = false;
  private resultSeen = false;
  private onEnd: (win: boolean) => void = () => {};
  private loot = { coins: 0, gems: 0 };
  active = false;
  /** Dev: barrages fire by themselves (?battle=N&auto) for screenshots. */
  auto = new URLSearchParams(location.search).has('auto');

  constructor(app: Application) {
    this.app = app;
    this.root.visible = false;
    this.world.addChild(this.back, this.props, this.smoke.layer, this.unitsLayer, this.bars, this.parts.layer, this.fxLayer);
    this.root.addChild(this.world);
    this.app.canvas.addEventListener('pointerdown', e => this.tap(e), { capture: true });
    $('#bretreat').addEventListener('click', () => this.finish(false));
    $('#bresult').addEventListener('click', e => {
      if (!(e.target as HTMLElement).closest('button')) return;
      $('#bresult').classList.remove('on');
      this.close();
    });
  }

  async start(setup: BattleSetup, camp: { name: string; biome: string; loot: number; gems: number }, onEnd: (win: boolean) => void): Promise<void> {
    await loadPeople('battle');
    const [bg, meta] = await Promise.all([
      Assets.load<Texture>(`${ART}biomes/${camp.biome}.webp`),
      this.layers.camp ? Promise.resolve(this.layers) : fetch(`${ART}v2/battle/layers.json`).then(r => r.json()),
    ]);
    this.layers = meta as Record<string, Layer>;
    const tex = async (n: string) => Assets.load<Texture>({ src: `${ART}v2/battle/${n}.webp`, data: { autoGenerateMipmaps: true } });
    const [campT, towerT, wallT] = await Promise.all([tex('camp'), tex('tower'), tex('wall')]);
    void tex('tower_broken');
    void tex('wall_broken');
    this.onEnd = onEnd;
    this.loot = { coins: camp.loot, gems: camp.gems };
    this.ended = false;
    this.resultSeen = false;
    this.sim = new BattleSim(setup);
    this.sim.on(e => this.onEvent(e));
    this.layout(bg, campT, towerT, wallT);
    for (const f of this.figs.values()) f.root.destroy({ children: true });
    this.figs.clear();
    this.unitsLayer.removeChildren();
    for (const u of this.sim.units) {
      const f = new Worker3D(u.side === 'us' ? u.look : 2 + u.look, 'battle');
      this.figs.set(u.id, f);
      this.unitsLayer.addChild(f.root);
    }
    this.camX = W - this.viewW + 40;
    this.root.visible = true;
    this.active = true;
    document.body.classList.add('in-battle');
    $('#bname').textContent = camp.name;
    $('#battle').classList.add('on');
    play('depart', { volume: 0.7 });
    play('siren', { volume: 0.25 });
  }

  private layout(bg: Texture, campT: Texture, towerT: Texture, wallT: Texture): void {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    // zoomed in: about 440 units across, the camera follows the front line
    this.scale = sw / Math.min(W, 440);
    const H = sh / this.scale;
    this.world.scale.set(this.scale);
    this.viewW = sw / this.scale;
    this.gy = Math.round(H * 0.62);
    this.back.removeChildren();
    this.props.removeChildren();
    const paintW = W * 1.9;
    const paintH = (paintW / bg.width) * bg.height;
    const py = this.gy - paintH * 0.78;
    const sky = new Graphics().rect(-40, -40, W + 80, py + 40).fill(0x4a3d2e);
    const ground = new Graphics().rect(-40, py + paintH - 2, W + 80, H - py - paintH + 80).fill(0x2a2117);
    const paint = new Sprite(bg);
    paint.width = paintW;
    paint.height = paintH;
    paint.position.set(-(paintW - W) / 2, py);
    const fadeTop = new Graphics().rect(-40, py, W + 80, 60).fill({ color: 0x4a3d2e, alpha: 0.5 });
    const fadeBottom = new Graphics();
    for (let k = 0; k < 10; k++) fadeBottom.rect(-40, py + paintH - 90 + k * 9, W + 80, 9).fill({ color: 0x2a2117, alpha: k / 10 });
    this.back.addChild(sky, paint, fadeTop, ground, fadeBottom);
    const place = (s: Sprite, t: Texture, name: string) => {
      const L = this.layers[name];
      s.texture = t;
      s.position.set(L.x, this.gy - FRAME_GROUND + L.y);
      s.width = L.w;
      s.height = L.h;
    };
    const campS = new Sprite();
    place(campS, campT, 'camp');
    place(this.tower, towerT, 'tower');
    place(this.wall, wallT, 'wall');
    const shadow = new Graphics().ellipse(150, this.gy + 6, 190, 18).fill({ color: 0x000000, alpha: 0.35 });
    this.props.addChild(shadow, campS, this.tower, this.wall);
  }

  private feet(x: number, lane: number): [number, number] { return [x, this.gy + 18 - lane * LANE_DY]; }

  private onEvent(e: BEvent): void {
    if (e.kind === 'shot') {
      const dir = e.side === 'us' ? -1 : 1;
      const [fx, fy] = e.from === 'tower' ? [e.x0, this.gy - 230] : this.feet(e.x0, e.lane0);
      const mx = fx + dir * 34;
      const my = e.from === 'tower' ? fy : fy - 58;
      const [tx0, ty0] = this.feet(e.x1, e.lane1);
      const tx = tx0 + (Math.random() - 0.5) * 16;
      const ty = (e.lane1 === 1 && e.side === 'us' && !this.sim!.wall.broken) ? this.gy - 40 - Math.random() * 30 : ty0 - 45 - Math.random() * 20;
      const flash = new Sprite(softDot());
      flash.anchor.set(0.5);
      flash.tint = 0xffd27a;
      flash.blendMode = 'add';
      flash.position.set(mx, my);
      flash.width = flash.height = 26;
      const tr = new Graphics().moveTo(mx, my).lineTo(e.hit ? tx : tx + dir * 40, e.hit ? ty : ty - 20).stroke({ width: 2, color: 0xffe9a0, alpha: 0.8 });
      tr.blendMode = 'add';
      this.fxLayer.addChild(tr, flash);
      this.fxs.push({ g: flash, life: 0.06, max: 0.06 }, { g: tr, life: 0.07, max: 0.07 });
      if (e.hit) {
        for (let k = 0; k < 4; k++) this.parts.spawn({ x: tx, y: ty, vx: (Math.random() - 0.5) * 80, vy: -Math.random() * 60, life: 0.35, size: 6, color: 0xffd080, g: 200 });
        this.smoke.spawn({ x: tx, y: ty, vy: -12, life: 0.7, size: 14, color: 0xb09a80, alpha: 0.35, grow: 30 });
        if (e.dmg > 0 && Math.random() < 0.35) this.floatText(`-${big(e.dmg)}`, tx, ty - 10, e.side === 'us' ? 0xffd36b : 0xff8070);
      }
      play('shot', { volume: e.from === 'tower' ? 0.35 : 0.2, rate: (e.from === 'tower' ? 0.7 : 0.9) + Math.random() * 0.25, minGapMs: 35 });
    } else if (e.kind === 'incoming') {
      const g = new Graphics();
      this.fxLayer.addChild(g);
      this.markers.push({ g, at: e.at, x: e.x });
      play('whistle', { volume: 0.5 });
    } else if (e.kind === 'boom') {
      this.explode(e.x, this.gy + 4, 1);
    } else if (e.kind === 'break') {
      const s = e.struct === 'tower' ? this.tower : this.wall;
      const L = this.layers[`${e.struct}_broken`];
      void Assets.load<Texture>(`${ART}v2/battle/${e.struct}_broken.webp`).then(t => {
        s.texture = t;
        s.position.set(L.x, this.gy - FRAME_GROUND + L.y);
        s.width = L.w;
        s.height = L.h;
      });
      this.explode(e.struct === 'tower' ? 150 : 282, this.gy - (e.struct === 'tower' ? 90 : 20), 1.6);
      play('crumble', { volume: 0.8 });
    } else if (e.kind === 'death') {
      play('punch', { volume: 0.35, rate: 0.7 });
    }
  }

  private explode(x: number, y: number, size: number): void {
    const flash = new Sprite(softDot());
    flash.anchor.set(0.5);
    flash.blendMode = 'add';
    flash.tint = 0xffc070;
    flash.position.set(x, y - 30);
    flash.width = flash.height = 260 * size;
    this.fxLayer.addChild(flash);
    this.fxs.push({ g: flash, life: 0.25, max: 0.25 });
    for (let k = 0; k < 26 * size; k++) {
      const a = -Math.PI * Math.random();
      const v = 80 + Math.random() * 260;
      this.parts.spawn({ x, y: y - 10, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.5, size: 10 + Math.random() * 16, color: Math.random() < 0.5 ? 0xff7a20 : 0xffc050, g: 300, drag: 1.5 });
    }
    for (let k = 0; k < 10 * size; k++) this.smoke.spawn({ x: x + (Math.random() - 0.5) * 60, y: y - 20, vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 40, life: 2.2, size: 40, color: 0x3a342e, alpha: 0.55, grow: 50 });
    for (let k = 0; k < 8; k++) this.parts.spawn({ x, y, vx: (Math.random() - 0.5) * 300, vy: -150 - Math.random() * 200, life: 1, size: 5, color: 0x5a4a38, g: 600 });
    const crater = new Graphics().ellipse(x, y + 6, 46 * size, 9 * size).fill({ color: 0x120e0a, alpha: 0.55 });
    this.back.addChild(crater);
    this.shake = 0.35 * size;
    play('boom', { volume: 0.9, rate: 0.9 + Math.random() * 0.2 });
  }

  private floatText(t: string, x: number, y: number, color: number): void {
    const txt = new Text({ text: t, style: { fontFamily: 'Rubik, sans-serif', fontSize: 20, fontWeight: '800', fill: color, stroke: { color: 0x000000, width: 4 } } });
    txt.anchor.set(0.5);
    txt.position.set(x, y);
    this.fxLayer.addChild(txt);
    this.fxs.push({ g: txt, life: 0.9, max: 0.9, vy: -50 });
  }

  private tap(e: PointerEvent): void {
    if (!this.active || !this.sim || this.ended) return;
    e.stopImmediatePropagation();
    const r = this.app.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / this.scale + this.camX;
    if (x > 430) { play('error', { volume: 0.3 }); return; }
    if (this.sim.barrage(Math.max(40, x))) play('click', { volume: 0.5 });
    else play('error', { volume: 0.3 });
  }

  private finish(win: boolean): void {
    if (this.ended || !this.sim) return;
    this.ended = true;
    $('#battle').classList.remove('on');
    const el = $('#bresult');
    el.innerHTML = `<div class="card ${win ? 'win' : 'lose'}"><h2>${win ? 'ניצחון!' : 'נסיגה'}</h2>
      <p>${win ? 'המחנה נכבש. החוליה חוזרת עם השלל' : 'החוליה נסוגה. שדרגו את הנשקייה, או השתמשו בהפגזות על המתרס'}</p>
      ${win ? `<div class="amount">🪙 ${big(this.loot.coins)} &nbsp; 💎 ${this.loot.gems}</div>` : ''}
      <button class="go">${win ? 'אסוף' : 'חזרה'}</button></div>`;
    el.classList.add('on');
    play(win ? 'cheer' : 'powerDown', { volume: 0.8 });
    if (win) play('coin', { volume: 0.7 });
    this.onEnd(win);
  }

  private close(): void {
    this.active = false;
    this.root.visible = false;
    document.body.classList.remove('in-battle');
    for (const f of this.fxs) f.g.destroy();
    this.fxs = [];
    for (const m of this.markers) m.g.destroy();
    this.markers = [];
  }

  update(dt: number): void {
    if (!this.active || !this.sim) return;
    const sim = this.sim;
    if (!this.ended) {
      if (this.auto) sim.autoBarrage();
      let left = Math.min(dt, 0.1);
      while (left > 0) { const s = Math.min(left, 0.033); sim.step(s); left -= s; }
      if (sim.result && !this.resultSeen) { this.resultSeen = true; setTimeout(() => this.finish(sim.result === 'win'), 900); }
      $('#btime').textContent = clock(Math.max(0, TIME_LIMIT - sim.time));
      $('#bbarrage').textContent = `💥 ${sim.barrages}/${BARRAGES}`;
      $('#bbarrage').classList.toggle('empty', sim.barrages === 0);
    }
    const order = [...sim.units].sort((a, b) => b.lane - a.lane);
    order.forEach((u, i) => {
      const f = this.figs.get(u.id)!;
      const [x, y] = this.feet(u.x, u.lane);
      f.update(dt, x, y, u.state === 'dead' ? 'die' : u.state === 'run' ? 'run' : 'aim', u.side === 'them');
      this.unitsLayer.setChildIndex(f.root, i);
      if (u.state === 'dead') f.root.alpha = Math.max(0.55, 1 - (sim.time - u.deadAt) * 0.3);
    });
    this.drawBars(sim.units);
    for (const m of this.markers) {
      const left = m.at - sim.time;
      m.g.clear();
      if (left > 0) {
        const r = 30 + 40 * left;
        m.g.ellipse(m.x, this.gy + 6, r, r * 0.22).stroke({ width: 3, color: 0xff4030, alpha: 0.9 }).ellipse(m.x, this.gy + 6, 8, 3).fill(0xff4030);
      }
    }
    for (let i = this.fxs.length - 1; i >= 0; i--) {
      const f = this.fxs[i];
      f.life -= dt;
      f.g.alpha = Math.max(0, f.life / f.max);
      if (f.vy) f.g.y += f.vy * dt;
      if (f.life <= 0) { f.g.destroy(); this.fxs.splice(i, 1); }
    }
    this.parts.update(dt);
    this.smoke.update(dt);
    // camera: keep the front line (our lead soldier and what it shoots at) in view
    const us = sim.units.filter(u => u.side === 'us' && u.state !== 'dead');
    const lead = us.length ? Math.min(...us.map(u => u.x)) : 400;
    const foe = !sim.wall.broken ? 300 : Math.max(...sim.units.filter(u => u.side === 'them' && u.state !== 'dead').map(u => u.x), sim.tower.broken ? lead - 200 : 150);
    const want = Math.max(-60, Math.min(W + 60 - this.viewW, (lead + foe) / 2 - this.viewW / 2));
    this.camX += (want - this.camX) * Math.min(1, dt * 1.5);
    let sx = 0;
    let sy = 0;
    if (this.shake > 0) {
      this.shake -= dt;
      sx = (Math.random() - 0.5) * 14 * this.shake;
      sy = (Math.random() - 0.5) * 14 * this.shake;
    }
    this.world.position.set(-this.camX * this.scale + sx, sy);
  }

  private drawBars(units: BUnit[]): void {
    const g = this.bars.clear();
    for (const u of units) {
      if (u.state === 'dead') continue;
      const [x, y] = this.feet(u.x, u.lane);
      const w = 34;
      g.rect(x - w / 2, y - 112, w, 5).fill({ color: 0x000000, alpha: 0.6 })
        .rect(x - w / 2, y - 112, w * (u.hp / u.max), 5).fill(u.side === 'us' ? 0x6fe06f : 0xff5a40);
    }
    const sim = this.sim!;
    for (const s of [sim.wall, sim.tower]) {
      if (s.broken) continue;
      const x = s.kind === 'tower' ? 150 : 282;
      const y = s.kind === 'tower' ? this.gy - 310 : this.gy - 90;
      g.rect(x - 50, y, 100, 8).fill({ color: 0x000000, alpha: 0.65 }).rect(x - 50, y, 100 * (s.hp / s.max), 8).fill(0xff9a40);
    }
  }
}
