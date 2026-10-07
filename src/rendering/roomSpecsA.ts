/**
 * [plan4:BL-7 track A] Wave 1 room specs: the eight rooms of BL-9..14, 19 and 33 (batteryBank, commons, library, recycler, condenser,
 * mushroomFarm, gatePost, barracks). Coordinates are room units (2 slots = 92 wide, 3 slots = 138, 100 high), feet at `p.yb`.
 * Every spec reads `p.tier` (0 salvaged, 1 restored, 2 advanced): same layout, different wear, fixtures, palette and prop count.
 */
import type { RoomSpec } from './roomComposer';
import { mix, shade } from './roomComposer';
import {
  STEEL, WOOD, barrel, blastDoor, bookshelf, bunk, cables, chair, crate, desk, gauge, glassPane, ladder, lampCol, led, locker, notice,
  pipeV, rack, sandbags, screenPanel, sprout, stringLights,
} from './roomParts';

export const SPECS_A: Record<string, RoomSpec> = {
  // ---------------------------------------------------------------- BL-9 battery bank
  batteryBank: {
    slots: 2,
    pal: { wall: 0x4a5668, floor: 0x58554e, accent: 0x5ac8ff, light: 0xc8ecff },
    build(p) {
      const { yb } = p;
      p.lamp(p.t('bulb', 'tube', 'led'), 46, 9.5, { color: lampCol(p), r: 36, flicker: p.t(0.5, 0.25, 0.1) });
      p.plate(46, 24, 19, 11.5, 'bolt', p.t(0x66561e, 0x6e5e22, 0x244058), p.t(0x1a1608, 0x1a1608, 0xbfe8ff));
      const cellCol = [0x34444e, 0x4a4a3a, 0x3a3a3c, 0x32483a];
      if (p.tier < 2) {
        // Two racks of cells: salvaged = mismatched car batteries, restored = a matching bank with labelled ends.
        for (const [rx, rw] of [[14, 28], [44, 24]] as const) {
          const shelves = rack(p, rx, yb, rw, 56, 3);
          for (const sy of shelves) {
            const n = Math.floor((rw - 3) / 4.8);
            for (let i = 0; i < n; i++) {
              const cx = rx + 1.8 + i * 4.8;
              const col = p.tier === 0 ? cellCol[(i + Math.round(sy)) % cellCol.length] : 0x2c4258;
              if (p.tier === 0 && p.vr() < 0.12) continue; // a gap where a cell was pulled
              const ch = p.tier === 0 ? 10 + p.vr() * 3 : 12;
              p.box(cx, sy, 4.2, ch, col, 1.6, { shadow: false });
              p.rect(cx + 0.7, sy - ch - 0.9, 0.9, 0.9, 0xb8a888, 0.9);
              p.rect(cx + 2.6, sy - ch - 0.9, 0.9, 0.9, 0xb8a888, 0.9);
              if (p.tier === 1) p.rect(cx + 0.5, sy - ch * 0.55, 3.2, 1.3, 0x5ac8ff, 0.55);
              if (p.tier === 0 && p.vr() < 0.2) p.streak(cx + 2, sy - 2, 9, 0x8a8a3a, 0.4); // leaking acid
            }
            p.rect(rx + 1.5, sy - 13.2, rw - 3, 0.9, 0x9a6a38, 0.9); // copper bus bar
          }
          led(p, rx + rw - 3, yb - 55, 0x5ae0c0, { rate: 0.9 });
          led(p, rx + 3, yb - 55, p.tier === 0 ? 0xe0a040 : 0x5ae0c0, { rate: 1.6 });
        }
      } else {
        // Advanced: three sealed modular cabinets with bar-graph charge meters.
        for (const mx of [14, 31, 48]) {
          p.box(mx, yb, 15.5, 54, 0x2c3238, 3);
          p.rect(mx + 1.2, yb - 52, 13.1, 1, 0x000000, 0.4);
          screenPanel(p, mx + 2.4, yb - 48, 10.6, 7.5, 0x5ae0ff, { bars: true });
          for (let r = 0; r < 4; r++) p.rect(mx + 2.4, yb - 36 + r * 6.5, 10.6, 4.6, 0x1c2024);
          for (let r = 0; r < 4; r++) p.rect(mx + 3, yb - 35 + r * 6.5, 9.4 * (0.55 + 0.4 * ((mx + r * 3) % 5) / 5), 2.6, 0x5ae0c0, 0.7);
          led(p, mx + 13, yb - 7, 0x5ae0c0, { rate: 0.7 });
        }
      }
      // Charge controller cabinet with a load gauge, a display and status lamps.
      const cx = 66;
      p.box(cx, yb, 12.5, p.t(44, 46, 48), p.t(0x56585c, 0x585e66, 0x30363c), 3);
      gauge(p, cx + 6.2, yb - p.t(36, 38, 40), 3, { a: 0.9, amp: 0.15 });
      screenPanel(p, cx + 2, yb - p.t(28, 29, 31), 8.4, 6, 0x5ae0ff, { bars: true });
      led(p, cx + 3, yb - 17, 0x6aff7a, { rate: 0.8 });
      led(p, cx + 6.2, yb - 17, 0xffb040, { rate: 1.9 });
      led(p, cx + 9.4, yb - 17, 0xff4a3a, { rate: 3.1 });
      for (let i = 0; i < 4; i++) p.rect(cx + 2, yb - 12 + i * 1.8, 8.5, 0.7, 0x000000, 0.4);
      // Heavy cable bundles from the racks into the controller and a duct along the floor.
      cables(p, 42, yb - 50, cx + 2, yb - 47, 3, 7);
      p.rect(14, yb + 2.5, 62, 3.4, 0x1e1e20);
      p.stripes(14, yb + 5.2, 62, 1, 0xc8a02a, 0x1a1a1a, 3);
      p.rect(14, yb + 2.5, 62, 0.5, 0xffffff, 0.12);
      // Wear and small signs.
      p.tally(p.inR - 12, 20, 2);
      p.stripes(p.inL + 1, 10.5, 12, 3, 0xc8a02a, 0x1a1a1a, 4);
      if (p.tier === 0) {
        crate(p, 16, yb + 0.5, 8);
        p.streak(50, 14, 30, 0x5a4a22, 0.3);
      }
      p.spot(0.22, 1, 'tend', 0.2);
      p.spot(0.62, -1, 'tend', 0.3);
    },
  },

  // ---------------------------------------------------------------- BL-10 commons (the common room)
  commons: {
    slots: 2,
    pal: { wall: 0x7a5c44, floor: 0x5e4430, accent: 0xe0a050, light: 0xffd9a0 },
    build(p) {
      const { yb } = p;
      p.lamp(p.t('bulb', 'bulb', 'led'), 46, 9.5, { color: lampCol(p), r: 38, flicker: p.t(0.4, 0.25, 0.1) });
      // Pinboard with notices and a photo (left), a radio on a shelf (right).
      p.rect(14.6, 23.6, 18.8, 14.8, 0x4e3622);
      p.rect(15.6, 24.6, 16.8, 12.8, 0x9a7a52);
      p.speckle(15.6, 24.6, 16.8, 12.8, 0x3a2a18, 40, 0.3);
      notice(p, 17.2, 26.2, 5.2, 6.4);
      notice(p, 23.4, 27, 4.6, 7);
      p.rect(28.6, 26, 3, 3.6, 0xa8a090);
      p.rect(28.9, 26.3, 2.4, 2.2, 0x6a7a60);
      p.rect(58, 37, 21, 1.8, shade(WOOD, 0.8));
      p.box(62, 37, 12.5, 8, p.t(0x5a4838, 0x6a4a34, 0x3a4a52), 2);
      p.rect(63.4, 32.4, 6.4, 3.2, 0x1a1208);
      p.rect(63.8, 32.8, 5.6, 2.4, 0xd89a40, 0.85);
      for (let i = 0; i < 4; i++) p.rect(70.6 + i * 0.9, 32, 0.4, 4.4, 0x000000, 0.5);
      p.line(73, 29, 77, 22, 0x2a2a2a, 0.4);
      p.glow(66.6, 34, 5, 0xd89a40, { a: 0.5 });
      p.fx('screen', 66.6, 34, { w: 5.6, h: 2.4, color: 0xd89a40, band: false });
      // Rug, sofa, coffee table.
      p.ell(46, yb + 7.5, 25, 4.2, p.t(0x6a3a30, 0x7a3a30, 0x2a4a58), 0.95);
      p.ell(46, yb + 7.5, 21, 3.2, 0x000000, 0.14);
      const sofa = p.t(0x5a6048, 0x8a5a3a, 0x3a5a62);
      p.roundRect(20, yb - 25, 34, 15, 3.2, shade(sofa, 0.8));
      p.roundRect(19, yb - 12.5, 36, 9.5, 3, shade(sofa, 1.08));
      for (const ax of [15.5, 52.5]) p.roundRect(ax, yb - 18, 7, 15, 3, shade(sofa, 0.92));
      p.line(37, yb - 12, 37, yb - 3.5, shade(sofa, 0.55), 0.5, 0.8);
      p.line(21, yb - 22, 53, yb - 22, shade(sofa, 1.2), 0.4, 0.4);
      p.shadow(37, yb + 0.5, 22, 0.4);
      for (const lx of [19, 54]) p.rect(lx, yb - 2, 1.4, 2.5, 0x2a2018);
      p.seat(29, yb - 11, 1, 'sit');
      p.seat(45, yb - 11, -1, 'sit');
      p.box(35, yb + 9, 21, 4.2, 0x6a4a30, 5);
      p.rect(39, yb + 3.4, 4.2, 2.6, 0xe8e0cc);
      p.rect(44, yb + 3.8, 4.2, 2.4, 0xd8d0bc);
      p.ell(51, yb + 4.4, 1.5, 1, 0x7a3a2a);
      sprout(p, 75, yb + 1, 1.4);
      if (p.tier >= 1) stringLights(p, 14, 78, 14.5, 6, [0xffd27a, 0xff9a6a, 0xffe6a0], 4);
      p.plate(46, p.t(21, 22, 22), 15, 9, 'cup', p.t(0x6a4a24, 0x7a4a26, 0x2a4a5a), 0xe8dcc0);
      if (p.tier === 0) {
        p.streak(40, 10, 28, 0x4a3018, 0.3);
        p.crack(70, 14, 20);
      } else if (p.tier === 2) {
        p.rect(60, 44, 16, 10, 0x2a2e32);
        p.rect(61.2, 45.2, 13.6, 7.6, 0x5a7a86);
        p.rect(61.2, 45.2, 13.6, 2.4, 0xffffff, 0.12);
      }
      p.spot(0.7, -1, 'idle', 0.3);
    },
  },

  // ---------------------------------------------------------------- BL-11 library
  library: {
    slots: 2,
    pal: { wall: 0x6e5a48, floor: 0x4e3e30, accent: 0xe8c070, light: 0xffe6b0 },
    build(p) {
      const { yb } = p;
      p.lamp(p.t('bulb', 'bulb', 'led'), 46, 9.5, { color: lampCol(p), r: 36, flicker: p.t(0.4, 0.2, 0.1) });
      bookshelf(p, 13.5, yb, 21, 64, 5);
      bookshelf(p, 58, yb, 21, 64, 5);
      ladder(p, 36, yb, 52, 0x5a4a38);
      // The reading table with a green-shaded lamp and an open book; chairs on both sides.
      desk(p, 40, yb, 16, 12, p.t(0x6a4a30, 0x7a5434, 0x4a4e52));
      p.rect(44, yb - 14.5, 8, 2.4, 0xe0d8bc);
      p.line(48, yb - 14.5, 48, yb - 12.2, 0x6a5a3a, 0.4);
      p.lamp('desk', 55, yb - 11.5, { color: lampCol(p), r: 20, flicker: 0.15 });
      p.fx('pulse', 59, yb - 15, { color: 0xffd890, size: 7, rate: 0.6 });
      chair(p, 35, yb, 1);
      chair(p, 61.5, yb, -1);
      p.seat(35, yb - 9, 1, 'sit');
      p.seat(61, yb - 9, -1, 'sit');
      p.plate(46, 21, 17, 10, 'book', p.t(0x4a3a24, 0x5a4226, 0x28444e), 0xe8dcc0);
      // Books piled on the floor and a lamp-lit globe.
      for (let i = 0; i < 4; i++) p.rect(20 + i * 0.6, yb + 5 - i * 2.1, 8 - i, 2, [0x7a3a32, 0x3a5a52, 0x8a7a3e, 0x3a4a6a][i], 0.95);
      if (p.tier >= 1) {
        p.ell(70, yb + 6, 3.4, 3.4, 0x6a8a9a);
        p.ell(70, yb + 6, 3.4, 3.4, 0xffffff, 0.08);
        p.line(70, yb + 9, 70, yb + 11, 0x3a3028, 0.8);
      }
      if (p.tier === 0) {
        for (let i = 0; i < 6; i++) p.rect(26 + p.rnd() * 40, yb + 7 + p.rnd() * 5, 4, 1.4, 0x8a6a4a, 0.8);
        p.streak(46, 12, 22, 0x4a3a28, 0.3);
      }
      p.spot(0.46, -1, 'inspect', 0.15);
      p.spot(0.12, 1, 'inspect', 0.5);
    },
  },

  // ---------------------------------------------------------------- BL-12 recycler
  recycler: {
    slots: 3,
    pal: { wall: 0x56524a, floor: 0x48443e, accent: 0xe8943a, light: 0xffc890 },
    build(p) {
      const { yb } = p;
      p.lamp(p.t('bulb', 'tube', 'led'), 40, 9.5, { color: lampCol(p), r: 38, flicker: p.t(0.5, 0.25, 0.1) });
      p.lamp(p.t('bulb', 'tube', 'led'), 100, 9.5, { color: lampCol(p), r: 38, flicker: p.t(0.5, 0.25, 0.1) });
      // Gantry rail and magnet crane.
      p.rect(16, 13, 106, 2.2, 0x34363a);
      p.rect(70, 12, 9, 5, 0x44484c);
      p.line(74.5, 17, 74.5, 31, 0x2a2a2a, 0.6);
      p.box(70.5, 36, 8, 4.5, 0x3a3c40, 1.5, { shadow: false });
      p.rect(71.5, 36, 6, 0.9, 0xa8382a, 0.8);
      // Input hopper with a heap of scrap.
      p.box(14, yb, 22, 18, p.t(0x6a5a34, 0x5a6a50, 0x4a5a6a), 5);
      p.poly([14, yb - 18, 36, yb - 18, 33, yb - 22, 17, yb - 22], 0x14100c);
      const junk = [0x6a6a66, 0x8a5a38, 0x4a5a6a, 0x7a7a52, 0x5a3a2a];
      for (let i = 0; i < 26; i++) {
        const jx = 15 + p.vr() * 19, jy = yb - 23 - p.vr() * 5;
        p.rect(jx, jy, 1.4 + p.vr() * 2.4, 1 + p.vr() * 1.6, junk[Math.floor(p.vr() * junk.length)], 0.95);
      }
      // Conveyor: legs, belt strip (live), and cans riding on it.
      for (const lx of [40, 56, 72]) p.rect(lx, yb - 21, 1.6, 21, 0x3a3c40);
      p.rectG(38, yb - 26.5, 40, 5, [[0, 0x4a4c50], [1, 0x1e1e20]]);
      p.rect(38, yb - 26.5, 40, 0.8, 0xffffff, 0.14);
      p.fx('belt', 58, yb - 24, { w: 38, h: 2.4, rate: 1, work: true });
      for (let i = 0; i < 4; i++) {
        const cx = 42 + i * 9.6;
        p.rect(cx, yb - 31 + (i % 2), 3.2, 4.6, [0x8a8a86, 0x7a4a2a, 0x4a6a7a, 0x8a7a3a][i], 0.95);
        p.rect(cx, yb - 31 + (i % 2), 3.2, 0.8, 0xffffff, 0.25);
      }
      // The shredder: a box with a toothed mouth, a hazard band, a gauge and a status lamp.
      p.box(80, yb, 27, 46, p.t(0x5a5650, 0x6a665e, 0x4a5258), 5);
      p.poly([82, yb - 46, 105, yb - 46, 101, yb - 54, 86, yb - 54], 0x2a2a2c);
      p.rect(86, yb - 53, 15, 1, 0x000000, 0.5);
      for (let i = 0; i < 7; i++) p.poly([84 + i * 3, yb - 40, 86 + i * 3, yb - 40, 85 + i * 3, yb - 34], 0xb8b4a8, 0.85);
      p.rect(83, yb - 40, 22, 1.2, 0x000000, 0.6);
      p.stripes(80, yb - 20, 27, 4, 0xc8a02a, 0x1a1a1a, 5);
      gauge(p, 100, yb - 30, 3);
      led(p, 84.5, yb - 28, 0xff4a3a, { rate: 2.4, work: true });
      led(p, 88.5, yb - 28, 0x6aff7a, { rate: 0.9, work: true });
      p.fx('sparks', 96, yb - 5, { color: 0xffc070, size: 4, rate: 0.7, work: true });
      // Sorted bins and compacted bales.
      for (let i = 0; i < 3; i++) {
        const bx = 108 + i * 6.2;
        p.box(bx, yb, 5.6, 14 - i * 1.5, [0x4a5a6a, 0x4a6a52, 0x7a4a34][i], 2);
      }
      p.box(15, yb + 9, 11, 8.5, 0x6a6a66, 3);
      p.box(28, yb + 9, 9, 7, 0x7a6048, 3);
      barrel(p, 116, yb + 7, 4.5, 11, 0x4a5a6a, 0xc8a02a);
      p.plate(58, 25, 18, 11, 'recycle', 0x2c5a3a, 0xd8e8c8);
      if (p.tier === 0) {
        p.streak(30, 14, 30, 0x5a3a1c, 0.35);
        p.streak(110, 14, 24, 0x5a3a1c, 0.3);
        crate(p, 52, yb + 8.5, 9);
      }
      p.spot(0.18, 1, 'hammer', 0.3);
      p.spot(0.42, 1, 'hammer', 0.15);
      p.spot(0.7, -1, 'hammer', 0.5);
    },
  },

  // ---------------------------------------------------------------- BL-13 air condenser
  condenser: {
    slots: 2,
    pal: { wall: 0x4a6478, floor: 0x4e5a60, accent: 0x5ae0ff, light: 0xb0f0ff },
    build(p) {
      const { yb } = p;
      p.lamp(p.t('bulb', 'tube', 'led'), 46, 9.5, { color: lampCol(p), r: 34, flicker: p.t(0.4, 0.2, 0.1) });
      // The coil: a tall finned radiator with two fans at the top.
      p.box(14, yb, 38, 54, p.t(0x5a5e60, 0x586870, 0x707e86), 4);
      for (let x = 16; x < 50; x += 2) p.rect(x, yb - 38, 0.8, 36, 0x000000, 0.34);
      p.rect(14, yb - 40, 38, 1.2, 0xffffff, 0.14);
      for (const fx of [24, 42]) {
        p.ell(fx, yb - 47, 8.5, 8.5, 0x1c1e20);
        p.ell(fx, yb - 47, 7.4, 7.4, 0x3a3e42);
        p.fx('fan', fx, yb - 47, { size: 7, color: 0x14161a, rate: 1, work: true });
        p.ell(fx, yb - 47, 1.3, 1.3, 0x1a1a1a);
      }
      p.rect(14, yb - 54, 38, 1.2, 0x000000, 0.4);
      // Condensate trays, drip lines, the collecting tank with a tap and a lit water level.
      p.rect(14, yb - 3, 38, 2, 0x22282c);
      for (const dx of [22, 33, 44]) {
        p.rect(dx, yb - 3, 0.7, 3, 0x9ad0e8, 0.8);
        p.fx('drip', dx + 0.3, yb - 4, { to: yb + 4, color: 0x9fd8ff, ring: 3, rate: 0.9 });
      }
      p.cyl(65, yb + 1, 8, 32, 0x4a5a64);
      p.rectG(58.2, yb - 18, 13.6, 17, [[0, 0x6ab8d8, 0.7], [1, 0x2a6a8a, 0.7]]);
      p.rect(58.2, yb - 18, 13.6, 0.8, 0xffffff, 0.3);
      p.rect(60, yb - 33, 1.6, 31, 0xffffff, 0.12);
      p.rect(72, yb - 6, 5, 1.6, 0x6a6e72);
      p.rect(75.4, yb - 6, 1.6, 4, 0x6a6e72);
      p.fx('stream', 76.2, yb - 2, { to: yb + 5, color: 0x9fd8ff, size: 0.6, ring: 3, work: true });
      pipeV(p, 55, 14, yb - 10, p.t(0x6a5648, 0x56606a, 0x8a9096), true);
      p.wire(55, 14, 20, 12, 3, 0x56606a, 1.6);
      gauge(p, 70, yb - 40, 3.2, { a: 0.6 });
      led(p, 62, yb - 40, 0x5ae0ff, { rate: 1.1, work: true });
      p.plate(64, 21, 14, 9, 'drop', p.t(0x2a4a5e, 0x2a5066, 0x1c4a66), 0xcfeaf8);
      if (p.tier === 0) {
        p.streak(30, 14, 36, 0x4a5a3a, 0.35);
        p.stain(40, yb - 20, 10, 0x2a3a2a, 0.22);
        barrel(p, 20, yb + 9, 4, 9, 0x4a5a64);
      } else if (p.tier === 2) {
        screenPanel(p, 20, yb - 60 + 14, 12, 6, 0x5ae0ff, { bars: true });
      }
      p.spot(0.62, -1, 'tend', 0.3);
    },
  },

  // ---------------------------------------------------------------- BL-14 mushroom farm
  mushroomFarm: {
    slots: 2,
    pal: { wall: 0x3e3e50, floor: 0x35323a, accent: 0xc8a0ff, light: 0xb8a0e8 },
    dim: 0.04,
    build(p) {
      const { yb } = p;
      // Violet grow tubes over the racks plus one warm work lamp.
      p.lamp(p.t('bulb', 'tube', 'led'), 46, 9.5, { color: 0xffd49a, r: 30, flicker: 0.3 });
      for (const tx of [27, 61]) {
        p.rect(tx - 11, 20, 22, 2.4, 0x2a2a30);
        p.rect(tx - 10, 21, 20, 1.2, 0xe0c8ff);
        p.glow(tx, 24, 22, 0xb890ff, { a: 0.7 });
        p.cones.push({ x: tx, y: 22, w0: 22, w1: 36, yb: yb, a: 0.35 });
        p.fx('tube', tx, 21.6, { color: 0xc8a0ff, w: 20, h: 1.2 });
      }
      p.fx('pulse', 27, 40, { color: 0xb890ff, w: 24, h: 24, rate: 0.5 });
      p.fx('pulse', 61, 40, { color: 0xb890ff, w: 24, h: 24, rate: 0.5 });
      // Two racks of soil trays with pale caps.
      const caps = [0xd8c8f0, 0xf0e0c0, 0xc8d8f0, 0xe8d0d8];
      for (const rx of [14, 48]) {
        const shelves = rack(p, rx, yb, 28, 58, 3, 0x4a4e58);
        for (const sy of shelves) {
          p.rect(rx + 1.4, sy - 3.4, 25.2, 3.4, 0x2e2018);
          p.speckle(rx + 1.4, sy - 3.4, 25.2, 3.4, 0x5a4030, 30, 0.5);
          const dens = p.t(4, 8, 11);
          for (let i = 0; i < dens; i++) {
            const mx = rx + 3 + (i + 0.5) * (22 / dens) + (p.vr() - 0.5) * 1.5;
            const s = 0.7 + p.vr() * 0.7;
            p.rect(mx - 0.4, sy - 3.4 - 3.4 * s, 0.8, 3.4 * s, 0xe8e0d0);
            p.ell(mx, sy - 3.4 - 3.6 * s, 2.4 * s, 1.5 * s, caps[(i + Math.round(sy)) % caps.length]);
            p.ell(mx, sy - 3.4 - 3.8 * s, 1.5 * s, 0.8 * s, 0xffffff, 0.25);
            p.glow(mx, sy - 3.4 - 3.6 * s, 3.2 * s, 0xb89aff, { a: 0.18 });
          }
        }
      }
      // Humidifier, water barrel, hose.
      p.box(77, yb, 5, 16, 0x5a5e66, 1.6, { noside: true });
      p.fx('mist', 79.5, yb - 17, { color: 0xc8d8f0, size: 5, rate: 0.6 });
      p.cyl(10.5, yb + 8, 4, 10, 0x4a5a64);
      p.plate(46, 21, 14, 8, 'mushroom', 0x3a2a4e, 0xe8d8f8);
      p.fx('twinkle', 30, 50, { color: 0xc8a0ff, size: 0.9 });
      p.fx('twinkle', 62, 44, { color: 0xc8a0ff, size: 0.9 });
      p.fx('twinkle', 46, 58, { color: 0xc8a0ff, size: 0.9 });
      if (p.tier === 0) p.stain(46, 40, 14, 0x203020, 0.3);
      if (p.tier === 2) screenPanel(p, 40, 28, 12, 6, 0xc8a0ff, { bars: true });
      p.spot(0.46, 1, 'tend', 0.3);
      p.spot(0.8, -1, 'tend', 0.5);
    },
  },

  // ---------------------------------------------------------------- BL-19 gate post
  gatePost: {
    slots: 2,
    pal: { wall: 0x5a5a50, floor: 0x44423a, accent: 0xff7a3a, light: 0xffd8a0 },
    build(p) {
      const { yb } = p;
      p.lamp(p.t('bulb', 'tube', 'led'), 52, 9.5, { color: lampCol(p), r: 34, flicker: p.t(0.4, 0.2, 0.1) });
      blastDoor(p, 15, yb, 24, 52, { wheel: true });
      // A floodlight on a bracket over the door and a warning beacon.
      p.lamp('flood', 64, 13, { color: 0xffe8c0, r: 26, flicker: 0.1, cone: 0.7 });
      p.rect(60, 11, 9, 1.4, 0x2a2a2a);
      p.glow(35, 28, 4, 0xff5a3a, { a: 0.5 });
      led(p, 35, 28, 0xff5a3a, { rate: 1.3, size: 1.1 });
      // The guard desk with two camera screens and a notice.
      desk(p, 48, yb, 28, 14, p.t(0x5a4a3a, 0x5e5a50, 0x3a4248));
      screenPanel(p, 50, 38, 11, 8, 0x6aff9a, { band: true });
      screenPanel(p, 63, 38, 11, 8, 0x6aff9a, { band: true });
      p.rect(53, yb - 19, 3, 5, 0x1a1a1a);
      notice(p, 57, 25, 6, 8);
      p.plate(66, 21, 13, 8, 'shield', p.t(0x4a3a24, 0x5a3a24, 0x28445a), 0xf0e0c8);
      // Sandbags and a striped barrier arm up front.
      sandbags(p, 18, yb + 10, 4, 2);
      p.rect(46, yb + 5, 32, 1.4, 0xc8c0a8);
      for (let x = 48; x < 76; x += 8) p.rect(x, yb + 5, 4, 1.4, 0xb03a2a);
      p.rect(75, yb + 2, 1.6, 8, 0x3a3a3a);
      if (p.tier === 0) {
        p.tally(20, 18, 3);
        p.streak(40, 12, 30, 0x5a3a1c, 0.3);
      }
      if (p.tier === 2) p.stripes(15, 10.4, 24, 2.4, 0xc8a02a, 0x1a1a1a, 5);
      p.seat(46, yb - 8, 1, 'sit');
      p.spot(0.3, -1, 'idle', 0.45);
      p.spot(0.7, -1, 'type', 0.15);
    },
  },

  // ---------------------------------------------------------------- BL-33 barracks
  barracks: {
    slots: 3,
    pal: { wall: 0x56604c, floor: 0x44463a, accent: 0xb8b868, light: 0xffe8b0 },
    build(p) {
      const { yb } = p;
      p.lamp(p.t('bulb', 'tube', 'led'), 46, 9.5, { color: lampCol(p), r: 40, flicker: p.t(0.4, 0.2, 0.1) });
      p.lamp(p.t('bulb', 'tube', 'led'), 100, 9.5, { color: lampCol(p), r: 32, flicker: p.t(0.4, 0.2, 0.1) });
      const blanket = p.t(0x5a6a4a, 0x66724e, 0x3a4a4e);
      bunk(p, 14, yb, 2, blanket);
      bunk(p, 54, yb, 2, shade(blanket, 1.1));
      p.seat(32, yb - 11, 1, 'sit');
      p.seat(72, yb - 11, 1, 'sit');
      p.plate(50, 20, 16, 10, 'chevrons', p.t(0x3a4630, 0x44502e, 0x2a4458), 0xe0d8a8);
      // Lockers, a weapon rack and the duty roster.
      for (let i = 0; i < 2; i++) locker(p, 96 + i * 9.4, yb, 8.6, 48, p.t(0x5a6258, 0x5a6458, 0x3e4850));
      p.rect(115, 24, 11, 40, 0x2e2e28);
      for (let i = 0; i < 4; i++) {
        p.rect(116.4 + i * 2.5, 27, 1, 32, 0x14140f);
        p.rect(116 + i * 2.5, 48, 2, 5, 0x5a3a2a);
      }
      notice(p, 80, 28, 10, 14);
      led(p, 85, 24, 0xff4a3a, { rate: 1.1 });
      for (const bx of [24, 70]) {
        p.ell(bx, yb + 8, 3, 1.6, 0x241c14);
        p.ell(bx + 5, yb + 8.4, 3, 1.6, 0x241c14);
      }
      if (p.tier === 0) {
        p.tally(66, 22, 2);
        p.stain(100, 40, 10, 0x000000, 0.22);
      }
      p.spot(0.4, 1, 'idle', 0.4);
      p.spot(0.72, -1, 'idle', 0.3);
      p.spot(0.9, -1, 'idle', 0.6);
    },
  },
};

void mix;
void STEEL;
void cables;
void glassPane;
void pipeV;
void locker;
