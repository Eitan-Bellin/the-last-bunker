/**
 * [plan4:BL-7 wave 3] Act rooms: BL-34 componentsPlant, BL-35 alloyFoundry, BL-36 dataCenter, BL-37 forum, BL-38 seedLab (3 slots each, doc 02).
 * Same contract as roomSpecsA/B: coordinates in room units (3 slots = 138 x 100, feet at `p.yb`), `p.tier` 0 salvaged / 1 restored / 2 advanced
 * changes wear, fixtures and prop count but never the layout, signage is a pictogram only (rooms are mirrored for every second neighbour).
 * Live effects stay at or under 9 per room (the wave 1-2 maximum), so the draw-call cost per room does not grow.
 */
import type { RoomSpec } from './roomComposer';
import { mix, mute, shade } from './roomComposer';
import { WOOD, barrel, cables, chair, crate, desk, gauge, glassPane, hangingShade, lampCol, led, locker, notice, rack, screenPanel, sprout } from './roomParts';

export const SPECS_C: Record<string, RoomSpec> = {
  // ---------------------------------------------------------------- BL-34 components plant
  componentsPlant: {
    slots: 3,
    pal: { wall: 0x565c64, floor: 0x46443f, accent: 0xe0a83a, light: 0xffd8a8 },
    build(p) {
      const { yb } = p;
      const lc = lampCol(p);
      p.lamp(p.t('bulb', 'tube', 'led'), 36, 9.5, { color: lc, r: 38, flicker: p.t(0.5, 0.25, 0.1) });
      p.lamp(p.t('bulb', 'tube', 'led'), 100, 9.5, { color: lc, r: 38, flicker: p.t(0.5, 0.25, 0.1) });
      // Parts cabinet: a wall of small drawers with colour tags (salvaged: some drawers missing, mismatched tags).
      const cab = p.t(0x5a5a4e, 0x5e666c, 0x3e4a56);
      p.box(14, yb, 21, 56, cab, 3);
      const tags = [0xc8a02a, 0x5a8aa8, 0x8a4a3a, 0x5a8a5a];
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 3; c++) {
          const dx = 15.4 + c * 6.3, dy = yb - 54 + r * 7.6;
          if (p.tier === 0 && (r * 3 + c) % 7 === 3) { p.rect(dx, dy, 5.6, 6.6, 0x0c0c0c, 0.8); continue; }
          p.rectG(dx, dy, 5.6, 6.6, [[0, shade(cab, 1.2)], [1, shade(cab, 0.8)]]);
          p.rect(dx + 1.2, dy + 1, 3.2, 1.1, tags[(r + c * 2) % 4], p.t(0.6, 0.85, 0.95));
          p.rect(dx + 1.6, dy + 4.4, 2.4, 0.7, 0xc8c0a0, 0.8);
        }
      }
      // Pegboard of tools above the belt.
      p.rect(40, 25, 26, 26, 0x4a4036, 0.95);
      p.rect(40, 25, 26, 0.8, 0xffffff, 0.12);
      for (let i = 0; i < 6; i++) {
        const tx = 43 + i * 4, kind = i % 3;
        p.line(tx, 29, tx, 29 + 11 + kind * 3, 0x8a8e92, 0.9, 0.95);
        if (kind === 0) p.rect(tx - 1.2, 29, 2.4, 3.4, 0xa8382a, 0.9);
        else if (kind === 1) p.ell(tx, 29 + 14, 1.6, 1.6, 0x8a8e92);
        else p.rect(tx - 1, 29 + 14, 2, 3, 0x2a2a2c);
      }
      for (let i = 0; i < 5; i++) p.line(41, 45 + (i % 2) * 2, 65, 45 + (i % 2) * 2, 0x000000, 0.2, 0.12);
      p.rect(42, 46, 22, 1.4, 0x3a3a3a, 0.8); // the tool shelf
      p.plate(86, 24, 17, 10, 'cog', p.t(0x6a5a2a, 0x7a6428, 0x2c4660), p.t(0x1a1608, 0x1a1608, 0xc8e4ff));
      // The welding robot hanging from a ceiling rail: carriage, two arm segments, a torch.
      p.rect(66, 13.5, 36, 2.2, 0x34363a);
      p.rect(74, 12.2, 10, 5, 0x44484c);
      p.line(79, 17, 87, 33, 0x8a8e92, 2.6, 1);
      p.line(87, 33, 80, 49, 0x74787c, 2.1, 1);
      p.ell(79, 17, 2.2, 2.2, 0x2a2a2c);
      p.ell(87, 33, 2, 2, 0xe0a83a);
      p.ell(80, 49.5, 1.4, 1.4, 0x2a2a2c);
      p.line(80, 50, 79.4, 55.5, 0xd8d4c8, 0.9, 1);
      p.fx('weld', 79.4, 57, { size: 3, work: true });
      // The line: belt on four legs, with parts riding on it (more, and finished, when restored).
      for (const lx of [38, 56, 74, 92]) p.rect(lx, yb - 22, 1.6, 22, 0x3a3c40);
      p.rectG(36, yb - 27.5, 64, 5.5, [[0, 0x4a4c50], [1, 0x1e1e20]]);
      p.rect(36, yb - 27.5, 64, 0.8, 0xffffff, 0.14);
      p.fx('belt', 68, yb - 25, { w: 62, h: 2.6, rate: 1, work: true });
      const parts = p.t(4, 6, 7);
      for (let i = 0; i < parts; i++) {
        const px = 40 + i * (56 / parts) + (i % 2) * 1.5, k = i % 3;
        if (k === 0) { p.ell(px + 2, yb - 31.2, 2.4, 2.4, 0x8a8e92); p.ell(px + 2, yb - 31.2, 0.9, 0.9, 0x1a1a1a); }
        else if (k === 1) p.rect(px, yb - 33.2, 4.4, 3.8, p.t(0x7a5a38, 0x9a9488, 0xaab4be));
        else p.rect(px, yb - 32.4, 5.6, 2.8, 0x4a4c50);
        p.rect(px, yb - 33.4, 4, 0.7, 0xffffff, 0.2);
      }
      // Parts bins under the belt: open boxes of finished parts, a stack of flat trays.
      const binCol = [0x4a5a6a, 0x8a7430, 0x5a5e5a, 0x4a6a52];
      for (let i = 0; i < 4; i++) {
        const bx = 40 + i * 14.2;
        p.box(bx, yb, 11, 9 - (i % 2) * 1.5, p.t(shade(binCol[i], 0.8), binCol[i], shade(binCol[i], 1.1)), 3);
        for (let k = 0; k < 4; k++) p.ell(bx + 2.4 + k * 2.2, yb - 9.6 + (i % 2) * 1.5 + (k % 2) * 0.5, 0.9, 0.7, 0x9a9ea2, 0.9);
      }
      // The press at the end of the line: frame, piston, platen, gauge and lamps.
      p.box(102, yb, 23, 55, p.t(0x5e5a4e, 0x626a70, 0x46525c), 4);
      p.rect(106, yb - 43, 15, 8, 0x1e2024);
      p.rectG(108, yb - 36, 11, 7, [[0, 0x9a9ea2], [1, 0x4a4e52]]);
      p.rect(112, yb - 51, 3, 9, 0x8a8e92);
      p.stripes(102, yb - 14, 23, 3.4, 0xc8a02a, 0x1a1a1a, 5);
      gauge(p, 116, yb - 24, 3);
      led(p, 106, yb - 24, 0xff4a3a, { rate: 2.2, work: true });
      led(p, 110, yb - 24, 0x6aff7a, { rate: 0.8, work: true });
      p.fx('sparks', 113, yb - 29, { color: 0xffc070, size: 3.6, rate: 0.8, work: true });
      if (p.tier > 0) screenPanel(p, 52, yb - 52 + 3, 11, 7.5, p.t(0xffc070, 0xffc070, 0x6ad8ff), { band: false, work: true });
      // Floor: crates and drums (salvaged: heaps), with a hand cart.
      crate(p, 17, yb + 9, 10);
      if (p.tier === 0) {
        crate(p, 28, yb + 9, 8);
        p.stain(30, yb - 30, 10, 0x4a2a14, 0.2);
        p.streak(46, 15, 28, 0x5a3a1c, 0.35);
        p.streak(112, 15, 24, 0x5a3a1c, 0.3);
      }
      barrel(p, 126 - 4, yb + 7, 4, 10, p.t(0x5a4a38, 0x4a5a6a, 0x3a4a5a), 0xc8a02a);
      p.spot(0.27, 1, 'wrench', 0.4);
      p.spot(0.5, 1, 'type', 0.55);
      p.spot(0.84, -1, 'hammer', 0.25);
    },
  },

  // ---------------------------------------------------------------- BL-35 alloy foundry
  alloyFoundry: {
    slots: 3,
    dim: 0.06,
    pal: { wall: 0x4c4440, floor: 0x3e3a36, accent: 0xff8a30, light: 0xffb070 },
    build(p) {
      const { yb } = p;
      const lc = lampCol(p);
      p.lamp(p.t('bulb', 'tube', 'led'), 104, 9.5, { color: lc, r: 34, flicker: p.t(0.5, 0.25, 0.1) });
      // The furnace: a brick or steel body with an arched mouth full of fire, under a hood that runs up into the ceiling.
      const body = p.t(0x6a4a3a, 0x58504a, 0x4a5258);
      p.polyG([22, yb - 56, 58, yb - 56, 49, 17, 31, 17], 17, yb - 56, [[0, 0x484c52], [1, 0x6a5c52]]);
      p.poly([22, yb - 56, 29, yb - 56, 35, 17, 31, 17], 0xffffff, 0.14);
      for (const hy of [30, 44]) p.rect(24 + (hy - 17) * 0.1, hy, 32 - (hy - 17) * 0.2, 1.2, 0x000000, 0.35);
      p.soft(40, yb - 54, 17, 7, 0xff8a30, 0.28, 'lighter');
      p.box(16, yb, 44, 56, body, 5);
      if (p.tier === 0) {
        for (let r = 0; r < 9; r++) for (let c = 0; c < 8; c++) if (((r * 5 + c * 3) % 4) !== 0) p.rect(17 + c * 5.4 + (r % 2) * 2.7, yb - 55 + r * 6.1, 4.8, 5.4, shade(body, 0.7 + ((r * 7 + c * 3) % 5) * 0.12), 0.95);
        p.rect(44, yb - 38, 12, 9, 0x5a5448, 0.85);
        p.crack(24, yb - 52, 30, 0.7);
      } else {
        for (let y = yb - 48; y < yb - 4; y += 10) p.rect(17, y, 42, 1, 0x000000, 0.3);
        p.rivets(18, yb - 53, 40, 8, 0x000000, 0.4);
        if (p.tier === 2) screenPanel(p, 44, yb - 49, 11, 7, 0xff9a40, { band: false, work: true });
      }
      const mx = 36, my = yb - 20;
      p.roundRect(mx - 13, my - 17, 26, 29, 12, 0x14100e);
      p.polyG([mx - 10, my + 11, mx - 10, my - 5, mx - 5, my - 13, mx + 5, my - 13, mx + 10, my - 5, mx + 10, my + 11], my - 14, my + 11, [[0, 0xd8501a], [0.5, 0xff9a30], [1, 0xffe08a]]);
      p.ell(mx, my + 4, 7, 6, 0xfff0b8, 0.7);
      p.glow(mx, my, 24, 0xff8a30, { a: 0.95, live: true, flicker: 0.5 });
      p.fx('flame', mx, my + 3, { color: 0xffb040, size: 3, rate: 0.9, work: true });
      p.fx('haze', mx, yb - 62, { w: 30, h: 14 });
      p.fx('sparks', mx + 8, my - 2, { color: 0xffb060, size: 4, rate: 0.8, work: true });
      p.rect(mx - 15, my + 12, 30, 2.4, 0x1c1c1e);
      // The pour station: a gantry rail with a hoist and a ladle of molten metal.
      p.rect(64, 14, 42, 2.2, 0x34363a);
      p.rect(80, 12.5, 9, 5, 0x44484c);
      p.line(84.5, 17, 84.5, 33, 0x2a2a2a, 0.8);
      p.line(84.5, 17, 84.5, 33, 0x8a8e92, 0.3, 0.6);
      p.cyl(84.5, 49, 6, 14, p.t(0x4a4a46, 0x54565a, 0x62666c), 0x2a1408);
      p.ell(84.5, 35, 5, 1.6, 0xffa040);
      p.ell(84.5, 35, 3, 0.9, 0xffe8a0, 0.9);
      p.line(90, 37, 96, 43, 0x2a2a2a, 1.2, 1);
      p.glow(84.5, 36, 12, 0xff9a40, { a: 0.7, live: true, flicker: 0.4 });
      p.fx('sparks', 84.5, 36, { color: 0xffc070, size: 3, rate: 0.6, work: true });
      // Molds in a row on the floor, each with a bright channel, and a stack of cast bars.
      for (let i = 0; i < 3; i++) {
        const x = 70 + i * 13;
        p.box(x, yb + 8, 11, 5, p.t(0x3a342e, 0x34383c, 0x2c3238), 3);
        p.rect(x + 1.6, yb + 3.4, 7.8, 1.2, i === 1 ? 0xff9a40 : 0x6a4a30, i === 1 ? 0.95 : 0.8);
      }
      p.glow(83, yb + 5, 9, 0xff8a30, { a: 0.5 });
      const bar = p.t(0x8a8478, 0x9a9aa0, 0xb0b8c4);
      for (let r = 0; r < 4; r++) {
        for (let i = 0; i < 4 - r; i++) {
          const x = 108 + r * 3.1 + i * 6.2, y = yb - r * 3.2;
          p.rectG(x, y - 3, 5.8, 3, [[0, shade(bar, 1.25)], [1, shade(bar, 0.7)]]);
          p.rect(x, y - 3, 5.8, 0.5, 0xffffff, 0.3);
        }
      }
      p.shadow(116, yb + 0.5, 12, 0.35);
      p.plate(117, 30, 15, 10, 'anvil', p.t(0x6a3a1a, 0x7a421c, 0x3a3e44), p.t(0xf0c898, 0xf0c898, 0xffb878));
      // Quench trough with steam, a gauge and the tongs against the wall.
      p.box(62, yb + 9, 17, 8, 0x3a3e42, 3);
      p.rect(63.5, yb + 1.6, 14, 1.8, 0x4a6a78, 0.9);
      p.fx('steam', 70, yb, { color: 0xd8e4e8, size: 6, rate: 0.8 });
      gauge(p, 66, 40, 3);
      // Tool wall: long tongs, a skimmer and a rake hanging on a rail, a fire bucket under them.
      p.rect(92, 44, 22, 1.2, 0x3a3a3c);
      for (const [tx, len, kind] of [[95, 26, 0], [100, 30, 1], [106, 24, 2], [111, 28, 0]] as const) {
        p.line(tx, 45, tx, 45 + len, 0x2e2e30, 0.9, 1);
        p.line(tx, 45, tx, 45 + len, 0x8a8e92, 0.3, 0.5);
        if (kind === 1) p.ell(tx, 45 + len + 1, 2.4, 1.2, 0x2e2e30);
        if (kind === 2) p.rect(tx - 2, 45 + len, 4, 0.9, 0x2e2e30);
        if (kind === 0) p.line(tx, 45 + len, tx + 1.8, 45 + len + 3, 0x2e2e30, 0.8, 1);
      }
      p.cyl(98, yb + 1, 3.6, 8, 0x8a2a20);
      if (p.tier === 0) {
        p.stain(70, 40, 12, 0x000000, 0.28);
        p.streak(100, 15, 26, 0x5a3a1c, 0.35);
        barrel(p, 128, yb + 8, 4.5, 11, 0x5a4a38, 0xc8a02a);
      } else {
        led(p, 70, 40, 0xff4a3a, { rate: 1.6, work: true });
      }
      p.spot(0.22, 1, 'wrench', 0.5);
      p.spot(0.45, 1, 'hammer', 0.35);
      p.spot(0.7, -1, 'wrench', 0.7);
    },
  },

  // ---------------------------------------------------------------- BL-36 data center
  dataCenter: {
    slots: 3,
    pal: { wall: 0x3e4856, floor: 0x343a42, accent: 0x4ac8ff, light: 0xc8e4ff },
    build(p) {
      const { yb } = p;
      const cold = p.t(0xe8d8b8, 0xd8ecff, 0xbfe4ff);
      p.lamp(p.t('bulb', 'tube', 'led'), 46, 9.5, { color: cold, r: 36, flicker: p.t(0.5, 0.2, 0.06) });
      p.lamp(p.t('bulb', 'tube', 'led'), 98, 9.5, { color: cold, r: 36, flicker: p.t(0.5, 0.2, 0.06) });
      // A cable ladder across the ceiling with bundles dropping into the racks.
      p.rect(14, 21, 112, 2.6, 0x3a3e44);
      for (let x = 18; x < 124; x += 8) p.rect(x, 21, 0.8, 2.6, 0x1c1c1e, 0.6);
      cables(p, 20, 23.4, 24, 33, 3, 3);
      cables(p, 98, 23.4, 100, 33, 3, 3);
      // Server racks: four tall cabinets, rows of rack units with indicator lights; salvaged racks have empty bays and loose cabling.
      const racks = [15, 35, 90, 108];
      racks.forEach((rx, ri) => {
        const w = ri < 2 ? 19 : 17;
        p.box(rx, yb, w, 62, p.t(0x4a4e50, 0x40454c, 0x2c343e), 3);
        for (let u = 0; u < 10; u++) {
          const uy = yb - 60 + u * 5.6;
          const empty = p.tier === 0 && (u * 3 + ri * 2) % 5 === 1;
          if (empty) { p.rect(rx + 1.4, uy, w - 2.8, 4.6, 0x080a0c, 0.9); continue; }
          p.rectG(rx + 1.4, uy, w - 2.8, 4.6, [[0, shade(0x50565e, p.t(0.9, 1, 1.15))], [1, shade(0x2a2e34, 1)]]);
          p.rect(rx + 2.4, uy + 1.8, w * 0.35, 0.9, 0x0a0a0c, 0.6);
          const on = (u + ri) % 3 !== 0;
          for (let k = 0; k < 3; k++) {
            const lcol = k === 0 ? (on ? 0x5aff8a : 0x2a4a34) : k === 1 ? (u % 4 === 0 ? 0xffb040 : 0x3a6a8a) : 0x2a3a4a;
            p.ell(rx + w - 3.2 - k * 2.4, uy + 2.3, 0.6, 0.6, lcol);
          }
        }
        p.rect(rx, yb - 62, w, 1, 0xffffff, 0.14);
        p.glow(rx + w / 2, yb - 40, w * 0.7, 0x4ac8ff, { a: p.t(0.1, 0.22, 0.34) });
        // One live blinker per rack, the other lights are baked.
        led(p, rx + 3.4, yb - 57.5, ri % 2 ? 0x5aff8a : 0xffb040, { rate: 1.3 + ri * 0.5 });
      });
      if (p.tier === 0) {
        p.wire(50, yb - 40, 60, yb + 6, 8, 0x1c1c1e, 1);
        p.wire(52, yb - 30, 66, yb + 7, 10, 0x6a2a22, 1);
        p.stain(70, 36, 11, 0x000000, 0.25);
      }
      // The operator's desk in the middle: two screens, a keyboard and a chair.
      desk(p, 58, yb + 1, 28, 12, p.t(0x5a4a38, 0x4a4e54, 0x2c343c));
      screenPanel(p, 61.5, yb - 23, 10, 7.4, 0x6aff9a, { band: true, work: true, bars: true });
      screenPanel(p, 74, yb - 22.4, 9, 7, p.t(0xffc070, 0x4ac8ff, 0x4ac8ff), { band: false, work: true });
      p.rect(63, yb - 12.4, 14, 1.3, 0x1c1e22, 0.9);
      chair(p, 72, yb + 12, 1, p.t(0x5a4a3a, 0x3a3e44, 0x2c3238), 9);
      p.plate(70, 25, 16, 9, 'chip', p.t(0x2a3a4a, 0x2a4256, 0x1e3a52), 0xbfe4ff);
      // Cold air: floor vents glowing cyan between the racks, with a wisp of chilled mist (live), and an exhaust fan on the wall.
      for (const vx of [52, 88]) {
        p.rect(vx - 7, yb + 3, 14, 3, 0x14181c);
        for (let i = 0; i < 6; i++) p.rect(vx - 6 + i * 2.2, yb + 3.6, 1.2, 1.8, p.t(0x2a4a5a, 0x3a8aaa, 0x5ac8f0), 0.9);
        p.glow(vx, yb + 4, 9, 0x4ac8ff, { a: p.t(0.2, 0.4, 0.5) });
      }
      p.fx('mist', 52, yb + 2, { color: 0xc8e4f8, size: 5, rate: 0.5 });
      p.rect(60.5, 28.5, 15, 15, 0x5a6066);
      p.rect(62, 30, 12, 12, 0x1e2226);
      p.ell(68, 36, 4.8, 4.8, 0x2e343a);
      p.fx('fan', 68, 36, { size: 5, color: 0x14161a, rate: 1, work: true });
      locker(p, 112, yb + 8, 9, 14, 0x4a5258);
      p.spot(0.4, 1, 'type', 0.3);
      p.spot(0.6, 1, 'type', 0.5);
      p.spot(0.78, -1, 'inspect', 0.4);
    },
  },

  // ---------------------------------------------------------------- BL-37 citizens' forum
  forum: {
    slots: 3,
    pal: { wall: 0x6a5c4c, floor: 0x4e4438, accent: 0xa8483a, light: 0xffd8a0 },
    build(p) {
      const { yb } = p;
      const lc = lampCol(p);
      hangingShade(p, 46, 18, 0x3a3a38, lc);
      hangingShade(p, 92, 18, 0x3a3a38, lc);
      p.lamp(p.t('bulb', 'tube', 'led'), 69, 9.5, { color: lc, r: 40, flicker: p.t(0.5, 0.25, 0.1) });
      // The big banner behind the podium with the emblem, flanked by two long hanging banners.
      const cloth = mute(p.t(0x5a4438, 0x6a3e34, 0x6a3438), 0.3);
      p.poly([55, 16, 83, 16, 83, 58, 69, 62, 55, 58], cloth);
      p.rectG(55, 16, 28, 4, [[0, 0x000000, 0.35], [1, 0x000000, 0]]);
      p.rect(53, 14.4, 32, 2.2, 0x3a2a1a);
      p.plate(69, 36, 16, 11, 'columns', shade(cloth, 0.85), p.t(0xd8cfa8, 0xe8dcb0, 0xf0e4b8));
      for (const bx of [32, 106]) {
        p.poly([bx - 4, 16, bx + 4, 16, bx + 4, 50, bx, 54, bx - 4, 50], p.t(0x5a5a48, 0x4a5a58, 0x3a5058));
        p.rect(bx - 5, 14.4, 10, 1.8, 0x3a2a1a);
        p.rect(bx - 1.2, 24, 2.4, 14, p.t(0xc8b888, 0xd8c898, 0xe8d8a8), 0.7);
      }
      // The podium on a low dais, with a pitcher and a lit lectern lamp.
      p.box(58, yb + 2, 22, 5, shade(WOOD, 0.7), 3);
      p.box(63, yb - 3, 12, 21, p.t(0x6a4a30, 0x7a5a38, 0x8a6a42), 3);
      p.rect(62, yb - 24, 14, 2, shade(WOOD, 1.2));
      p.rect(64, yb - 14, 10, 0.8, 0x000000, 0.3);
      p.ell(69, yb - 8, 2, 2, mix(lc, 0xffffff, 0.3), 0.7);
      p.glow(69, yb - 26, 7, lc, { a: 0.6, live: true, flicker: 0.2 });
      p.rect(71, yb - 28, 2.2, 3.4, 0xc8c0a8);
      // Raked benches on both sides facing the podium: three tiers each. Every tier registers its seats.
      const bench = p.t(0x6a5238, 0x7a5c3c, 0x5a4a52);
      const seatCol = p.t(0x8a7a5a, 0x9a8458, 0x6a5a82);
      for (const side of [-1, 1] as const) {
        // Three steps climbing toward the side wall: the highest is drawn first so each lower step in front of it shows its top and face.
        for (let t = 2; t >= 0; t--) {
          const w = 12, h = 6 + t * 7;
          const x = side < 0 ? 14 + (2 - t) * w : 124 - w - (2 - t) * w;
          p.box(x, yb + 1, w, h, bench, 3, { shadow: t === 0, noside: true });
          p.rectG(x, yb + 1 - h, w, 1.8, [[0, shade(seatCol, 1.25)], [1, shade(seatCol, 0.8)]]);
          p.rect(x + (side < 0 ? w - 0.6 : 0), yb + 1 - h, 0.6, h, 0x000000, 0.25);
          for (let k = 1; k * 4.2 < h - 1.8; k++) p.rect(x, yb + 1 - h + 1.8 + k * 4.2, w, 0.55, 0x000000, 0.3);
          p.rect(x, yb + 1 - h + 1.8, w, 0.5, 0xffffff, 0.12);
          p.seat(x + w / 2, yb + 1 - h, side < 0 ? 1 : -1, 'sit');
        }
      }
      // A ballot box and a notice board by the door.
      p.box(81, yb + 8, 6.5, 7, p.t(0x6a5a3a, 0x6a6a68, 0x5a6a7a), 2);
      p.rect(82.4, yb - 0.4, 3.6, 0.8, 0x080808);
      notice(p, 113, 46, 8, 11);
      notice(p, 108, 52, 6, 8, 0x3a4a5a);
      if (p.tier === 0) {
        p.stain(30, 50, 10, 0x000000, 0.22);
        p.streak(90, 15, 24, 0x5a3a1c, 0.3);
        crate(p, 16, yb + 9, 8);
      } else {
        p.rect(14, yb - 33, 110, 1, mix(lc, 0xffffff, 0.2), 0.12);
      }
      p.spot(0.5, 1, undefined, 0.62);
      p.spot(0.4, 1, 'inspect', 0.7);
      p.spot(0.6, -1, undefined, 0.7);
    },
  },

  // ---------------------------------------------------------------- BL-38 seed lab
  seedLab: {
    slots: 3,
    pal: { wall: 0x56685e, floor: 0x4a4c48, accent: 0x7ad88a, light: 0xdcffe4 },
    build(p) {
      const { yb } = p;
      const lc = lampCol(p);
      p.lamp(p.t('bulb', 'tube', 'led'), 69, 9.5, { color: lc, r: 34, flicker: p.t(0.5, 0.2, 0.08) });
      const grow = p.t(0xd8a8ff, 0xe8c0ff, 0xffd0f0);
      // Left: two racks of seed trays, each shelf under its own grow light (the one place a saturated light is allowed).
      for (const [rx, rw] of [[14, 26], [43, 24]] as const) {
        const shelves = rack(p, rx, yb, rw, 62, 3, p.t(0x5a5e58, 0x666e6a, 0x7a8286));
        shelves.forEach((sy, si) => {
          p.rect(rx + 2, sy - 3.6, rw - 4, 3.2, 0x2a2018, 0.95);
          const n = Math.floor((rw - 4) / 4.4);
          for (let i = 0; i < n; i++) {
            const gx = rx + 3.4 + i * 4.4;
            p.rect(gx - 0.2, sy - 6.2, 0.6, 2.8, 0x4a7a3a);
            p.ell(gx, sy - 6.6, 1.5, 1.9, shade(0x5a8a4a, 0.85 + ((i + si) % 3) * 0.15));
            p.ell(gx + 1.4, sy - 5.2, 1.1, 1.3, shade(0x6a9a4a, 0.9));
          }
          p.rect(rx + 1.5, sy - 12.4, rw - 3, 1.2, mix(grow, 0xffffff, 0.35), 0.95);
          p.glow(rx + rw / 2, sy - 8, rw * 0.5, grow, { a: p.t(0.25, 0.4, 0.5) });
        });
        p.fx('pulse', rx + rw / 2, 40, { color: grow, w: rw * 0.8, h: 24, rate: 0.45 });
      }
      // Centre: the bench with a microscope, a centrifuge and rows of petri dishes.
      p.box(73, yb + 2, 28, 20, p.t(0x5a5648, 0x5a6266, 0x3e484e), 4);
      p.rect(72, yb - 18.4, 30, 1.8, p.t(0x6a6a5e, 0x8a9296, 0xb4bcc2));
      for (let i = 0; i < 5; i++) { p.ell(76 + i * 4.6, yb - 19.2, 1.7, 0.7, 0xc8e4d8, 0.85); p.ell(76 + i * 4.6, yb - 19.4, 1, 0.4, 0x6aa87a, 0.9); }
      p.line(92, yb - 19, 92, yb - 30, 0x2a2e30, 1.6, 1); // microscope arm
      p.line(92, yb - 30, 95.5, yb - 27, 0x2a2e30, 1.6, 1);
      p.rect(93.4, yb - 27, 3, 6, 0x3a3e40);
      p.cyl(83, yb - 19, 4, 5, p.t(0x7a7a72, 0x9aa09c, 0xc4cac8), 0xaab4b0);
      led(p, 83, yb - 25.4, 0x6aff9a, { rate: 0.9, work: true });
      // Right: the cryo cabinet (frosted door, seed vials behind it, a trickle of cold vapour) and the sequencer with its screen.
      p.box(106, yb, 19, 54, p.t(0x5a625e, 0x6a7478, 0x8a9498), 4);
      p.rect(108, yb - 49, 15, 30, 0x1a2630);
      p.rect(108, yb - 49, 15, 30, 0xcfe8f0, p.t(0.2, 0.28, 0.34));
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { p.rect(109.6 + c * 3.4, yb - 47 + r * 7, 2, 5, 0xd8d4a8, 0.7); p.rect(109.6 + c * 3.4, yb - 47 + r * 7, 2, 1, 0x7a5a3a, 0.9); }
      glassPane(p, 108, yb - 49, 15, 30, 0xcfe8f0, 0x5a6266);
      p.fx('mist', 114.5, yb - 17, { color: 0xd8ecf4, size: 4, rate: 0.6 });
      screenPanel(p, 108.5, yb - 15, 14, 8, 0x6aff9a, { band: false, work: true });
      p.icon('bio', 115.5, yb - 11, 2.6, 0x0a1e12, 0.9);
      p.plate(92, 24, 16, 10, 'leaf', p.t(0x3a4e32, 0x2c5a3a, 0x24505a), p.t(0xd8e4b8, 0xd8f0c8, 0xd0f4f0));
      // Wall clutter: a seed packet board, a sprouting jar, a stack of crates.
      for (let i = 0; i < 4; i++) p.rect(76 + i * 5, 35, 3.6, 5, [0xc8b878, 0x9ab878, 0xb88878, 0x88a8b8][i], 0.85);
      p.rect(75, 40.4, 22, 0.8, 0x3a3228, 0.9);
      sprout(p, 70, yb - 1, 1.1);
      if (p.tier === 0) {
        crate(p, 70, yb + 9, 9);
        p.stain(62, 40, 10, 0x000000, 0.2);
        p.streak(80, 15, 22, 0x5a3a1c, 0.3);
      } else if (p.tier === 2) {
        led(p, 101, yb - 12, 0x6aff9a, { rate: 0.7 });
      }
      p.spot(0.3, 1, 'tend', 0.55);
      p.spot(0.55, 1, 'type', 0.45);
      p.spot(0.84, -1, 'tend', 0.4);
    },
  },
};
