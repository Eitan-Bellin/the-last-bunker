// v2 juice: supply crates that parachute into view (tap to open), coins and gems that fly into the HUD counters,
// and the big moments (a milestone, a new floor, a goal) as a pop of text and a burst of sparks.
import { Container, Graphics, Text } from 'pixi.js';
import { Particles } from './roomfx.ts';

const FONT = 'Rubik, system-ui, sans-serif';

// ---------- DOM: icons flying into a HUD counter ----------

/** Flies `n` copies of `icon` from a screen point into `target` (a HUD element), then bumps it. */
export function flyTo(target: HTMLElement | null, fromX: number, fromY: number, icon: string, n = 6, onArrive?: () => void): void {
  if (!target) { onArrive?.(); return; }
  const r = target.getBoundingClientRect();
  const tx = r.left + Math.min(r.width, 60) / 2 + (document.dir === 'rtl' ? r.width - 60 : 0);
  const ty = r.top + r.height / 2;
  let arrived = 0;
  for (let k = 0; k < n; k++) {
    const el = document.createElement('div');
    el.className = 'fly';
    el.textContent = icon;
    el.style.left = `${fromX}px`;
    el.style.top = `${fromY}px`;
    document.body.appendChild(el);
    const sx = (Math.random() - 0.5) * 90;
    const sy = (Math.random() - 0.5) * 70 - 30;
    const a = el.animate([
      { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
      { transform: `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px)) scale(1.15)`, opacity: 1, offset: 0.3 },
      { transform: `translate(calc(-50% + ${tx - fromX}px), calc(-50% + ${ty - fromY}px)) scale(.7)`, opacity: 1 },
    ], { duration: 650 + k * 60, easing: 'cubic-bezier(.5,0,.75,0)', delay: k * 25 });
    a.onfinish = () => {
      el.remove();
      bump(target);
      if (++arrived === n) onArrive?.();
    };
  }
}

export function bump(el: HTMLElement | null): void {
  if (!el) return;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

// ---------- Pixi: big moments ----------

interface Pop { t: Text; life: number; max: number; vy: number }

/** Large floating words with a spark burst (drawn in world space, above everything). */
export class Celebrate {
  readonly layer = new Container();
  private sparks = new Particles(true);
  private pops: Pop[] = [];

  constructor() { this.layer.addChild(this.sparks.layer); }

  /** A burst of `n` sparks from (x, y). */
  burst(x: number, y: number, color = 0xffd36b, n = 26, speed = 260): void {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.sparks.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0.7 + Math.random() * 0.5, size: 10 + Math.random() * 14, color, drag: 2.2, g: 380 });
    }
  }

  /** Big text that pops in, rises and fades. */
  text(text: string, x: number, y: number, color = 0xffd36b, size = 64, life = 1.6): void {
    const t = new Text({ text, style: { fontFamily: FONT, fontSize: size, fontWeight: '800', fill: color, stroke: { color: 0x1a0f00, width: size / 8 }, dropShadow: { color: 0x000000, alpha: 0.6, blur: 6, distance: 4, angle: Math.PI / 2 } } });
    t.anchor.set(0.5);
    t.position.set(x, y);
    t.scale.set(0.2);
    this.layer.addChild(t);
    this.pops.push({ t, life, max: life, vy: -40 });
  }

  update(dt: number): void {
    this.sparks.update(dt);
    for (let k = this.pops.length - 1; k >= 0; k--) {
      const p = this.pops[k];
      p.life -= dt;
      const age = p.max - p.life;
      // overshoot pop: 0.2 -> 1.15 -> 1
      const s = age < 0.18 ? 0.2 + (age / 0.18) * 0.95 : age < 0.3 ? 1.15 - ((age - 0.18) / 0.12) * 0.15 : 1;
      p.t.scale.set(s);
      if (age > 0.5) p.t.y += p.vy * dt;
      p.t.alpha = Math.min(1, p.life / 0.4);
      if (p.life <= 0) { p.t.destroy(); this.pops.splice(k, 1); }
    }
  }
}

// ---------- Pixi: supply drops ----------

export type DropPrize = { kind: 'coins'; amount: number } | { kind: 'gems'; amount: number } | { kind: 'frenzy'; seconds: number };

/** A crate under a parachute: falls to a floor line, waits to be tapped, then vanishes. */
export class Drop {
  readonly root = new Container();
  private chute = new Graphics();
  private crate = new Graphics();
  private glow = new Graphics();
  private mark: Text;
  x: number;
  y: number;
  private landY: number;
  private t = 0;
  landed = false;
  gone = false;
  private wait = 0;
  private vy = 0;
  private bounced = false;
  readonly prize: DropPrize;
  /** Under a parachute from the sky (the surface), or dropped through a ceiling hatch (a floor). */
  private chuted: boolean;
  /** Dust puff when it hits the floor (the view spawns particles). */
  onLand: (x: number, y: number) => void = () => {};

