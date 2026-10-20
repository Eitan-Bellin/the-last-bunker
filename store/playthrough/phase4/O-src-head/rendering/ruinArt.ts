import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Ruin } from '../core/GameState';
import { glowTexture, moteTexture } from '../art/ArtLibrary';
import { ROOM_H } from './layout';
import { hGradient, shade, vGradient } from './draw';

export interface RuinVisual {
  container: Container;
  animate: (t: number, dt: number, working: boolean) => void;
}

const WATER_Y = ROOM_H - 30;

/** Code-drawn fallback: a dark gutted room with a rubble heap. */
function drawFallback(g: Graphics, W: number, rnd: () => number, kind: Ruin['kind']): void {
  g.rect(0, 0, W, ROOM_H).fill(vGradient([[0, 0x2a2b2e], [1, 0x17181a]]));
  for (let x = 10; x < W; x += 22) g.rect(x, 0, 1, ROOM_H).fill({ color: 0x000000, alpha: 0.3 });
  g.rect(0, ROOM_H - 10, W, 10).fill(0x232325);
  if (kind === 'flooded') return;
  const heapW = W * (kind === 'collapsed' ? 0.8 : 0.55);
  const cx = W * (0.35 + rnd() * 0.3);
  const pts: number[] = [cx - heapW / 2, ROOM_H - 6];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    const h = Math.sin(k * Math.PI) * (kind === 'collapsed' ? 46 : 26) * (0.8 + rnd() * 0.4);
    pts.push(cx - heapW / 2 + heapW * k, ROOM_H - 6 - h);
  }
  pts.push(cx + heapW / 2, ROOM_H - 6);
  g.poly(pts).fill(0x46443f);
  for (let i = 0; i < 14; i++) {
    const x = cx - heapW / 2 + rnd() * heapW;
    const y = ROOM_H - 10 - rnd() * 30;
    g.poly([x, y, x + 5 + rnd() * 6, y - 3, x + 8, y + 4, x + 2, y + 5]).fill(shade(0x6a665e, 0.7 + rnd() * 0.5));
  }
  if (kind === 'collapsed') {
    g.poly([W * 0.15, 8, W * 0.2, 4, W * 0.75, ROOM_H - 30, W * 0.7, ROOM_H - 26]).fill(0x5a4636);
    g.poly([W * 0.3, 0, W * 0.6, 0, W * 0.5, 14, W * 0.38, 10]).fill(0x0c0c0d);
  }
}

/** Yellow-black hazard tape sagging across the opening of an untouched ruin. */
function hazardTape(W: number): Graphics {
  const g = new Graphics();
  const y0 = ROOM_H * 0.46;
  const sag = 6;
  const segs = Math.ceil(W / 8);
  for (let i = 0; i < segs; i++) {
    const x = i * 8;
    const k = x / W;
    const y = y0 + Math.sin(k * Math.PI) * sag;
    g.poly([x, y, x + 8, y + 0.4, x + 8, y + 6.4, x, y + 6]).fill(i % 2 ? 0x1a1a1a : 0xe8b52a);
  }
  return g;
}

/**
 * A ruined stretch of floor: painting (or fallback) sunk in gloom, hazard tape until work starts,
 * live floodwater, and once a crew is in, a work lamp and dust kicked up by the clearing.
 */
export function buildRuinVisual(ruin: Ruin, W: number, texture: Texture | null, darkenTexture: boolean, rnd: () => number): RuinVisual {
  const container = new Container();
  if (texture) {
    const art = new Sprite(texture);
    art.width = W;
    art.height = ROOM_H;
    if (darkenTexture) art.tint = 0x6a6660;
    container.addChild(art);
  } else {
    const g = new Graphics();
    drawFallback(g, W, rnd, ruin.kind);
    container.addChild(g);
  }

  // Gloom: these spaces have had no light for years.
  const gloom = new Graphics();
  gloom.rect(0, 0, W, ROOM_H).fill({ color: 0x05060a, alpha: darkenTexture ? 0.38 : texture ? 0.1 : 0.3 });
  gloom.rect(0, 0, 16, ROOM_H).fill(hGradient([[0, 0x000000, 0.6], [1, 0x000000, 0]]));
  gloom.rect(W - 16, 0, 16, ROOM_H).fill(hGradient([[0, 0x000000, 0], [1, 0x000000, 0.6]]));
  gloom.rect(0, 0, W, 14).fill(vGradient([[0, 0x000000, 0.6], [1, 0x000000, 0]]));
  container.addChild(gloom);

  let water: Graphics | null = null;
  if (ruin.flooded) {
    water = new Graphics();
    container.addChild(water);
  }

  const lamp = new Sprite(glowTexture());
  lamp.anchor.set(0.5);
  lamp.tint = 0xffc777;
  lamp.blendMode = 'add';
  lamp.width = W * 1.1;
  lamp.height = ROOM_H * 1.1;
  lamp.position.set(W / 2, ROOM_H * 0.35);
  lamp.alpha = 0;
  container.addChild(lamp);

  const tape = ruin.started ? null : hazardTape(W);
  if (tape) container.addChild(tape);

  const dust = new Container();
  container.addChild(dust);
  const motes: { s: Sprite; vx: number; vy: number; life: number }[] = [];
  let acc = 0;

  const frame = new Graphics();
  frame.rect(0, 0, 3, ROOM_H).fill(0x1f2023);
  frame.rect(W - 3, 0, 3, ROOM_H).fill(0x1f2023);
  container.addChild(frame);

  return {
    container,
    animate: (t, dt, working) => {
      if (water) {
        const level = WATER_Y + (working ? 3 : 0);
        water.clear();
        const pts: number[] = [0, ROOM_H];
        for (let x = 0; x <= W; x += 6) pts.push(x, level + Math.sin(x * 0.18 + t * 1.6) * 1.2 + Math.sin(x * 0.07 - t * 0.9) * 0.8);
        pts.push(W, ROOM_H);
        water.poly(pts).fill({ color: 0x0f2a2e, alpha: 0.82 });
        for (let x = 4; x < W; x += 14) {
          const y = level + Math.sin(x * 0.18 + t * 1.6) * 1.2;
          water.rect(x, y - 0.5, 6 + Math.sin(t * 2 + x) * 2, 1).fill({ color: 0x8fd0d8, alpha: 0.35 });
        }
      }
      const target = working ? 0.55 + 0.08 * Math.sin(t * 9) * Math.sin(t * 3.7) : 0;
      lamp.alpha += (target - lamp.alpha) * Math.min(1, dt * 4);
      if (working) {
        acc += dt * 6;
        while (acc >= 1 && motes.length < 30) {
          acc -= 1;
          const s = new Sprite(moteTexture());
          s.anchor.set(0.5);
          s.tint = 0xb8ad98;
          s.scale.set(0.3 + rnd() * 0.5);
          s.position.set(W * (0.2 + rnd() * 0.6), ROOM_H - 14 - rnd() * 20);
          dust.addChild(s);
          motes.push({ s, vx: (rnd() - 0.5) * 12, vy: -4 - rnd() * 10, life: 0 });
        }
      }
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i];
        m.life += dt;
        m.s.x += m.vx * dt;
        m.s.y += m.vy * dt;
        m.s.scale.set(m.s.scale.x + dt * 0.4);
        m.s.alpha = Math.max(0, 0.35 * (1 - m.life / 2.2));
        if (m.life > 2.2) {
          m.s.destroy();
          motes.splice(i, 1);
        }
      }
    },
  };
}
