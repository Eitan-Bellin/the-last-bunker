import { Container, Graphics, Sprite } from 'pixi.js';
import type { BuildingType } from '../core/GameState';
import { isIcon } from '../ui/icons';
import { iconSprite } from './richText';
import { CATEGORY } from './cityMap';

/**
 * [airy:B1/B4] The clarity layer of a room: what makes the bunker read as zones instead of one lump of equally busy paintings.
 *   under (between the painting and the people): a flat wash in the room's trade colour, a ceiling band in it, a big icon plate at mid zoom;
 *   over  (above the people): a black shade that dims the room when something else is selected (focus mode).
 * The painting underneath is not touched: the wash is simply drawn over it, so the look comes back by itself when the zoom closes in.
 */

const BAND_H = 9;
/** The structure's ceiling pipe bundle covers the top of the painting: the band sits just under it. */
const BAND_Y = 7;

/** The trade colour of a room type (the far city map's), falling back to the building's own colour. */
export function categoryColor(type: BuildingType, fallback: number): number {
  return CATEGORY[type] ?? fallback;
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const lift = (c: number, k: number): number => {
  const ch = (s: number) => Math.round(((c >> s) & 255) * (1 - k) + 255 * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

export interface RoomClarity {
  under: Container;
  over: Container;
  wash: Graphics;
  band: Graphics;
  /** The icon plate shown at mid zoom (centre of the room). */
  plate: Container;
  /** The small icon in the band's corner (always on). */
  pin: Container;
  shade: Graphics;
  /** What the shade is heading for (0 = none). */
  shadeTo: number;
  /** Last clarity applied (so a view only redraws when it moved). */
  k: number;
  color: number;
}

export function buildClarity(type: BuildingType, color: number, w: number, h: number): RoomClarity {
  const under = new Container();
  const over = new Container();
  under.eventMode = over.eventMode = 'none';
  const wash = new Graphics();
  wash.rect(0, 0, w, h).fill(color);
  wash.alpha = 0;
  // The ceiling band: a solid stripe of the trade colour with a soft fall-off under it and a dark line that seats it on the ceiling.
  const band = new Graphics();
  // (Stepped rects, not a gradient: a gradient is a texture of its own and every room would break the batch.)
  for (let i = 0; i < 4; i++) band.rect(0, BAND_H + i * 3, w, 3).fill({ color, alpha: 0.28 - i * 0.07 });
  band.rect(0, 0, w, BAND_H).fill({ color, alpha: 0.92 });
  band.rect(0, BAND_H, w, 1.2).fill({ color: 0x000000, alpha: 0.55 });
  band.rect(0, 0, w, 1.2).fill({ color: 0xffffff, alpha: 0.3 });
  band.y = BAND_Y;
  band.alpha = 0.8;
  const plate = new Container();
  const pin = new Container();
  const name = String(type);
  if (isIcon(name)) {
    const R = Math.min(w, h) * 0.26;
    const disc = new Graphics();
    disc.circle(0, 0, R).fill({ color: 0x0a0e14, alpha: 0.55 }).stroke({ color, width: 2, alpha: 0.95 });
    const ic = iconSprite(name, R * 1.2, hex(lift(color, 0.25)));
    ic.anchor.set(0.5);
    plate.addChild(disc, ic);
    plate.position.set(w / 2, h * 0.5);
    plate.visible = false;
    const pr = 6.4;
    const px = Math.min(w - pr - 3, 11), py = BAND_H + pr + 2; // (in the band's own space, so the chip is part of its one Graphics)
    band.circle(px, py, pr).fill({ color: 0x0a0e14, alpha: 0.78 }).stroke({ color, width: 1, alpha: 0.95 });
    const pi: Sprite = iconSprite(name, pr * 1.45, hex(lift(color, 0.25)));
    pi.anchor.set(0.5);
    pin.addChild(pi);
    pin.position.set(px, BAND_Y + py);
  }
  under.addChild(wash, band, plate, pin);
  const shade = new Graphics();
  shade.rect(0, 0, w, h).fill(0x000000);
  shade.alpha = 0;
  shade.visible = false;
  over.addChild(shade);
  return { under, over, wash, band, plate, pin, shade, shadeTo: 0, k: -1, color };
}

/** Puts the mid-zoom look on a room: `k` is labelState.clarity (0 close .. 1 mid). Cheap: a few property writes. */
export function applyClarity(c: RoomClarity, k: number): void {
  if (Math.abs(k - c.k) < 0.004) return;
  c.k = k;
  c.wash.alpha = 0.13 + 0.22 * k;
  c.band.alpha = 0.8 + 0.2 * k;
  const showPlate = k > 0.12;
  if (c.plate.visible !== showPlate) c.plate.visible = showPlate;
  if (showPlate) {
    c.plate.alpha = Math.min(1, (k - 0.12) * 1.6);
    c.plate.scale.set(0.8 + 0.4 * k);
  }
  c.pin.alpha = 1 - 0.7 * k;
}

/** Eases the focus shade toward its target; true while it is still moving. */
export function stepShade(c: RoomClarity, dt: number): boolean {
  const d = c.shadeTo - c.shade.alpha;
  if (Math.abs(d) < 0.004) {
    if (c.shade.alpha !== c.shadeTo) c.shade.alpha = c.shadeTo;
    const vis = c.shadeTo > 0;
    if (c.shade.visible !== vis) c.shade.visible = vis;
    return false;
  }
  c.shade.alpha += d * Math.min(1, dt * 9);
  c.shade.visible = true;
  return true;
}