  constructor(x: number, fromY: number, landY: number, prize: DropPrize, chute = true) {
    this.x = x;
    this.y = fromY;
    this.landY = landY;
    this.prize = prize;
    this.chuted = chute;
    const gold = prize.kind === 'gems';
    // canopy: olive/cream panels with rib lines, ropes down to the crate
    const W = 110;
    this.chute.moveTo(-W / 2, -120).bezierCurveTo(-W / 2, -200, W / 2, -200, W / 2, -120)
      .bezierCurveTo(W / 3, -110, W / 6, -128, 0, -118).bezierCurveTo(-W / 6, -128, -W / 3, -110, -W / 2, -120)
      .fill(gold ? 0x4aa8d8 : 0x8a9a5a).stroke({ width: 3, color: 0x2a2a1a });
    for (const fx of [-0.25, 0, 0.25]) this.chute.moveTo(fx * W, -175).lineTo(fx * W * 1.3, -122).stroke({ width: 2, color: 0x000000, alpha: 0.25 });
    this.chute.moveTo(-W / 2, -120).bezierCurveTo(-W / 2, -150, -W / 4, -178, 0, -180).lineTo(0, -150).fill({ color: 0xffffff, alpha: 0.12 });
    for (const rx of [-W / 2, -W / 6, W / 6, W / 2]) this.chute.moveTo(rx, -120).lineTo(rx * 0.25, -44).stroke({ width: 1.5, color: 0x1a1a10, alpha: 0.8 });
    // crate: planked box, metal corners
    const c = gold ? 0x2c6f9a : 0x9a6a38;
    this.crate.roundRect(-30, -46, 60, 46, 4).fill(c).stroke({ width: 3, color: 0x2a1a0c })
      .rect(-30, -31, 60, 3).fill({ color: 0x000000, alpha: 0.3 }).rect(-30, -16, 60, 3).fill({ color: 0x000000, alpha: 0.3 })
      .moveTo(-27, -43).lineTo(27, -3).stroke({ width: 4, color: 0x000000, alpha: 0.25 })
      .rect(-30, -46, 9, 9).fill(0x5a5a5a).rect(21, -46, 9, 9).fill(0x5a5a5a).rect(-30, -9, 9, 9).fill(0x5a5a5a).rect(21, -9, 9, 9).fill(0x5a5a5a)
      .rect(-28, -44, 56, 3).fill({ color: 0xffffff, alpha: 0.18 });
    this.glow.circle(0, -24, 58).fill({ color: gold ? 0x7fd8ff : 0xffd36b, alpha: 0.35 });
    this.glow.blendMode = 'add';
    this.glow.visible = false;
    this.mark = new Text({ text: prize.kind === 'gems' ? '💎' : prize.kind === 'frenzy' ? '⚡' : '!', style: { fontFamily: FONT, fontSize: 34, fontWeight: '800', fill: 0xffe9a8, stroke: { color: 0x000000, width: 5 } } });
    this.mark.anchor.set(0.5, 1);
    this.mark.position.set(0, -54);
    this.mark.visible = false;
    this.root.addChild(this.glow, this.chute, this.crate, this.mark);
    this.chute.visible = chute;
    this.root.position.set(x, fromY);
    this.root.scale.set(1.25);
  }

  /** World rectangle a tap must hit (generous, the crate is small on a phone). */
  hit(wx: number, wy: number): boolean {
    const top = this.landed ? this.y - 110 : this.y - 200;
    return Math.abs(wx - this.x) < 75 && wy > top && wy < this.y + 30;
  }

  update(dt: number): void {
    this.t += dt;
    if (!this.landed && this.chuted) {
      this.y = Math.min(this.landY, this.y + 95 * dt);
      this.root.rotation = Math.sin(this.t * 1.6) * 0.12;
      this.root.x = this.x + Math.sin(this.t * 0.9) * 14;
      if (this.y >= this.landY) { this.landed = true; this.root.rotation = 0; this.root.x = this.x; this.onLand(this.x, this.y); }
    } else if (!this.landed) {
      // free fall with one bounce, a little spin
      this.vy += 1500 * dt;
      this.y += this.vy * dt;
      this.root.rotation = this.bounced ? 0 : Math.sin(this.t * 9) * 0.08;
      if (this.y >= this.landY) {
        this.y = this.landY;
        if (!this.bounced) { this.bounced = true; this.vy = -this.vy * 0.32; this.onLand(this.x, this.y); } else { this.landed = true; this.root.rotation = 0; }
      }
    } else {
      this.wait += dt;
      // the canopy folds over and fades, the crate glows and the mark bobs
      this.chute.alpha = Math.max(0, 1 - this.wait * 1.6);
      this.chute.rotation = Math.min(1.2, this.wait * 1.5);
      this.glow.visible = true;
      this.glow.alpha = 0.55 + 0.45 * Math.sin(this.t * 5);
      this.mark.visible = true;
      this.mark.y = -54 - Math.abs(Math.sin(this.t * 4)) * 14;
      const squash = this.wait < 0.25 ? 1 - Math.sin((this.wait / 0.25) * Math.PI) * 0.18 : 1;
      this.crate.scale.set(2 - squash, squash);
      if (this.wait > 30) this.root.alpha = Math.max(0, 1 - (this.wait - 30) / 1.5);
      if (this.wait > 31.5) this.gone = true;
    }
    this.root.y = this.y;
  }
}
