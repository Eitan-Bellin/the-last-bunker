/**
 * [plan4:BL-7 track A] Wave 2 room specs: BL-15 quarantineWard, BL-16 solarArray, BL-17 windTurbine, BL-18 watchtower, BL-20 garage,
 * BL-21 decon, BL-22 aquaculture, BL-23 market, BL-26 nursery, BL-30 school, BL-31 bathhouse, BL-32 memorialHall.
 * Keyed by type name, so they bind as soon as Rooms-Data adds the types (see roomSpecs.ts). Slots follow doc 02 section 2.1.
 * The three surface-row types (solar, wind, watchtower) are open-air pictures for the room path; Surface-Annex draws their ground-level look.
 */
import type { RoomSpec } from './roomComposer';
import { mix, mute, shade } from './roomComposer';
import {
  WOOD, awning, barrel, blastDoor, cables, chair, crate, desk, glassPane, hangingShade, ladder, lampCol, led, notice, pipeV, sandbags,
  screenPanel, sprout, stringLights,
} from './roomParts';

export const SPECS_B: Record<string, RoomSpec> = {
  // ---------------------------------------------------------------- BL-15 quarantine ward
  quarantineWard: {
    slots: 2,
    pal: { wall: 0x62706c, floor: 0x585a54, accent: 0xe0705a, light: 0xffe6cc },
    build(p) {
      const { yb } = p;
      p.lamp(p.t('bulb', 'tube', 'led'), 46, 9.5, { color: lampCol(p), r: 36, flicker: p.t(0.5, 0.25, 0.1) });
      // Two isolation pods behind glass (salvaged: taped plastic sheeting), each with a bed and a drip stand.
      for (const px of [14, 42]) {
        const w = 26;
        p.rect(px, yb - 50, w, 50, 0x20262a, 0.5);
        p.rect(px + 2, yb - 11, w - 4, 1.8, 0x8a8e92);
        p.roundRect(px + 3, yb - 17, w - 9, 6, 2.2, p.t(0xc8c0b0, 0xe0dcd0, 0xe8ecec));
        p.roundRect(px + 4, yb - 19.4, 8, 3.4, 1.6, 0xf0ece0);
        p.rect(px + 3, yb - 22, 1.6, 12, 0x6a6e72);
        p.rect(px + w - 3.6, yb - 20, 1, 20, 0x6a6e72);
        p.rect(px + w - 6, yb - 38, 5.2, 7, 0xd8e4dc, 0.9);
        p.line(px + w - 3.4, yb - 31, px + w - 3.4, yb - 22, 0xd8e4dc, 0.35, 0.8);
        glassPane(p, px, yb - 50, w, 50, 0x9ad0e0, p.t(0x6a6e70, 0x4a5258, 0xb8c4c8));
        if (p.tier === 0) {
          // plastic sheeting held with tape
          p.rect(px, yb - 50, w, 50, 0xe8ecec, 0.18);
          for (const ty of [-40, -22, -6]) p.rect(px, yb + ty, w, 1.4, 0xc8a02a, 0.7);
        }
      }
      screenPanel(p, 33.4, yb - 36, 8.4, 6, 0x6aff9a, { band: false });
      p.fx('ecg', 37.6, yb - 33, { color: 0x6aff9a, w: 7.4, h: 4.6, rate: 1 });
      p.plate(40, 21, 16, 10, 'bio', 0x7a2a22, 0xf0d8c0);
      p.glow(40, 30, 6, 0xff5a3a, { a: 0.5 });
      led(p, 40, 30, 0xff5a3a, { rate: 1.2, size: 1.2 });
      p.fx('pulse', 40, 32, { color: 0xff5a3a, size: 9, rate: 1.4 });
      // The sealed hatch with a hazard frame, and the quarantine line on the floor.
      blastDoor(p, 71, yb, 8, 40, { col: 0x6a726e });
      p.rect(14, yb + 7, 56, 1.2, 0xc8a02a, 0.8);
      p.stripes(14, yb + 8.2, 56, 0.8, 0xc8a02a, 0x1a1a1a, 3);
      if (p.tier === 0) p.stain(50, yb - 24, 9, 0x4a1a14, 0.18);
      // [plan4:BL-7 quality pass] The two nurses used to stand 22 units apart both leaning right, and in the game they merged into one clump
      // (seen at 390x844): one at each pod, facing each other across the screen.
      p.spot(0.3, 1, 'tend', 0.55);
      p.spot(0.74, -1, 'tend', 0.5);
    },
  },

  // ---------------------------------------------------------------- BL-16 solar array (open air)
  solarArray: {
    slots: 2,
    outdoor: true,
    dim: -0.3,
    pal: { wall: 0x4a5a6a, floor: 0x4a443c, accent: 0xffd070, light: 0xffe0a8 },
    build(p) {
      const { yb, W } = p;
      p.glow(W * 0.3, yb - 22, 46, 0xffd49a, { a: 0.9, live: true, flicker: 0.05 });
      p.fx('pulse', W * 0.3, yb - 22, { color: 0xffd49a, size: 22, rate: 0.35 });
      // Rows of tilted panels on frames: tier 0 cracked and patched, 2 clean with a bright cell grid.
      const rows = p.t(1, 2, 2);
      for (let r = 0; r < rows; r++) {
        const by = yb - 6 - r * -9 - (rows - 1) * 0; // back row first
        for (let i = 0; i < 3; i++) {
          const x = 14 + i * 22.2 + r * 2;
          const y0 = by - 30 + r * 0;
          const pw = 20.5;
          p.rect(x + pw / 2 - 0.9, y0 + 14, 1.8, 16, 0x3a3c40);
          p.poly([x + 3, y0, x + pw + 3, y0, x + pw + 5.5, y0 + 15, x + 0.5, y0 + 15], 0x1c2840);
          p.polyG([x + 3.6, y0 + 0.7, x + pw + 2.4, y0 + 0.7, x + pw + 4.6, y0 + 14.2, x + 1.4, y0 + 14.2], y0, y0 + 15, [[0, 0x3a5a8a], [1, 0x1c3258]]);
          for (let gx = 1; gx < 5; gx++) p.line(x + 3 + (gx * pw) / 5, y0 + 0.7, x + 0.5 + 0.9 + (gx * (pw + 3)) / 5, y0 + 14.2, 0x9ab4d8, 0.25, p.t(0.25, 0.35, 0.5));
          for (let gy = 1; gy < 3; gy++) p.line(x + 3 - gy * 0.8, y0 + gy * 5, x + pw + 3 + gy * 0.9, y0 + gy * 5, 0x9ab4d8, 0.25, p.t(0.25, 0.35, 0.5));
          p.poly([x + 4, y0 + 1, x + 9, y0 + 1, x + 6, y0 + 14, x + 2, y0 + 14], 0xffffff, 0.1);
          if (p.tier === 0 && (i + r) % 2 === 0) p.crack(x + 8 + i, y0 + 3, 10, 0.7);
          if (p.tier === 0 && i === 1) p.rect(x + 6, y0 + 4, 7, 5, 0x5a5448, 0.85);
          p.ell(x + pw / 2, by + 1.2, 6, 1.1, 0x000000, 0.35);
        }
      }
      // Inverter box and cables.
      p.box(72, yb + 4, 8, 14, p.t(0x5a5448, 0x586068, 0x2c363e), 2);
      screenPanel(p, 73.4, yb - 6.5, 5.2, 3.6, 0xffd070, { band: false });
      led(p, 74.2, yb - 1.5, 0x6aff7a, { rate: 0.6 });
      led(p, 77, yb - 1.5, 0xffb040, { rate: 1.5 });
      cables(p, 56, yb - 4, 72, yb + 1, 2, 5);
      p.spot(0.46, 1, 'idle', 0.6);
    },
  },

  // ---------------------------------------------------------------- BL-17 wind turbine (open air, one slot)
  windTurbine: {
    slots: 1,
    outdoor: true,
    dim: -0.3,
    pal: { wall: 0x4a5a6a, floor: 0x4a443c, accent: 0xffffff, light: 0xffe0a8 },
    build(p) {
      const { yb, W } = p;
      p.glow(W * 0.3, yb - 22, 32, 0xffd49a, { a: 0.8 });
      const mx = W / 2;
      // Tapering mast, nacelle, hub; the rotor itself is live (`rotor` effect) so it turns with the wind.
      const mast = p.t(0x8a8a82, 0xbcc0bc, 0xd6dad8);
      p.polyG([mx - 1.9, yb + 5, mx + 1.9, yb + 5, mx + 0.9, 21, mx - 0.9, 21], 21, yb + 5, [[0, shade(mast, 1.1)], [1, shade(mast, 0.7)]]);
      p.rect(mx - 0.5, 21, 0.5, yb - 16, 0xffffff, 0.2);
      for (let y = 30; y < yb; y += 14) p.rect(mx - 1.9, y, 3.8, 0.7, 0x000000, 0.25);
      p.box(mx - 4.2, 23, 8.4, 4.6, shade(mast, 0.95), 2);
      p.ell(mx, 19.5, 2.1, 2.1, shade(mast, 0.8));
      p.fx('rotor', mx, 19.5, { size: 17, color: p.t(0xb8b4a8, 0xd8dcd6, 0xf0f2ee), n: 3, rate: 1 });
      led(p, mx + 3.4, 21.4, 0xff4a3a, { rate: 0.8 });
      p.box(8, yb + 4, 9, 8, p.t(0x5a5448, 0x586068, 0x2c363e), 2);
      p.wire(mx, yb + 3, 17, yb - 1, 3, 0x1c1c1e, 0.8);
      if (p.tier === 0) p.streak(mx, 30, 40, 0x5a3a1c, 0.35);
      p.spot(0.5, 1, 'idle', 0.6);
    },
  },

  // ---------------------------------------------------------------- BL-18 watchtower (open air, one slot)
  watchtower: {
    slots: 1,
    outdoor: true,
    dim: -0.24,
    pal: { wall: 0x4a5a6a, floor: 0x4a443c, accent: 0xffb060, light: 0xffe0a8 },
    build(p) {
      const { yb, W } = p;
      p.glow(W * 0.3, yb - 22, 30, 0xffd49a, { a: 0.7 });
      const steel = p.t(0x5a5448, 0x5a626a, 0x6a747c);
      // Four braced legs, a ladder, the lookout cabin with a lit window and a roof with a searchlight.
      for (const lx of [13, 21.4, 28, 36]) p.rectG(lx, 36, 1.6, yb + 6 - 36, [[0, shade(steel, 1.2)], [1, shade(steel, 0.6)]], true);
      p.line(13.8, yb, 36.8, 44, steel, 0.9, 0.9);
      p.line(36.8, yb, 13.8, 44, steel, 0.9, 0.9);
      p.line(13.8, 62, 36.8, 44, shade(steel, 0.8), 0.7, 0.8);
      p.line(36.8, 62, 13.8, 44, shade(steel, 0.8), 0.7, 0.8);
      ladder(p, 8, yb + 5, 52, shade(steel, 1.0));
      p.box(11, 36, 28, 15, p.t(0x6a604e, 0x626a60, 0x4a5860), 4);
      screenPanel(p, 14, 26, 12, 6, 0xffc070, { band: false });
      p.rect(27.5, 25, 8.5, 9, 0x14181c, 0.9);
      p.poly([9, 22, 41, 22, 38, 17, 12, 17], shade(steel, 0.8));
      p.lamp('flood', 36, 17, { color: 0xffe8c0, r: 24, flicker: 0.1, cone: 0.9 });
      p.fx('pulse', 36, 17, { color: 0xffe8c0, size: 12, rate: 0.9 });
      p.line(20, 17, 20, 7, 0x2a2a2a, 0.5);
      led(p, 20, 7, 0xff4a3a, { rate: 1, size: 1 });
      sandbags(p, 6, yb + 9, 3, 2);
      if (p.tier === 0) p.streak(22, 38, 22, 0x5a3a1c, 0.35);
      p.spot(0.52, -1, 'idle', 0.5);
    },
  },

  // ---------------------------------------------------------------- BL-20 garage (motor pool)
  garage: {
    slots: 3,
    pal: { wall: 0x5a5648, floor: 0x4a443c, accent: 0xe8943a, light: 0xffc890 },
    build(p) {
      const { yb } = p;
      p.lamp(p.t('bulb', 'tube', 'led'), 36, 9.5, { color: lampCol(p), r: 40, flicker: p.t(0.5, 0.25, 0.1) });
      p.lamp(p.t('bulb', 'tube', 'led'), 100, 9.5, { color: lampCol(p), r: 34, flicker: p.t(0.5, 0.25, 0.1) });
      // Hoist rail with a chain and hook over the truck.
      p.rect(16, 14, 100, 2, 0x34363a);
      p.rect(48, 13, 9, 5, 0x44484c);
      p.line(52.5, 18, 52.5, 36, 0x2a2a2a, 0.6);
      p.ell(52.5, 38, 1.8, 2.2, 0x6a6a68);
      // The truck, seen from the side: tarped bed, cab with a window and a headlight, two wheels.
      const body = p.t(0x58603e, 0x4e6a4a, 0x40545c);
      const cab = p.t(0x6a4a34, 0x5a6a4a, 0x4a6068);
      p.shadow(52, yb + 2, 38, 0.5);
      p.rect(18, yb - 12, 68, 3, 0x1c1c1e);
      p.polyG([18, yb - 12, 58, yb - 12, 58, yb - 28, 20, yb - 27], yb - 28, yb - 12, [[0, shade(body, 1.15)], [1, shade(body, 0.75)]]);
      for (let i = 0; i < 4; i++) p.line(24 + i * 9, yb - 12, 24 + i * 9, yb - 27.5, shade(body, 0.55), 0.5, 0.6);
      p.ell(38, yb - 29, 19, 3, shade(body, 1.2), 0.8);
      p.poly([58, yb - 12, 58, yb - 36, 71, yb - 36, 79, yb - 25, 87, yb - 23, 87, yb - 12], cab);
      p.rectG(58, yb - 36, 29, 24, [[0, 0xffffff, 0.1], [1, 0x000000, 0.25]]);
      p.poly([61, yb - 33, 70, yb - 33, 76, yb - 25, 61, yb - 25], 0x9ab0b8, 0.85);
      p.poly([62, yb - 32, 66, yb - 32, 63, yb - 25, 61.5, yb - 25], 0xffffff, 0.2);
      p.ell(85.5, yb - 18, 1.8, 2.4, 0xfff0c8);
      p.glow(86, yb - 18, 11, 0xffe0a0, { a: 0.5 });
      p.rect(84, yb - 14, 4.5, 2, 0x8a8a86);
      for (const wx of [31, 74]) {
        p.ell(wx, yb - 4, 7.4, 7.4, 0x151515);
        p.ell(wx, yb - 4, 3.8, 3.8, 0x6a6e70);
        p.ell(wx, yb - 4, 1.2, 1.2, 0x2a2a2a);
      }
      if (p.tier === 0) {
        p.streak(30, yb - 27, 15, 0x6a3a18, 0.5);
        p.rect(66, yb - 22, 6, 5, 0x6a3a18, 0.5);
      } else if (p.tier === 2) {
        p.rect(60, yb - 38, 23, 1.6, 0x2a2e32);
        p.rect(64, yb - 40, 3, 2, 0xffe8c0);
        p.rect(74, yb - 40, 3, 2, 0xffe8c0);
      }
      // The workbench with a vise, a toolbox, a pegboard of tools and a welding spot.
      desk(p, 96, yb, 26, 13, p.t(0x5a4a3a, 0x5a5448, 0x3e4850));
      p.rect(97, yb - 17, 5, 4, 0x7a2a22);
      p.box(110, yb - 13, 8, 2.4, 0x3a3a3c, 1);
      p.rect(94, 28, 30, 24, 0x2e2a26);
      p.rect(94, 28, 30, 1, 0xffffff, 0.1);
      for (let i = 0; i < 9; i++) {
        const tx = 97 + i * 3.2;
        p.rect(tx, 31 + (i % 3) * 5, 1.2, 8 + (i % 4) * 2, [0x8a8a86, 0x6a4a2a, 0x7a2a22][i % 3], 0.9);
      }
      p.fx('weld', 104, yb - 15, { size: 3.4, work: true });
      barrel(p, 125, yb + 4, 4.4, 12, 0x4a5a6a, 0xc8a02a);
      p.ell(14, yb + 9, 5, 2.4, 0x101010);
      p.ell(14, yb + 7.5, 5, 2.4, 0x181818);
      p.ell(14, yb + 5.5, 5, 2.4, 0x101010);
      p.plate(70, 22, 18, 11, 'truck', 0x4a3a24, 0xe8dcc0);
      p.spot(0.2, 1, 'wrench', 0.5);
      p.spot(0.52, -1, 'wrench', 0.6);
      p.spot(0.78, -1, 'hammer', 0.25);
    },
  },

  // ---------------------------------------------------------------- BL-21 decontamination chamber
  decon: {
    slots: 2,
    pal: { wall: 0x4c6058, floor: 0x465350, accent: 0x6ac890, light: 0xdcffe8 },
    build(p) {
      const { yb } = p;
      p.lamp(p.t('bulb', 'tube', 'led'), 46, 9.5, { color: mix(lampCol(p), 0xd8ffe8, 0.25), r: 34, flicker: p.t(0.5, 0.25, 0.1) });
      blastDoor(p, 14, yb, 20, 46, { wheel: true, col: 0x5a6a60 });
      p.plate(24, 19.5, 14, 8, 'bio', 0x2a5a3a, 0xe0f0d0);
      // The shower stall: grating floor, two heads on a pipe, falling water and steam.
      p.rect(39, yb - 46, 22, 46, 0x1c2622, 0.5);
      glassPane(p, 39, yb - 46, 22, 46, 0xa0e0c8, 0x4a5e56);
      p.rect(39, yb - 1, 22, 2.4, 0x2a2e2c);
      for (let gx = 40; gx < 60; gx += 2.2) p.rect(gx, yb - 1, 0.6, 2.4, 0x000000, 0.5);
      p.rect(44, 12, 12, 1.6, 0x56606a);
      for (const hx of [46, 54]) {
        p.rect(hx - 0.5, 13, 1, 12, 0x56606a);
        p.poly([hx - 2.4, 25, hx + 2.4, 25, hx + 1.4, 27, hx - 1.4, 27], 0x8a9096);
        p.fx('stream', hx, 27, { to: yb - 1, color: 0xa8e8d0, size: 1.2, ring: 5, work: true });
      }
      p.fx('steam', 50, yb - 10, { color: 0xd8f0e8, size: 7, rate: 0.7 });
      // Hazmat suits on hooks, a green neon strip and chemical drums.
      for (const sx of [68, 75.5]) {
        p.line(sx, 20, sx, 24, 0x2a2a2a, 0.6);
        p.ell(sx, 27.4, 2.6, 3, p.t(0x8a7e3e, 0x9a8e44, 0xb8aa50));
        p.poly([sx - 4, 30, sx + 4, 30, sx + 5, 52, sx - 5, 52], p.t(0x8a7e3e, 0x9a8e44, 0xb8aa50));
        p.rect(sx - 0.3, 30, 0.6, 22, 0x000000, 0.25);
        p.rect(sx - 4, 41, 8, 1.2, 0x000000, 0.25);
        p.rect(sx - 3.6, 52, 2.8, 5, 0x2a2a28);
        p.rect(sx + 0.8, 52, 2.8, 5, 0x2a2a28);
        p.ell(sx, 27.4, 1.5, 1.7, 0x9ad0c0, 0.7);
      }
      p.rect(63, 16, 17, 1.4, 0xb8ffd8);
      p.glow(71.5, 17, 16, 0x6ac890, { a: 0.7 });
      p.fx('tube', 71.5, 16.6, { color: 0x6ac890, w: 16, h: 1.2 });
      barrel(p, 24, yb + 8, 4.4, 11, 0x3a5a4a, 0xc8d048);
      barrel(p, 33, yb + 9, 4.4, 11, 0x4a5a6a, 0xc8d048);
      p.rect(38, yb + 4, 24, 3, 0x1e2422);
      for (let gx = 39; gx < 62; gx += 2.4) p.rect(gx, yb + 4, 0.6, 3, 0x000000, 0.5);
      if (p.tier === 2) p.fx('tube', 50, 40, { color: 0xb890ff, w: 14, h: 1.2 });
      if (p.tier === 0) p.stain(52, yb - 8, 10, 0x1a2a20, 0.3);
      p.spot(0.4, 1, 'idle', 0.55);
      p.spot(0.78, -1, 'idle', 0.4);
    },
  },

  // ---------------------------------------------------------------- BL-22 aquaculture (fish ponds)
  aquaculture: {
    slots: 3,
    pal: { wall: 0x3e5660, floor: 0x3c4a4e, accent: 0x5ad8ff, light: 0xc0ecff },
    build(p) {
      const { yb } = p;
      p.lamp(p.t('bulb', 'tube', 'led'), 70, 9.5, { color: lampCol(p), r: 44, flicker: p.t(0.4, 0.2, 0.1) });
      // A pipe run across the top with valves, feeding three tanks.
      p.rect(14, 22, 110, 3, p.t(0x5a4a3e, 0x4e5a62, 0x7a848c));
      p.rect(14, 22, 110, 0.8, 0xffffff, 0.15);
      for (const vx of [32, 70, 108]) {
        pipeV(p, vx, 25, yb - 38, 0x56606a, true);
      }
      const fishCols = [0xc89a6a, 0xa8b0b0, 0xc8805a];
      for (let t = 0; t < 3; t++) {
        const x = 14 + t * 38.6;
        const w = 35.5, top = yb - 34;
        p.rect(x - 1, top - 1, w + 2, 36, p.t(0x4a3a2e, 0x2a3236, 0x3a4248));
        p.rectG(x, top + 3, w, 32, [[0, 0x5aa0a8, 0.85], [0.5, 0x2a6672, 0.9], [1, 0x143840, 0.95]]);
        p.rect(x, top + 3, w, 0.9, 0xffffff, 0.4);
        // fish, weed and gravel
        for (let f = 0; f < p.t(2, 3, 4); f++) {
          const fx = x + 5 + p.vr() * (w - 12), fy = top + 9 + p.vr() * 18;
          const c = fishCols[(t + f) % 3];
          p.ell(fx, fy, 2.8, 1.4, c, 0.95);
          p.poly([fx + 2.4, fy, fx + 4.6, fy - 1.5, fx + 4.6, fy + 1.5], c, 0.95);
          p.ell(fx - 1.4, fy - 0.3, 0.3, 0.3, 0x101010);
        }
        for (let wd = 0; wd < 5; wd++) p.line(x + 3 + wd * 6.5, top + 34, x + 4 + wd * 6.5 + p.vr() * 2, top + 25 + p.vr() * 4, 0x3a6a4a, 0.9, 0.8);
        p.rect(x, top + 33, w, 2, 0x5a5448, 0.9);
        p.rect(x, top + 3, w, 32, 0xffffff, 0.04);
        p.glow(x + w / 2, top + 16, 17, 0x5ad8ff, { a: 0.4 });
        p.rect(x + 3, top - 7, w - 6, 2.2, 0x2a2e32);
        p.rect(x + 4, top - 6, w - 8, 1, p.t(0xb8e0f0, 0xd0f0ff, 0xe8f8ff));
        p.fx('tube', x + w / 2, top - 5.6, { color: 0x9ad8ff, w: w - 8, h: 1 });
        p.fx('bubbles', x + 6 + t * 3, top + 32, { to: top + 5, size: 4, color: 0xd8f4ff, rate: 0.8 });
        p.fx('bubbles', x + w - 8, top + 32, { to: top + 6, size: 3, color: 0xd8f4ff, rate: 0.6 });
        p.rect(x - 1, top + 33, w + 2, 2.4, 0x22282a);
      }
      p.plate(70, 14.5, 16, 7.5, 'fish', 0x244a58, 0xd8f0f4);
      barrel(p, 124, yb + 8, 3.8, 9, 0x4a5a6a);
      p.ell(18, yb + 7, 5, 2.2, 0x4a6a74, 0.9);
      p.rect(16, yb + 3, 4, 5, 0x6a6e72);
      if (p.tier === 0) p.streak(50, 28, 20, 0x3a4a2a, 0.3);
      p.spot(0.18, 1, 'tend', 0.7);
      p.spot(0.5, 1, 'tend', 0.7);
      p.spot(0.82, -1, 'tend', 0.7);
    },
  },

  // ---------------------------------------------------------------- BL-23 market
  market: {
    slots: 3,
    pal: { wall: 0x68584a, floor: 0x54483c, accent: 0xd8a850, light: 0xffd9a0 },
    build(p) {
      const { yb } = p;
      p.lamp('bulb', 36, 12, { color: lampCol(p), r: 36, flicker: 0.35 });
      p.lamp('bulb', 102, 12, { color: lampCol(p), r: 36, flicker: 0.35 });
      stringLights(p, 14, 124, 10.5, 9, [0xffd27a, 0xff9a6a, 0xffe6a0, 0xa8d0ff], 5);
      const a1 = p.t(0x7a6a58, 0x9a4a3a, 0x3a6a6a), a2 = p.t(0x6a6050, 0xd8c8a0, 0xe8dcc0);
      const items = [0xa86a4a, 0x8a9a52, 0xb89a3a, 0x7a8a9a, 0x9a5a5a];
      for (const sx of [14, 74]) {
        const w = 50;
        // back shelf with jars and bundles, awning over the stall, the counter up front
        p.rect(sx + 3, yb - 46, w - 6, 1.6, shade(WOOD, 0.8));
        p.rect(sx + 3, yb - 28, w - 6, 1.6, shade(WOOD, 0.8));
        for (let i = 0; i < 7; i++) {
          const gx = sx + 5 + i * 6.6;
          p.roundRect(gx, yb - 53, 4.6, 6.4, 1.3, items[i % 5], 0.95);
          p.rect(gx + 0.6, yb - 52.4, 1, 4.6, 0xffffff, 0.2);
          p.roundRect(gx + (i % 2), yb - 35, 4.4, 7, 1.3, items[(i + 2) % 5], 0.95);
        }
        awning(p, sx - 1, 24, w + 2, 9, a1, a2);
        p.rect(sx, 24, 1.6, yb - 24, 0x4a3a2c);
        p.rect(sx + w - 1.6, 24, 1.6, yb - 24, 0x4a3a2c);
        p.box(sx + 2, yb + 1, w - 4, 15, p.t(0x6a5a46, 0x7a5a3a, 0x4a5256), 4);
        for (let i = 0; i < 6; i++) p.ell(sx + 6 + i * 6.4, yb - 14.5 + (i % 2) * 0.5, 2.6, 1.7, items[(i + sx) % 5], 0.95);
        p.rect(sx + 2, yb - 8, w - 4, 0.8, 0x000000, 0.3);
      }
      // Balance scale on the left counter, a hand cart up front and the coin sign.
      p.line(24, yb - 20, 24, yb - 27, 0x2a2a2a, 0.5);
      p.line(19, yb - 27, 29, yb - 27, 0x2a2a2a, 0.5);
      p.ell(19.5, yb - 23.6, 2.8, 0.8, 0xb8a878);
      p.ell(28.5, yb - 23.2, 2.8, 0.8, 0xb8a878);
      p.box(60, yb + 10, 14, 6, 0x5a4a38, 3);
      p.ell(62, yb + 10.4, 2.4, 2.4, 0x181818);
      p.ell(72, yb + 10.4, 2.4, 2.4, 0x181818);
      p.plate(69, 20, 17, 10, 'coin', p.t(0x5a4620, 0x6a4a1c, 0x1c4a58), 0xf0e0b8);
      if (p.tier === 0) {
        p.stain(70, 50, 12, 0x2a1a10, 0.25);
        crate(p, 56, yb + 9, 8);
      }
      p.spot(0.2, 1, 'carry', 0.55);
      p.spot(0.5, 1, 'carry', 0.55);
      p.spot(0.8, -1, 'carry', 0.55);
    },
  },

  // ---------------------------------------------------------------- BL-26 nursery
  nursery: {
    slots: 2,
    pal: { wall: 0x8a7660, floor: 0x6c5844, accent: 0xe8c8a0, light: 0xffe6c0 },
    build(p) {
      const { yb } = p;
      p.lamp('bulb', 46, 12, { color: lampCol(p), r: 38, flicker: 0.25 });
      hangingShade(p, 46, 4, p.t(0x7a6a50, 0xa88a60, 0x6a8a98), lampCol(p));
      // Chalk drawings of a house, a sun and a stick family, high on the wall.
      const ch = 0xe0dcc8;
      p.rect(14, 18, 27, 19, 0x2e3a32, 0.6);
      p.line(18, 34, 18, 27, ch, 0.5, 0.85); p.line(18, 27, 23, 22.6, ch, 0.5, 0.85); p.line(23, 22.6, 28, 27, ch, 0.5, 0.85);
      p.line(28, 27, 28, 34, ch, 0.5, 0.85); p.line(18, 34, 28, 34, ch, 0.5, 0.85); p.rect(21.4, 29.4, 3, 4.6, ch, 0.7);
      p.ell(34.5, 24, 2.6, 2.6, 0xe8d890, 0.9);
      for (let i = 0; i < 6; i++) { const a = i * 1.047; p.line(34.5 + Math.cos(a) * 3.6, 24 + Math.sin(a) * 3.6, 34.5 + Math.cos(a) * 5.2, 24 + Math.sin(a) * 5.2, 0xe8d890, 0.4, 0.85); }
      for (const fx of [31, 35.6]) { p.ell(fx, 30, 1.1, 1.1, ch, 0.85); p.line(fx, 31.2, fx, 34.6, ch, 0.45, 0.85); }
      // Two wooden cribs (the right one under a mobile), mattresses, blankets, a teddy.
      const wood = p.t(0x6a4a30, 0x9a7a52, 0xd0c4ae);
      for (const cx of [14, 40]) {
        const w = 23;
        p.shadow(cx + w / 2, yb + 0.5, w * 0.58, 0.4);
        for (const lx of [cx, cx + w - 1.6]) p.rect(lx, yb - 28, 1.6, 28, shade(wood, 0.8));
        p.rect(cx, yb - 12, w, 2, shade(wood, 0.9));
        p.roundRect(cx + 1, yb - 19, w - 2, 7.4, 2.4, p.t(0xc8c0a8, 0xe0d4c0, 0xd8e0e0));
        p.roundRect(cx + 1.6, yb - 21.4, 8, 4.2, 1.8, 0xf0ece0);
        p.rect(cx + 11, yb - 19, w - 12, 2, p.t(0x8a6a5a, 0xa87a6a, 0x7a9aaa), 0.9);
        for (let b = 0; b < 8; b++) p.rect(cx + 2.6 + b * 2.4, yb - 27, 0.8, 15, wood);
        p.rect(cx - 0.4, yb - 28.4, w + 0.8, 1.6, wood);
      }
      p.ell(33.6, yb - 21, 2, 2, 0xa8825a);
      p.ell(33.6, yb - 24, 1.4, 1.4, 0xa8825a);
      p.line(52, 10, 52, 28, 0x4a3a2c, 0.4);
      p.line(45, 28, 59, 28, 0x4a3a2c, 0.4);
      for (const [mx, c] of [[46, 0xd89a6a], [52, 0x8ab0c8], [58, 0xc8b86a]] as const) {
        p.line(mx, 28, mx, 33, 0x4a3a2c, 0.3);
        p.ell(mx, 34.4, 1.7, 1.7, c);
        p.fx('twinkle', mx, 34.4, { color: c, size: 0.9 });
      }
      // Toy shelf and a stool on the right, a play mat with blocks on the floor.
      p.rect(66, yb - 34, 13, 1.4, shade(WOOD, 0.8));
      p.rect(66, yb - 18, 13, 1.4, shade(WOOD, 0.8));
      p.rect(66, yb - 34, 1.2, 34, shade(WOOD, 0.7));
      p.rect(77.8, yb - 34, 1.2, 34, shade(WOOD, 0.7));
      for (const [bx, by, bw, bh, c] of [[68, yb - 34, 3.6, 3.6, 0xb89a6a], [72, yb - 34, 3.6, 5.4, 0x7a9aaa], [68.5, yb - 18, 4, 4, 0xa86a5a], [73, yb - 18, 3.2, 6.6, 0x8aa07a]] as const) p.box(bx, by, bw, bh, mute(c, 0.15), 1.2, { shadow: false });
      p.rect(69, yb - 6, 5.6, 1.4, 0x6a4a30);
      p.rect(69.6, yb - 5, 1, 5, 0x5a3a28);
      p.rect(72.8, yb - 5, 1, 5, 0x5a3a28);
      p.seat(72, yb - 6.4, -1, 'sit');
      p.ell(40, yb + 8.5, 20, 4.4, p.t(0x5a6a58, 0x6a8a98, 0x8a6a8a), 0.9);
      p.ell(40, yb + 8.5, 16, 3.2, 0x000000, 0.12);
      for (const [bx, c] of [[30, 0xc8806a], [36, 0x7aa07a], [42, 0xc8b86a], [48, 0x7a8aaa]] as const) {
        p.box(bx, yb + 10.4 - (bx % 5) * 0.2, 4.2, 4.2, mute(c, 0.15), 1.6);
      }
      p.plate(46, 19, 14, 8, 'block', 0x5a4a38, 0xf0e4c8);
      if (p.tier === 0) p.stain(60, 30, 9, 0x2a1a10, 0.2);
      p.spot(0.42, 1, 'tend', 0.6);
      p.spot(0.7, -1, 'tend', 0.5);
    },
  },

  // ---------------------------------------------------------------- BL-30 school
  school: {
    slots: 3,
    pal: { wall: 0x625a4c, floor: 0x4c4238, accent: 0xe8e0c0, light: 0xffe6b0 },
    build(p) {
      const { yb } = p;
      p.lamp(p.t('bulb', 'tube', 'led'), 50, 9.5, { color: lampCol(p), r: 42, flicker: p.t(0.4, 0.2, 0.1) });
      p.lamp(p.t('bulb', 'tube', 'led'), 100, 9.5, { color: lampCol(p), r: 32, flicker: p.t(0.4, 0.2, 0.1) });
      // The blackboard with chalk pictograms and a tally, a chalk tray beneath.
      const ch = 0xe0dcc8;
      p.rect(21, 19, 62, 29, 0x4a3a2c);
      p.rectG(22.5, 20.5, 59, 26, [[0, 0x2a3a32], [1, 0x1e2a24]]);
      p.rect(22.5, 20.5, 59, 26, 0xffffff, 0.04);
      p.icon('sun', 32, 30, 5, ch, 0.75);
      p.icon('cog', 46, 31, 4.6, ch, 0.72);
      p.icon('drop', 58, 30, 4.2, ch, 0.75);
      p.icon('apple', 71, 31, 4.2, ch, 0.7);
      p.tally(26, 40, 4, ch);
      p.line(50, 40, 76, 40, ch, 0.4, 0.55);
      p.line(72, 38, 76, 40, ch, 0.4, 0.55);
      p.line(72, 42, 76, 40, ch, 0.4, 0.55);
      p.rect(22, 48, 60, 1.6, shade(WOOD, 0.9));
      p.rect(30, 47.4, 4, 0.8, 0xe8e4d8);
      // The teacher's desk, a world map and the bell.
      desk(p, 14, yb, 17, 13, p.t(0x5a4a3a, 0x6a5238, 0x3e4850));
      sprout(p, 20, yb - 13, 1);
      p.rect(92, 18, 31, 24, 0x3a2e22);
      p.rect(93.4, 19.4, 28.2, 21.2, 0xcfc4a0);
      for (const [bx, by, bw, bh] of [[96, 24, 8, 9], [106, 22, 9, 7], [108, 31, 6, 7], [99, 35, 7, 4]] as const) p.ell(bx + bw / 2, by + bh / 2, bw / 2, bh / 2, 0x8a9a6a, 0.85);
      p.ell(124, 14, 2.6, 2.6, 0xb89a3a);
      p.line(124, 9, 124, 12, 0x2a2a2a, 0.5);
      // Rows of small desks with benches; the children sit here.
      for (let i = 0; i < 4; i++) {
        const dx = 38 + i * 21;
        const top = p.t(0x6a5238, 0x8a6a46, 0x5a6870);
        p.shadow(dx + 6, yb + 6, 8, 0.35);
        p.rect(dx + 1.2, yb - 0.5, 1.2, 6.5, shade(top, 0.55));
        p.rect(dx + 9.6, yb - 0.5, 1.2, 6.5, shade(top, 0.55));
        p.box(dx, yb - 0.5, 12, 1.8, top, 3, { shadow: false });
        p.rect(dx + 3, yb - 3.4, 4, 1, 0xe0d8bc, 0.8);
        p.rect(dx - 5.5, yb - 1.6, 4.6, 1.2, shade(top, 0.7));
        p.rect(dx - 5, yb - 1, 0.9, 6, shade(top, 0.55));
        p.rect(dx - 2, yb - 1, 0.9, 6, shade(top, 0.55));
        p.seat(dx - 3.2, yb - 1.8, 1, 'sit');
      }
      p.plate(52, 11.5, 15, 6, 'apple', 0x4a3a28, 0xe8dcc0);
      if (p.tier === 0) {
        p.streak(88, 10, 24, 0x4a3a28, 0.3);
        crate(p, 118, yb + 7, 8);
      }
      p.spot(0.16, 1, 'inspect', 0.45);
      p.spot(0.46, -1, 'inspect', 0.7);
    },
  },

  // ---------------------------------------------------------------- BL-31 bathhouse
  bathhouse: {
    slots: 2,
    pal: { wall: 0x748480, floor: 0x586460, accent: 0x6ad0d8, light: 0xe8fff0 },
    build(p) {
      const { yb } = p;
      p.lamp(p.t('bulb', 'tube', 'led'), 46, 9.5, { color: mix(lampCol(p), 0xe8fff0, 0.2), r: 36, flicker: p.t(0.4, 0.2, 0.1) });
      // White tile over the lower wall: grout lines and the odd chipped tile.
      const tile = p.t(0x626c66, 0x7e8882, 0x949e98);
      p.rect(p.inL, 30, p.inR - p.inL, yb - 30 - 3, tile, 0.95);
      for (let y = 30; y < yb; y += 6) p.rect(p.inL, y, p.inR - p.inL, 0.5, 0x000000, 0.22);
      for (let x = p.inL; x < p.inR; x += 6) p.rect(x, 30, 0.5, yb - 33, 0x000000, 0.18);
      p.rect(p.inL, 30, p.inR - p.inL, 1.6, mix(p.pal.accent, 0x000000, 0.2));
      for (let i = 0; i < p.t(7, 3, 0); i++) p.rect(p.inL + 3 + p.vr() * 60, 32 + p.vr() * 48, 5.6, 5.6, 0x3a3a38, 0.5);
      // Three shower heads on rising pipes; steam and water.
      for (const hx of [22, 34, 46]) {
        pipeV(p, hx, 12, 34, p.t(0x6a5648, 0x8a9096, 0xb0b4b0));
        p.rect(hx - 0.4, 34, 0.8, 4, 0x6a6e72);
        p.poly([hx - 3.4, 38, hx + 3.4, 38, hx + 2, 40.4, hx - 2, 40.4], p.t(0x6a6e72, 0x9a9e9c, 0xc8a85a));
        p.fx('stream', hx, 40.6, { to: yb - 1, color: 0xcfeaf4, size: 1.6, ring: 5, work: true });
      }
      p.fx('steam', 34, yb - 28, { color: 0xe8f0f0, size: 9, rate: 0.8 });
      p.fx('drip', 22, 41, { to: yb, color: 0xcfeaf4, rate: 0.6 });
      // A slatted wooden bench, a tub with steam, and towels on a line.
      p.rect(18, yb - 9, 32, 2, 0x8a6a46);
      for (let x = 19; x < 50; x += 6) p.rect(x, yb - 9, 0.6, 2, 0x000000, 0.3);
      for (const lx of [20, 47]) p.rect(lx, yb - 7, 1.6, 7, 0x5a4a3a);
      p.seat(30, yb - 9, 1, 'sit');
      p.seat(42, yb - 9, -1, 'sit');
      p.cyl(68, yb + 2, 10, 13, 0x7a5a3c, 0x9ad4e0);
      p.ell(68, yb - 11, 8.4, 2.4, 0x7ac4d4, 0.85);
      p.fx('steam', 68, yb - 12, { color: 0xe8f0f0, size: 6, rate: 0.6 });
      p.wire(14, 26, 78, 26, 4, 0x2a2a2a, 0.4);
      for (const [tx, c] of [[28, 0xc8c0b0], [38, 0x8aa0aa], [62, 0xb89a8a]] as const) p.rect(tx, 26.6, 6, 8, c, 0.95);
      p.plate(62, 19, 14, 8, 'steam', 0x244a52, 0xd8f0f0);
      p.rect(28, yb + 6, 30, 2.6, 0x1e2422);
      for (let gx = 29; gx < 58; gx += 2.6) p.rect(gx, yb + 6, 0.7, 2.6, 0x000000, 0.5);
      p.spot(0.5, 1, 'idle', 0.55);
    },
  },

  // ---------------------------------------------------------------- BL-32 memorial hall
  memorialHall: {
    slots: 2,
    pal: { wall: 0x4e4850, floor: 0x3e3a3e, accent: 0xe8a850, light: 0xffc880 },
    dim: 0.06,
    build(p) {
      const { yb } = p;
      p.lamp('bulb', 46, 9.5, { color: 0xffc27a, r: 26, flicker: 0.5, pool: 0.9 });
      // The wall of names: small slate plaques in rows (scraps of cardboard when salvaged); tiers fill more of the wall.
      const rows = 5, cols = 8;
      const filled = p.t(0.45, 0.7, 0.92);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = 17.5 + c * 6.9, y = 17 + r * 7.6;
          if (p.vr() > filled) continue;
          p.rect(x, y, 5.6, 6.4, p.t(0x7a7060, 0x2e2e34, 0x34343a), 0.95);
          p.rect(x, y, 5.6, 0.5, 0xffffff, 0.14);
          p.rect(x + 0.9, y + 1.8, 3.8, 0.45, p.t(0x3a3226, 0xc8c0a8, 0xd8d0b0), 0.6);
          p.rect(x + 1.4, y + 3.2, 2.8, 0.45, p.t(0x3a3226, 0xc8c0a8, 0xd8d0b0), 0.5);
        }
      }
      // A ledge of candles, a pedestal with a star, and two banners.
      p.rect(15, yb - 25, 62, 2, shade(WOOD, 0.75));
      for (const cx of [20, 28, 36, 56, 64, 72]) {
        p.rect(cx - 1, yb - 31, 2, 6, 0xe0d8c0);
        p.ell(cx, yb - 31.6, 1, 0.5, 0xfff0c8, 0.8);
        p.glow(cx, yb - 34, 7, 0xffb35a, { a: 0.7, live: false });
        p.fx('flame', cx, yb - 33.4, { color: 0xffb35a, size: 0.9, rate: 0.7 + (cx % 3) * 0.1 });
      }
      p.box(40, yb, 12, 23, p.t(0x4a463e, 0x4a4a52, 0x5a5a62), 3);
      p.rect(40, yb - 23, 12, 1, 0xffffff, 0.15);
      p.icon('star', 46, yb - 14, 3.4, p.t(0xb89a5a, 0xd8b868, 0xf0d078));
      p.glow(46, yb - 14, 10, 0xffc27a, { a: 0.28 });
      for (const bx of [13.6, 75.4]) {
        p.rect(bx, 12, 3.6, 38, 0x6a2a28, 0.95);
        p.poly([bx, 50, bx + 3.6, 50, bx + 1.8, 53], 0x6a2a28);
        p.rect(bx, 12, 3.6, 1, 0xffffff, 0.14);
        p.icon('star', bx + 1.8, 22, 1.3, 0xd8b868, 0.8);
      }
      for (const [bx, w] of [[18, 22], [52, 22]] as const) {
        p.rect(bx, yb + 5.5, w, 2.2, 0x4a3a2c);
        p.rect(bx + 1, yb + 7.5, 1.6, 3, 0x3a2c20);
        p.rect(bx + w - 2.6, yb + 7.5, 1.6, 3, 0x3a2c20);
      }
      p.seat(29, yb + 5, 1, 'sit');
      p.seat(63, yb + 5, -1, 'sit');
      if (p.tier === 2) {
        // The eternal flame: a bowl up front with a tall live flame.
        p.cyl(46, yb + 8, 5, 5, 0x6a5a3a, 0x2a2018);
        p.glow(46, yb - 2, 20, 0xffb35a, { a: 0.9 });
        p.fx('flame', 46, yb, { color: 0xffb35a, size: 2.4, rate: 0.6 });
      }
      p.spot(0.5, 1, 'idle', 0.55);
    },
  },
};

void cables;
void chair;
void desk;
void blastDoor;
void ladder;
void led;
void notice;
void screenPanel;
void awning;
void barrel;
void crate;
void glassPane;
void mix;
