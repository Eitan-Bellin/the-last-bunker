import { Container, Sprite, Text, Texture, type TextStyle, type TextStyleOptions } from 'pixi.js';
import { ICON_COLORS, isIcon, rasterizeIcon, rasterizedIcon, type IconName } from '../ui/icons';

const ICON_PX = 64;
const textures = new Map<string, Texture>();

function colorOf(name: IconName, color?: string): string {
  return color ?? ICON_COLORS[name] ?? '#ffffff';
}

function cachedTexture(name: IconName, color: string): Texture | null {
  const key = `${name}|${color}`;
  const hit = textures.get(key);
  if (hit) return hit;
  const canvas = rasterizedIcon(name, color, ICON_PX);
  if (!canvas) return null;
  const tex = Texture.from(canvas);
  textures.set(key, tex);
  return tex;
}

/** Icon as a sprite of the given size; fills in as soon as the SVG has been rasterized. */
export function iconSprite(name: IconName, size: number, color?: string): Sprite {
  const c = colorOf(name, color);
  const tex = cachedTexture(name, c);
  const s = new Sprite(tex ?? Texture.EMPTY);
  s.anchor.set(0, 0.5);
  s.width = s.height = size;
  if (!tex) {
    void rasterizeIcon(name, c, ICON_PX).then(() => {
      if (s.destroyed) return;
      s.texture = cachedTexture(name, c)!;
      s.width = s.height = size;
    });
  }
  return s;
}

export async function preloadIcons(names: IconName[]): Promise<void> {
  await Promise.all(names.map(n => rasterizeIcon(n, colorOf(n), ICON_PX)));
}

const HEBREW = /[֐-׿]/;

/**
 * One line of text with [[icon]] tokens rendered as sprites, centered on the origin.
 * In right-to-left lines the pieces are laid out from the right.
 */
export function richLine(text: string, style: TextStyleOptions | TextStyle, iconSize: number, rtl = false, resolution = 3): Container {
  const root = new Container();
  const pieces: Container[] = [];
  for (const part of text.split(/(\[\[[a-zA-Z0-9]+\]\])/)) {
    if (!part) continue;
    const m = /^\[\[([a-zA-Z0-9]+)\]\]$/.exec(part);
    if (m && isIcon(m[1])) {
      pieces.push(iconSprite(m[1], iconSize));
      continue;
    }
    const t = part.trim();
    if (!t) continue;
    const txt = new Text({ text: t, style, resolution });
    txt.anchor.set(0, 0.5);
    pieces.push(txt);
  }
  if (rtl && HEBREW.test(text)) pieces.reverse();
  const gap = Math.max(2, iconSize * 0.22);
  let x = 0;
  for (const p of pieces) {
    p.x = x;
    x += (p instanceof Sprite ? iconSize : p.width) + gap;
    root.addChild(p);
  }
  const width = Math.max(0, x - gap);
  root.pivot.x = width / 2;
  (root as Container & { lineWidth: number }).lineWidth = width;
  return root;
}

export function lineWidth(c: Container): number {
  return (c as Container & { lineWidth?: number }).lineWidth ?? c.width;
}
