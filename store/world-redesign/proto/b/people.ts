import { Container, Graphics } from 'pixi.js';
import { T } from './tokens';
import { SH, ZU, key, mul, rng, sx, sy } from './iso';
import { findPath, nodeNear, nodes, pois, type Light } from './map';
import type { Lighting } from './lights';
import type { DepthSorter } from './draw';

const P = T.people;

class Survivor {
  root = new Container();
  private legL = new Graphics();
  private legR = new Graphics();
  private armL = new Graphics();
  private armR = new Graphics();
  private body = new Container();
  private face = new Graphics();
  private hairBack = new Graphics();
  path: number[] = [];
  seg = 0;
  t = 0;
  idle = 0;
  node: number;
  x = 0; y = 0; z = 0;
  phase = Math.random() * 6;
  lamp: { def: Light; ox: number; oy: number } | null = null;
  constructor(start: number, private r: () => number, i: number) {
    this.node = start;
    const n = nodes[start];
    this.x = n.x; this.y = n.y; this.z = n.z;
    const H = P.height * ZU;
    const outfit = P.outfits[i % P.outfits.length];
    const skin = P.skins[Math.floor(r() * P.skins.length)];
    const hair = P.hair[Math.floor(r() * P.hair.length)];
    const pants = mul(outfit, 0.55);
    const shadow = new Graphics().ellipse(0, 0, 9, 4.2).fill({ color: 0x000000, alpha: 0.38 });
    const legH = H * 0.42, torso = H * 0.36, headR = H * 0.115;
    this.legL.roundRect(-2, 0, 4, legH, 2).fill(mul(pants, 0.8));
    this.legR.roundRect(-2, 0, 4, legH, 2).fill(pants);
    this.legL.position.set(-2, -legH); this.legR.position.set(2, -legH);
    this.armL.roundRect(-1.6, 0, 3.2, torso * 0.85, 1.6).fill(mul(outfit, 0.7));
    this.armR.roundRect(-1.6, 0, 3.2, torso * 0.85, 1.6).fill(mul(outfit, 1.05));
    this.armL.position.set(-5, -legH - torso + 2); this.armR.position.set(5, -legH - torso + 2);
    const torsoG = new Graphics()
      .roundRect(-5.5, -legH - torso, 11, torso + 1, 4).fill(outfit)
      .rect(1.5, -legH - torso + 1, 4, torso - 1).fill({ color: mul(outfit, 0.7), alpha: 0.9 })
      .rect(-5.5, -legH - 2, 11, 2.5).fill(mul(outfit, 0.45));
    if (r() < 0.5) torsoG.roundRect(-6.5, -legH - torso + 1, 3.5, torso * 0.8, 1.5).fill(0x4a3a28); // backpack strap / pack
    const headY = -legH - torso - headR + 1;
    const head = new Graphics().circle(0, headY, headR).fill(skin).circle(1.4, headY + 0.6, headR * 0.75).fill({ color: mul(skin, 0.82), alpha: 0.6 });
    this.hairBack.circle(0, headY - 0.6, headR * 1.03).fill(hair);
    const hairTop = new Graphics().ellipse(0, headY - headR * 0.55, headR * 1.05, headR * 0.6).fill(hair);
    this.face.circle(-1.6, headY + 0.2, 0.8).fill(0x1a1410).circle(1.8, headY + 0.2, 0.8).fill(0x1a1410);
    if (i % P.headlampEvery === 0) hairTop.rect(-headR, headY - headR * 0.4, headR * 2, 1.6).fill(0x2a2a2a).circle(0, headY - headR * 0.3, 1.6).fill(0xfff2c0);
    this.body.addChild(this.armL, this.legL, this.legR, torsoG, this.armR, head, this.face, this.hairBack, hairTop);
    this.root.addChild(shadow, this.body);
    this.root.scale.set(1);
  }

  plan(): void {
    for (let tries = 0; tries < 8; tries++) {
      const p = pois[Math.floor(this.r() * pois.length)];
      const target = nodeNear(p[0], p[1], p[2]);
      if (target < 0 || target === this.node) continue;
      const path = findPath(this.node, target);
      if (path && path.length > 1) { this.path = path; this.seg = 0; this.t = 0; return; }
    }
    this.idle = 1 + this.r() * 2;
  }

