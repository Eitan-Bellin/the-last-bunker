/**
 * Light pools in deep darkness.
 * - lightRoot (off-stage, play-plane coords) is rendered into a half-res lightmap every frame:
 *   ambient colour + depth ramp + zone fills + additive point lights.
 * - The lightmap MULTIPLIES the lit layers (mid + play) inside their own render texture,
 *   so the far/back layers keep their own baked haze and are not crushed to black.
 * - glow (on stage, after lighting) adds the over-bright cores, cones, sparks and dust.
 */
import { Container, Sprite, Texture } from 'pixi.js';
import { T } from './tokens';
import type { Textures } from './textures';
import { vGradTex } from './textures';
import { lights, zones, dwellings, ROOM_H, type LightDef } from './scene';
import { rng } from './util';

export interface Dyn { x: number; y: number; on: boolean }

interface LiveLight {
  def: LightDef;
  pool: Sprite;
  core?: Sprite;
  cone?: Sprite;
  ph: number;
  dyn?: Dyn;
}

export function buildLighting(tx: Textures, meta: Record<string, { lights?: { x: number; y: number; r: number; color: number; flicker: number }[] }>) {
  const W = T.world.width, H = T.world.height;
  const lightPlay = new Container();   // goes into the lightmap
  const glow = new Container();        // additive, on stage
  const live: LiveLight[] = [];
  const r = rng(601);

  // ambient depth ramp (warm sky spill near the surface, cold black deep down)
  const ramp = new Sprite(vGradTex(T.light.ambientRamp.map(s => ({ t: s.y / H, c: s.c, a: s.a })), 512));
  ramp.x = -4000; ramp.y = 0; ramp.width = W + 8000; ramp.height = H;
  ramp.blendMode = 'add';
  lightPlay.addChild(ramp);
  const skyFill = new Sprite(Texture.WHITE);
  skyFill.tint = T.light.ambientRamp[0].c;
  skyFill.x = -4000; skyFill.y = -3000; skyFill.width = W + 8000; skyFill.height = 3000;
  lightPlay.addChild(skyFill);

  for (const z of zones) {
    const s = new Sprite(tx.lightSoft);
    s.anchor.set(0.5);
    s.x = z.x; s.y = z.y; s.width = z.w * 1.3; s.height = z.h * 1.3;
    s.tint = z.c; s.alpha = z.a; s.blendMode = 'add';
    lightPlay.addChild(s);
  }

  // painted dwellings: a fill so the art reads, plus the lamps baked into meta.json
  const allDefs: LightDef[] = [...lights];
  for (const d of dwellings) {
    const fill = new Sprite(Texture.WHITE);
    fill.x = d.x; fill.y = d.floor - ROOM_H; fill.width = d.w; fill.height = ROOM_H;
    fill.tint = T.light.roomAmbient; fill.blendMode = 'add';
    lightPlay.addChild(fill);
    const m = meta[`rooms/${d.art}`];
    for (const l of m?.lights ?? []) {
      allDefs.push({
        x: d.x + l.x * d.w, y: d.floor - ROOM_H + l.y * ROOM_H,
        r: Math.max(26, l.r * d.w * T.light.roomArtLightScale * 1.6),
        c: l.color, i: 0.6, flicker: l.flicker * 0.4, glow: 0.45,
      });
    }
  }

  const addLight = (def: LightDef, dyn?: Dyn) => {
    const pool = new Sprite(tx.light);
    pool.anchor.set(0.5);
    pool.x = def.x; pool.y = def.y;
    pool.width = pool.height = def.r * 2;
    pool.tint = def.c; pool.alpha = def.i * T.light.intensity;
    pool.blendMode = 'add';
    lightPlay.addChild(pool);
    const L: LiveLight = { def, pool, ph: r() * 100, dyn };
    if ((def.glow ?? 0) > 0) {
      const core = new Sprite(tx.light);
      core.anchor.set(0.5);
      core.x = def.x; core.y = def.y;
      const cs = Math.min(def.r * 0.55, 120);
      core.width = core.height = cs;
      core.tint = def.c; core.blendMode = 'add';
      core.alpha = (def.glow ?? 1) * T.light.glow * def.i;
      glow.addChild(core);
      L.core = core;
    }
    if (def.cone) {
      const cone = new Sprite(tx.cone);
      cone.anchor.set(0.5, 0);
      cone.x = def.x; cone.y = def.y;
      cone.height = def.cone; cone.width = def.cone * 0.9;
      cone.tint = def.c; cone.alpha = T.atmosphere.cones; cone.blendMode = 'add';
      glow.addChild(cone);
      L.cone = cone;
    }
    live.push(L);
    return L;
  };
  for (const d of allDefs) addLight(d);

  // sky god-ray down the entrance ramp
  const ray = new Sprite(tx.cone);
  ray.anchor.set(0.5, 0);
  ray.x = 2985; ray.y = 250;
  ray.rotation = Math.atan2(560 - 320, 2660 - 3040) - Math.PI / 2;
  ray.width = 260; ray.height = 560;
  ray.tint = T.light.colors.sky; ray.alpha = T.atmosphere.godRay; ray.blendMode = 'add';
  glow.addChild(ray);

  // fire: flame tongues + sparks
  const flames: Sprite[] = [];
  for (let i = 0; i < 3; i++) {
    const f = new Sprite(tx.light);
    f.anchor.set(0.5, 0.8);
    f.x = 954 + i * 6; f.y = 984;
    f.tint = i === 1 ? 0xffd070 : 0xff7a2a; f.blendMode = 'add';
    glow.addChild(f);
    flames.push(f);
  }
  const sparks: { s: Sprite; life: number; vx: number; vy: number }[] = [];
  for (let i = 0; i < T.atmosphere.sparkCount; i++) {
    const s = new Sprite(tx.lightSoft);
    s.anchor.set(0.5); s.width = s.height = 4; s.tint = 0xffa040; s.blendMode = 'add';
    glow.addChild(s);
    sparks.push({ s, life: r() * 2, vx: 0, vy: 0 });
  }
  // dust motes drifting in the lit spaces
  const dust: { s: Sprite; x: number; y: number; vx: number; vy: number; ph: number }[] = [];
  const dustZones = [[1980, 380, 680, 580], [1300, 880, 660, 80], [400, 560, 900, 460], [2650, 320, 420, 260]];
  const nd = Math.round(T.atmosphere.dustCount * T.detail.density);
  for (let i = 0; i < nd; i++) {
    const z = dustZones[i % dustZones.length];
    const s = new Sprite(tx.lightSoft);
    s.anchor.set(0.5); s.width = s.height = 2 + r() * 3;
    s.tint = 0xffe8c8; s.blendMode = 'add';
    glow.addChild(s);
    dust.push({ s, x: z[0] + r() * z[2], y: z[1] + r() * z[3], vx: (r() - 0.5) * 6, vy: (r() - 0.5) * 4, ph: r() * 9 });
  }

  const flick = (L: LiveLight, t: number) => {
    const d = L.def;
    let k = 1;
    if (d.flicker) {
      const s = T.light.flickerSpeed;
      const n = Math.sin(t * s * 1.3 + L.ph) * 0.5 + Math.sin(t * s * 2.9 + L.ph * 2) * 0.3 + Math.sin(t * s * 0.37 + L.ph) * 0.2;
      k = 1 - d.flicker * 0.35 * (0.5 + 0.5 * n);
      // the occasional brown-out on badly flickering tubes
      if (d.flicker > 0.8 && Math.sin(t * 0.9 + L.ph) > 0.93) k *= 0.25;
    }
    if (d.blink) k *= 0.25 + 0.75 * (Math.sin(t * Math.PI * 2 * d.blink) > 0 ? 1 : 0);
    return k;
  };

  return {
    lightPlay,
    glow,
    addDynamic(def: LightDef, dyn: Dyn) { return addLight(def, dyn); },
    update(t: number, dt: number) {
      for (const L of live) {
        if (L.dyn) {
          L.pool.x = L.dyn.x; L.pool.y = L.dyn.y;
          if (L.core) { L.core.x = L.dyn.x; L.core.y = L.dyn.y; }
          L.pool.visible = L.dyn.on;
          if (L.core) L.core.visible = L.dyn.on;
        }
        const k = flick(L, t);
        L.pool.alpha = L.def.i * T.light.intensity * k;
        if (L.core) L.core.alpha = (L.def.glow ?? 1) * T.light.glow * L.def.i * k;
        if (L.cone) L.cone.alpha = T.atmosphere.cones * k;
      }
      for (let i = 0; i < flames.length; i++) {
        const f = flames[i];
        const k = 0.75 + 0.25 * Math.sin(t * (11 + i * 3) + i * 2);
        f.width = 26 + 8 * Math.sin(t * 7 + i);
        f.height = (44 + i * 6) * k;
        f.alpha = 0.7 * k;
      }
      for (const p of sparks) {
        p.life -= dt;
        if (p.life <= 0) {
          p.life = 0.8 + r() * 1.6;
          p.s.x = 954 + (r() - 0.5) * 18; p.s.y = 986;
          p.vx = (r() - 0.5) * 18; p.vy = -40 - r() * 60;
        }
        p.s.x += p.vx * dt + Math.sin(t * 5 + p.life * 7) * 0.3;
        p.s.y += p.vy * dt;
        p.s.alpha = Math.min(1, p.life);
      }
      for (const d of dust) {
        d.x += (d.vx + Math.sin(t * 0.4 + d.ph) * 3) * dt;
        d.y += (d.vy + Math.cos(t * 0.3 + d.ph) * 2) * dt;
        d.s.x = d.x; d.s.y = d.y;
        d.s.alpha = T.atmosphere.dustAlpha * (0.4 + 0.6 * Math.abs(Math.sin(t * 0.7 + d.ph)));
      }
    },
  };
}
