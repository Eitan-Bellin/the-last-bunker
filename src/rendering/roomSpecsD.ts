/**
 * [plan4:BL-7 wave 3] Districts drawn in code: BL-24 geothermal (a steam vent in a rock cavern) and BL-25 oldVault (a pre-war vault door and shelving).
 * A district is four slots wide (184 x 100 units) and sits at the east end of its floor; the picture is `districts/<type>-<tier>` and is shown with
 * the rough rock frame of paintedRoom (like the painted caves). The three looks follow the building's level (tier 0 raw, 1 equipped, 2 advanced).
 * The cavern shell (roomComposer.ts drawCavern) draws rock, stalactites and ground; these specs add what is special to each. No text anywhere.
 */
import type { RoomSpec } from './roomComposer';
import { mix, shade } from './roomComposer';
import { barrel, cables, crate, gauge, ladder, lampCol, led, pipeV, rack, screenPanel } from './roomParts';

export const SPECS_D: Record<string, RoomSpec> = {
  // ---------------------------------------------------------------- BL-24 geothermal vent
  geothermal: {
    slots: 4,
    district: true,
    dim: 0.04,
    pal: { wall: 0x4e423a, floor: 0x3e3430, accent: 0xff6a30, light: 0xffb070 },
    build(p) {
      const { yb, W } = p;
      const lc = lampCol(p);
      const vx = 94;
      // Worker lamps on cables from the ceiling: the lava glow lights the middle, these light the working floor on either side.
      p.lamp(p.t('bulb', 'tube', 'led'), 36, 16, { color: lc, r: 40, flicker: p.t(0.5, 0.25, 0.1) });
      p.lamp(p.t('bulb', 'tube', 'led'), 152, 16, { color: lc, r: 40, flicker: p.t(0.5, 0.25, 0.1) });
      // The vent: a crater mound with a glowing fissure; the glow is live and breathes slowly.
      p.soft(vx, yb - 26, 70, 42, 0xff5a20, 0.22, 'lighter'); // the vent's glow on the walls and ceiling
      // Stalagmites and fallen rock on both sides frame the vent.
      for (const [sx, h, w] of [[16, 22, 7], [30, 14, 5], [150, 18, 6], [166, 26, 8], [176, 12, 5]] as const) {
        p.shadow(sx, yb + 5, w, 0.35);
        p.poly([sx - w, yb + 5, sx - w * 0.3, yb + 5 - h, sx + w * 0.2, yb + 5 - h * 0.85, sx + w, yb + 5], 0x2a221e);
        p.poly([sx - w, yb + 5, sx - w * 0.3, yb + 5 - h, sx - w * 0.1, yb + 5], 0x6a5a4c, 0.7);
      }
      // The vent: a wide crater mound of dark rock with a glowing fissure.
      p.shadow(vx, yb + 2, 44, 0.55);
      p.poly([vx - 50, yb + 6, vx - 34, yb - 8, vx - 20, yb - 15, vx - 8, yb - 19, vx + 8, yb - 19, vx + 20, yb - 15, vx + 34, yb - 8, vx + 50, yb + 6], 0x2c241f);
      p.poly([vx - 50, yb + 6, vx - 34, yb - 8, vx - 20, yb - 15, vx - 8, yb - 19, vx - 4, yb - 8], 0x5a4a3e, 0.75);
      for (let i = 0; i < 18; i++) {
        const rx = vx - 44 + p.vr() * 88, ry = yb - 14 + p.vr() * 18, r = 1.6 + p.vr() * 3;
        p.ell(rx, ry, r, r * 0.7, shade(0x4a3e36, 0.5 + p.vr() * 0.8), 0.95);
        p.ell(rx - r * 0.25, ry - r * 0.3, r * 0.5, r * 0.3, 0xffffff, 0.1);
      }
      // Cracks run from the mouth down the mound, lit from inside.
      for (const [dx, len] of [[-16, 15], [-5, 18], [8, 16], [18, 13]] as const) p.line(vx + dx * 0.5, yb - 14, vx + dx * 1.6, yb - 14 + len, 0xff7a30, 0.8, p.t(0.85, 0.5, 0.4));
      p.polyG([vx - 15, yb - 17, vx + 15, yb - 17, vx + 10, yb - 9, vx - 10, yb - 9], yb - 18, yb - 9, [[0, 0xffe0a0], [0.5, 0xff8a30], [1, 0xc83a10]]);
      p.glow(vx, yb - 14, 50, 0xff7a30, { a: 0.95, live: true, flicker: 0.45 });
      p.fx('pulse', vx, yb - 14, { color: 0xff7a30, size: 30, rate: 0.35 });
      // Glowing cracks across the floor and the foot of the walls.
      for (let i = 0; i < 6; i++) {
        const cx = 20 + i * 28 + (i % 2) * 6, cy = yb + 2 + (i % 3) * 3.4;
        p.line(cx, cy, cx + 9 + p.vr() * 6, cy + 1.2 + p.vr() * 1.6, 0xff6a20, 0.7, p.t(0.8, 0.5, 0.35));
        p.glow(cx + 5, cy + 1, 7, 0xff6a20, { a: p.t(0.35, 0.22, 0.14) });
      }
      p.fx('steam', vx, yb - 18, { color: 0xe4dcd0, size: p.t(14, 12, 9), rate: p.t(1, 0.9, 0.6) });
      p.fx('steam', vx - 8, yb - 16, { color: 0xd8d0c4, size: 8, rate: 0.7 });
      if (p.tier === 0) {
        // Raw: the vent as the miners found it, a rope line to keep people back, a pick and a hand lamp.
        p.fx('steam', vx + 9, yb - 16, { color: 0xd8d0c4, size: 7, rate: 0.6 });
        p.line(58, yb + 10, 130, yb + 10, 0x6a5a3a, 0.7, 0.9);
        for (const sx of [58, 94, 130]) p.rect(sx - 0.6, yb + 4, 1.2, 8, 0x3a2a1a);
        barrel(p, 158, yb + 6, 4.5, 10, 0x4a4238, 0xc8a02a);
        crate(p, 22, yb + 9, 9);
      } else {
        // Equipped: a steel dome capping the vent with a flanged pipe to a manifold of valves, gauges and a pressure tank on each side.
        const steel = p.t(0x5a606a, 0x626a74, 0x7a848e);
        p.polyG([vx - 15, yb - 8, vx - 11, yb - 25, vx + 11, yb - 25, vx + 15, yb - 8], yb - 25, yb - 8, [[0, shade(steel, 1.3)], [1, shade(steel, 0.6)]]);
        p.rect(vx - 16, yb - 9, 32, 2.6, shade(steel, 0.7));
        p.rivets(vx - 14, yb - 22, 28, 6, 0x000000, 0.4);
        pipeV(p, vx, 20, yb - 25, steel, true);
        // manifold to the left with two gauges and a tank, to the right a heat exchanger
        p.rect(52, yb - 14, 30, 2.8, shade(steel, 0.8));
        p.rect(52, yb - 14, 30, 0.7, 0xffffff, 0.15);
        for (const gx of [58, 70]) { pipeV(p, gx, yb - 40, yb - 12, steel, false); gauge(p, gx + 5, yb - 36, 3); }
        p.cyl(40, yb + 3, 9, 34, shade(steel, 0.9), shade(steel, 1.2));
        p.stripes(31, yb - 8, 18, 3, 0xc8a02a, 0x1a1a1a, 5);
        led(p, 40, yb - 26, 0xff4a3a, { rate: 1.6, work: true });
        p.box(120, yb + 2, 30, 38, shade(steel, 0.85), 5);
        for (let i = 0; i < 7; i++) p.rect(122, yb - 36 + i * 5, 26, 0.8, 0x000000, 0.35);
        led(p, 126, yb - 8, 0x6aff7a, { rate: 0.8, work: true });
        cables(p, 82, yb - 12, 120, yb - 4, 2, 4);
        ladder(p, 158, yb + 4, 44, steel);
        if (p.tier === 2) {
          // Advanced: a turbine hall on the right, lit panels, a catwalk lamp row.
          p.box(158 - 2, yb + 3, 20, 26, 0x3e4852, 4);
          screenPanel(p, 162, yb - 22, 10, 7, 0xff9a40, { band: false, work: true });
          p.ell(168, yb - 8, 5, 5, 0x2a323a);
          p.fx('rotor', 168, yb - 8, { size: 5, color: 0xaab4be, n: 4, rate: 1.2 });
          p.line(20, 24, 164, 24, 0x2a2e34, 0.9, 1);
          for (let x = 34; x < 160; x += 26) { p.line(x, 24, x, 28, 0x2a2e34, 0.5, 1); p.ell(x, 29, 1.6, 1.1, mix(lc, 0xffffff, 0.5)); p.glow(x, 29, 6, lc, { a: 0.35 }); }
        } else {
          p.streak(60, 18, 28, 0x5a3a1c, 0.3);
        }
      }
      void W;
      p.spot(0.18, 1, 'tend', 0.5);
      p.spot(0.36, 1, 'wrench', 0.45);
      p.spot(0.66, -1, 'tend', 0.65);
      p.spot(0.84, -1, 'wrench', 0.45);
    },
  },

  // ---------------------------------------------------------------- BL-25 pre-war vault
  oldVault: {
    slots: 4,
    district: true,
    pal: { wall: 0x4c4a48, floor: 0x3c3a38, accent: 0xc8a02a, light: 0xffd8a0 },
    build(p) {
      const { yb } = p;
      const lc = lampCol(p);
      p.lamp(p.t('bulb', 'tube', 'led'), 40, 16, { color: lc, r: 42, flicker: p.t(0.5, 0.25, 0.1) });
      p.lamp(p.t('bulb', 'tube', 'led'), 144, 16, { color: lc, r: 42, flicker: p.t(0.5, 0.25, 0.1) });
      // The concrete facade the vault was built into: a slab block between the rock walls, with a plate and a ring of bolts.
      const conc = p.t(0x5a5852, 0x6a6a68, 0x7a7e84);
      p.box(60, yb + 1, 64, 70, conc, 4);
      p.rect(60, yb - 69, 64, 1, 0xffffff, 0.14);
      for (let x = 60; x < 124; x += 16) p.rect(x, yb - 69, 0.7, 70, 0x000000, 0.28);
      p.speckle(60, yb - 69, 64, 70, 0x000000, 160, 0.3, 0.7);
      p.plate(92, 29, 16, 9, 'vault', p.t(0x6a5a22, 0x7a6428, 0x3a4a5a), p.t(0x1a1608, 0x1a1608, 0xe8d8a0));
      // The door: a great round slab in a steel ring. Sealed when raw, ajar when equipped (warm light spilling out), swung open when advanced.
      const cx = 92, cy = yb - 28, R = 24;
      p.ell(cx, cy, R + 4, R + 4, 0x1c1d20);
      p.ell(cx, cy, R + 1.8, R + 1.8, 0x3a3d42);
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; p.ell(cx + Math.cos(a) * (R + 2.9), cy + Math.sin(a) * (R + 2.9), 0.9, 0.9, 0x6a6e74); }
      const open = p.t(0, 0.34, 0.74); // how far the door has swung, as a fraction of its width
      if (open > 0) {
        // The room behind: warm light, shelves and a table, then the door slab narrowed on the hinge side (foreshortened).
        p.ell(cx, cy, R, R, 0x1a1410);
        p.ell(cx + 4, cy + 3, R * 0.8, R * 0.7, mix(lc, 0x6a4a28, 0.5), p.t(0, 0.55, 0.9));
        p.rect(cx - R * 0.6, cy - 6, R * 1.2, 1.2, 0x3a2a1a, 0.9);
        p.rect(cx - R * 0.6, cy + 6, R * 1.2, 1.2, 0x3a2a1a, 0.9);
        for (let i = 0; i < 6; i++) p.rect(cx - R * 0.55 + i * 5.8, cy - 11 + (i % 2) * 12, 3.6, 4.4, [0xc8b878, 0x9a8a68, 0xb89a58][i % 3], 0.85);
        p.glow(cx + 6, cy + 2, 30, lc, { a: 0.8, live: true, flicker: 0.12 });
        p.fx('twinkle', cx + 4, cy - 2, { color: 0xffe8c0, size: 0.8 });
        p.fx('twinkle', cx - 8, cy + 8, { color: 0xffe8c0, size: 0.8 });
      }
      const dw = R * 2 * (1 - open);
      const dx0 = cx - R; // hinge on the left
      p.clip(dx0, cy - R - 1, dw + 0.1, R * 2 + 2);
      const slab = p.t(0x5a5448, 0x7a7a74, 0x9a9c9e);
      p.ell(cx - R * open, cy, R * (1 - open * 0.55) + 0.4, R, slab);
      p.unclip();
      if (open < 0.9) {
        const sx = cx - R * open;
        p.clip(dx0, cy - R - 1, dw + 0.1, R * 2 + 2);
        p.ell(sx, cy, R * (1 - open * 0.55) - 2.4, R - 2.4, shade(slab, 0.82));
        p.ell(sx, cy, R * (1 - open * 0.55) - 4, R - 4, shade(slab, 1.05), 0.55);
        // The wheel and the locking bars.
        const wx = sx + R * 0.0, wr = 8.5 * (1 - open * 0.5);
        p.ell(wx, cy, wr, 8.5, shade(slab, 0.6));
        p.ell(wx, cy, wr * 0.8, 6.9, shade(slab, 0.38));
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + 0.3;
          p.line(wx, cy, wx + Math.cos(a) * wr * 0.9, cy + Math.sin(a) * 7.6, p.t(0x8a6a2a, 0xc8a02a, 0xe8d08a), 1, 1);
        }
        p.ell(wx, cy, 2, 2, p.t(0x8a6a2a, 0xc8a02a, 0xe8d08a));
        p.line(sx - R * (1 - open * 0.55) + 4, cy, sx - 11, cy, 0x2a2a2c, 2.4, 1);
        p.line(sx + 11, cy, sx + R * (1 - open * 0.55) - 4, cy, 0x2a2a2c, 2.4, 1);
        p.unclip();
      }
      for (const hy of [-14, 0, 14]) { p.rect(dx0 - 3.4, cy + hy - 2.4, 4, 4.8, 0x2a2c30); p.rect(dx0 - 2.6, cy + hy - 1.6, 2.4, 3.2, 0x6a6e74, 0.8); }
      if (p.tier === 0) {
        p.streak(80, 20, 40, 0x5a3a1c, 0.4);
        p.streak(108, 20, 30, 0x5a3a1c, 0.35);
        p.stain(cx, cy + 8, 20, 0x2a1a0a, 0.2);
      }
      // Steel shelving along both sides: crates, strongboxes, rolls of plans. Salvaged: toppled and half empty.
      const shelf = p.t(0x5a584e, 0x626a6e, 0x76808a);
      const loads = [0x6a5a3a, 0x4a5a6a, 0x7a4a34, 0x5a6a52, 0x8a7a52];
      for (const [rx, rw] of [[14, 17], [34, 22], [136, 20], [158, 15]] as const) {
        const ys = rack(p, rx, yb, rw, 60, 3, shelf);
        ys.forEach((sy, si) => {
          let x = rx + 2;
          while (x < rx + rw - 5) {
            const bw = 4 + p.vr() * 4, bh = 3.6 + p.vr() * 3.6;
            if (p.tier === 0 && p.vr() < 0.35) { x += bw + 0.5; continue; }
            const c = loads[Math.floor(p.vr() * loads.length)];
            p.rect(x, sy - bh, bw, bh, shade(c, p.t(0.8, 1, 1.1)), 0.95);
            p.rect(x, sy - bh, bw, 0.6, 0xffffff, 0.18);
            if (p.vr() > 0.6) p.ell(x + bw / 2, sy - bh - 0.8, 1, 0.9, 0xd8cfa8, 0.9);
            x += bw + 0.4;
          }
          void si;
        });
      }
      // A drafting table with plans on the right and a safe-deposit wall of small brass drawers on the left.
      p.box(128, yb + 8, 26, 4, 0x5a4a38, 4);
      p.poly([130, yb + 1, 152, yb + 1, 154, yb - 6, 132, yb - 6], p.t(0xc8c0a0, 0xd8d0b0, 0xe0e4e8));
      p.rect(134, yb - 4, 12, 0.7, 0x3a4a6a, 0.8);
      p.rect(134, yb - 1.8, 16, 0.7, 0x3a4a6a, 0.6);
      if (p.tier > 0) {
        screenPanel(p, 140, yb - 28, 11, 7.5, p.t(0xffc070, 0xffc070, 0x6ad8ff), { band: false, work: true });
        led(p, 160, yb - 22, 0x6aff7a, { rate: 0.9 });
      }
      barrel(p, 170, yb + 7, 4.6, 10, p.t(0x5a4a38, 0x4a5a6a, 0x3a4a5a), 0xc8a02a);
      if (p.tier === 0) crate(p, 22, yb + 10, 10);
      p.spot(0.18, 1, 'inspect', 0.5);
      p.spot(0.34, 1, 'inspect', 0.65);
      p.spot(0.66, -1, 'type', 0.5);
      p.spot(0.84, -1, 'inspect', 0.4);
    },
  },
};
