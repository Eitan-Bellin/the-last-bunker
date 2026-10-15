/**
 * [world:M1] The inside of a found pocket, by the name in its stable id (`p:<s>:<name>`, data/strata.ts). Draws into the pocket piece's
 * `g` (behind the rock rim: the hollow's own things) and the additive `lit`; adds the hollow's light. False for a pocket with no
 * dressing of its own (pockets.ts then shows crystals or a dusty chamber).
 */
import type { Graphics } from 'pixi.js';
import { PROPS, type StratumPalette } from '../../tokens';
import type { LightDef } from './types';
import { OUTLINE, rod, shade, vfill } from './kit';

export function pocketInside(id: string, g: Graphics, lit: Graphics, b: { x0: number; y0: number; x1: number; y1: number }, P: StratumPalette, lights: LightDef[]): boolean {
  const name = id.split(':')[2] ?? '';
  const area = id;
  const K = PROPS.kit, D = PROPS.district;
  const cx = (b.x0 + b.x1) / 2, fy = b.y1 - 4, w = b.x1 - b.x0;
  const floorLine = (): void => { g.rect(b.x0 + 8, fy, w - 16, 5).fill(vfill(P.rockDark, fy, fy + 5)); };
  const water = (y: number): void => {
    g.rect(b.x0 + 10, y, w - 20, fy + 4 - y).fill(vfill(D.water, y, fy + 4, 1.2, 0.5));
    for (let x = b.x0 + 14; x < b.x1 - 20; x += 16) lit.rect(x, y + 1, 8, 0.8).fill({ color: D.waterLine, alpha: 0.4 });
  };
  switch (name) {
    case 'wellRoom': {
      floorLine();
      g.rect(cx - 14, fy - 14, 28, 14).fill(vfill(PROPS.rock.tint, fy - 14, fy)).stroke({ ...OUTLINE, width: 1 });
      for (let x = cx - 12; x < cx + 12; x += 7) g.rect(x, fy - 14, 0.8, 14).fill({ color: 0x000000, alpha: 0.3 });
      rod(g, cx - 12, fy - 14, cx - 12, fy - 34, 2, K.mine.timber);
      rod(g, cx + 12, fy - 14, cx + 12, fy - 34, 2, K.mine.timber);
      rod(g, cx - 14, fy - 32, cx + 14, fy - 32, 2.4, K.mine.timberDark);
      rod(g, cx + 3, fy - 32, cx + 3, fy - 20, 0.7, K.mine.rope);
      g.rect(cx, fy - 22, 6, 5).fill(K.mine.iron);
      lit.ellipse(cx, fy - 13, 10, 1.4).fill({ color: D.waterLine, alpha: 0.4 });
      lights.push({ x: cx + 18, y: fy - 20, preset: 'lantern', kind: 'shell', area });
      return true;
    }
    case 'oldChapel': {
      floorLine();
      const ny = fy - 46;
      g.poly([cx - 16, fy, cx - 16, ny + 12, cx - 10, ny + 2, cx, ny - 2, cx + 10, ny + 2, cx + 16, ny + 12, cx + 16, fy]).fill(vfill(shade(P.builtDark, 0.8), ny, fy)).stroke({ ...OUTLINE, width: 1 });
      g.rect(cx - 12, fy - 10, 24, 10).fill(vfill(PROPS.hub.benchSeat, fy - 10, fy)).stroke({ ...OUTLINE, width: 0.8 });
      for (const dx of [-8, -3, 2, 7]) {
        g.rect(cx + dx, fy - 16, 2, 6).fill(0xe8e0c8);
        lit.ellipse(cx + dx + 1, fy - 18, 1.4, 2.4).fill({ color: PROPS.hub.flameCore, alpha: 0.9 });
      }
      lights.push({ x: cx, y: fy - 18, preset: 'lantern', kind: 'shell', area, radius: 90 });
      return true;
    }
    case 'pumpGallery':
    case 'valveVault': {
      floorLine();
      g.rect(b.x0 + 10, fy - 30, w - 20, 6).fill(vfill(K.service.pipe, fy - 30, fy - 24)).stroke({ ...OUTLINE, width: 1 });
      for (let x = b.x0 + 24; x < b.x1 - 20; x += name === 'valveVault' ? 18 : 40) {
        rod(g, x, fy - 24, x, fy, 3, K.service.pipe);
        g.circle(x, fy - 36, 4.6).stroke({ width: 1.8, color: K.service.valve });
      }
      lights.push({ x: cx, y: fy - 40, preset: 'fluoroTube', kind: 'shell', area, radius: 90 });
      return true;
    }
    case 'ghostPlatform':
    case 'tokenBooth': {
      g.rect(b.x0 + 10, b.y0 + 14, w - 20, fy - b.y0 - 14).fill({ color: K.station.tile, alpha: 0.35 });
      g.rect(b.x0 + 10, fy - 6, w - 20, 10).fill(vfill(shade(K.station.tile, 0.6), fy - 6, fy + 4)).stroke({ ...OUTLINE, width: 1 });
      for (let x = b.x0 + 12; x < b.x1 - 12; x += 10) g.rect(x, fy - 6, 6, 1.6).fill(D.platformEdge);
      if (name === 'tokenBooth') {
        g.rect(cx - 10, fy - 34, 20, 28).fill(vfill(K.station.trim, fy - 34, fy - 6)).stroke({ ...OUTLINE, width: 1 });
        g.rect(cx - 6, fy - 28, 12, 8).fill(shade(D.carWindow, 0.5));
        lit.rect(cx - 5, fy - 27, 10, 6).fill({ color: D.carWindow, alpha: 0.4 });
      } else {
        g.roundRect(cx - 22, fy - 40, 44, 10, 2).fill(K.station.plate).stroke({ width: 1.2, color: K.station.plateRim });
      }
      lights.push({ x: cx, y: fy - 30, preset: 'sodium', kind: 'shell', area, radius: 100 });
      return true;
    }
    case 'floodedDrift':
    case 'echoLake': {
      water(fy - (name === 'echoLake' ? 18 : 12));
      if (name === 'floodedDrift') for (const x of [b.x0 + 24, b.x1 - 24]) rod(g, x, fy, x, b.y0 + 18, 3, K.mine.timber);
      lights.push({ x: cx, y: fy - 20, preset: name === 'echoLake' ? 'bioFungus' : 'lantern', kind: 'shell', area, radius: 90 });
      return true;
    }
    case 'canaryNiche': {
      floorLine();
      rod(g, cx, b.y0 + 12, cx, fy - 34, 0.7, K.mine.rope);
      g.roundRect(cx - 6, fy - 34, 12, 14, 4).stroke({ width: 1, color: K.forge.brass });
      for (let x = cx - 4; x <= cx + 4; x += 2.6) rod(g, x, fy - 33, x, fy - 21, 0.4, K.forge.brass);
      g.ellipse(cx, fy - 25, 2.4, 1.6).fill(0xe8c840);
      lights.push({ x: cx + 12, y: fy - 16, preset: 'lantern', kind: 'shell', area });
      return true;
    }
    case 'heartVent': {
      const pts = [b.x0 + 16, fy + 2];
      for (let x = b.x0 + 16; x < b.x1 - 16; x += 8) pts.push(x, fy - 6 - ((x * 13) % 7));
      pts.push(b.x1 - 16, fy + 2);
      lit.poly(pts).fill({ color: K.forge.magma, alpha: 0.75 });
      lights.push({ x: cx, y: fy, preset: 'magma', kind: 'shell', area });
      return true;
    }
    case 'sealedLab': {
      floorLine();
      g.circle(b.x0 + 26, fy - 24, 18).fill(vfill(K.forge.brass, fy - 42, fy - 6, 1.1, 0.55)).stroke(OUTLINE);
      g.circle(b.x0 + 26, fy - 24, 12).stroke({ width: 2, color: shade(K.forge.brass, 0.7) });
      for (let i = 0; i < 2; i++) {
        g.rect(cx + i * 22 - 4, fy - 30, 16, 12).fill(0x0a1410).stroke({ ...OUTLINE, width: 1 });
        lit.rect(cx + i * 22 - 3, fy - 29, 14, 10).fill({ color: 0x58d070, alpha: 0.3 });
      }
      lights.push({ x: cx + 10, y: fy - 24, preset: 'signal', kind: 'shell', area });
      return true;
    }
    default:
      return false;
  }
}