  update(dt: number, slice: number): void {
    const H = P.height * ZU;
    let moving = false;
    if (this.idle > 0) {
      this.idle -= dt;
      if (this.idle <= 0) this.plan();
    } else if (this.path.length > 1) {
      const a = nodes[this.path[this.seg]], b = nodes[this.path[this.seg + 1]];
      const len = Math.hypot(b.x - a.x, b.y - a.y, (b.z - a.z) * 0.5) || 1;
      const sp = a.stair || b.stair ? P.stairSpeed : P.walkSpeed;
      this.t += (dt * sp) / len;
      if (this.t >= 1) {
        this.seg++; this.t = 0;
        this.node = b.id;
        if (this.seg >= this.path.length - 1) { this.path = []; this.idle = P.idleMin + this.r() * (P.idleMax - P.idleMin); }
      }
      const tt = Math.min(1, this.t);
      this.x = a.x + (b.x - a.x) * tt; this.y = a.y + (b.y - a.y) * tt; this.z = a.z + (b.z - a.z) * tt;
      moving = true;
      // facing: screen x direction, and back view when walking away from the camera
      const dxs = (b.x - a.x) - (b.y - a.y);
      if (Math.abs(dxs) > 0.01) this.body.scale.x = dxs > 0 ? 1 : -1;
      const away = (b.x - a.x) + (b.y - a.y) < -0.01;
      this.face.visible = !away;
      this.hairBack.visible = away;
    } else this.plan();
    if (moving) this.phase += dt * P.stepRate;
    const sw = moving ? Math.sin(this.phase) * 0.55 : 0;
    this.legL.rotation = sw; this.legR.rotation = -sw;
    this.armL.rotation = -sw * 0.8; this.armR.rotation = sw * 0.8;
    this.body.y = moving ? -Math.abs(Math.cos(this.phase)) * 1.4 : Math.sin(this.phase * 0.2) * 0.3;
    this.root.position.set(sx(this.x, this.y), sy(this.x, this.y, this.z));
    const lvl = Math.max(0, Math.min(3, Math.floor((-this.z + 0.4) / SH)));
    this.root.visible = lvl >= slice;
    if (this.lamp) {
      this.lamp.def.x = this.x + 0.15; this.lamp.def.y = this.y + 0.15; this.lamp.def.z = this.z + P.height * 0.92;
      this.lamp.def.floorZ = this.z;
    }
    void H;
  }
}

export class People {
  list: Survivor[] = [];
  private lampLights: { s: Survivor; L: ReturnType<Lighting['addLight']> }[] = [];
  constructor(private sorter: DepthSorter, lighting: Lighting) {
    const r = rng(4242);
    const starts: [number, number, number][] = [[3, 8, 14], [3, 11, 13], [1, 6, 7], [2, 8, 7], [3, 22, 13], [3, 28, 13], [0, 10, 1], [3, 17, 13], [3, 30, 16], [3, 25, 10]];
    for (let i = 0; i < P.count; i++) {
      const st = starts[i % starts.length];
      const s = new Survivor(nodeNear(st[0], st[1], st[2]), r, i);
      s.idle = r() * 2;
      this.list.push(s);
      if (i % P.headlampEvery === 0) {
        const def: Light = { x: s.x, y: s.y, z: s.z + 1, l: 3, color: 0xffe2a8, r: 1.7, i: 0.85, type: 'steady', glow: 0.12, vol: true };
        const L = lighting.addLight(def, 0);
        s.lamp = { def, ox: 0, oy: 0 };
        this.lampLights.push({ s, L });
      }
    }
  }
  update(dt: number, slice: number, lighting: Lighting): void {
    for (const s of this.list) { s.update(dt, slice); this.sorter.place(s.root, key(s.x, s.y, s.z + 0.3)); }
    for (const { s, L } of this.lampLights) {
      lighting.place(L);
      const vis = s.root.visible;
      L.pool.visible = vis; if (L.vol) L.vol.visible = vis; if (L.glow) L.glow.visible = vis; if (L.haze) L.haze.visible = vis;
    }
  }
}
