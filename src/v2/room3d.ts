// v2 pre-rendered 3D rooms (tools/blender -> tools/v2pack.py): a static background plus the moving regions of a loop.
// The machines run at the crew's pace: an idle room winds down and stops, a busy one runs at full speed.
import { Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { softDot } from './roomfx.ts';

interface AnimMeta {
  w: number; h: number; fps: number; frames: number; name?: string;
  rects: { x: number; y: number; w: number; h: number; cells: [number, number][] }[];
  atlas: [number, number] | null;
}

/** Light that flickers over a render (the render's own lights stay constant so the moving area stays small). */
interface Glow { x: number; y: number; r: number; color: number; base: number; amp: number; kind: 'fire' | 'arc' | 'pulse' }
const GLOWS: Record<string, Glow[]> = {
  alloyFoundry: [
    { x: 0.14, y: 0.74, r: 0.16, color: 0xff7a20, base: 0.2, amp: 0.18, kind: 'fire' },
    { x: 0.73, y: 0.74, r: 0.16, color: 0xff7a20, base: 0.2, amp: 0.18, kind: 'fire' },
    { x: 0.47, y: 0.62, r: 0.1, color: 0xff8a30, base: 0.15, amp: 0.2, kind: 'pulse' },
  ],
  componentsPlant: [{ x: 0.69, y: 0.73, r: 0.12, color: 0xb8d8ff, base: 0.0, amp: 0.7, kind: 'arc' }],
  reactor: [{ x: 0.48, y: 0.63, r: 0.18, color: 0x8cff50, base: 0.25, amp: 0.2, kind: 'pulse' }],
  surface: [{ x: 0.53, y: 0.86, r: 0.08, color: 0xff8030, base: 0.35, amp: 0.25, kind: 'fire' }],
};

export interface Room3DData { bg: Texture; meta: AnimMeta; cells: Texture[][] }

const ART = `${import.meta.env.BASE_URL}art/v2/`;
const cache = new Map<string, Promise<Room3DData | null>>();

/** Frees a room's textures (GPU memory) when it is far from the camera; it loads again on demand. */
export function releaseRoom3D(art: string): void {
  const p = cache.get(art);
  if (!p) return;
  cache.delete(art);
  void p.then(d => {
    if (!d) return;
    for (const row of d.cells) for (const t of row) t.destroy(false);
    void Assets.unload(`${ART}${art}/bg.webp`).catch(() => null);
    if (d.meta.atlas) void Assets.unload(`${ART}${art}/anim.webp`).catch(() => null);
  });
}

/** Loads a room's background, atlas and frame table once; null when the room has no 3D render yet. */
export function loadRoom3D(art: string): Promise<Room3DData | null> {
  let p = cache.get(art);
  if (!p) {
    p = (async () => {
      const r = await fetch(`${ART}${art}/anim.json`);
      if (!r.ok) return null;
      const meta = (await r.json()) as AnimMeta;
      meta.name = art;
      const bg = await Assets.load<Texture>({ src: `${ART}${art}/bg.webp`, data: { autoGenerateMipmaps: true } });
      let cells: Texture[][] = [];
      if (meta.atlas && meta.rects.length) {
        const atlas = await Assets.load<Texture>({ src: `${ART}${art}/anim.webp`, data: { autoGenerateMipmaps: true } });
        cells = meta.rects.map(rc => rc.cells.map(([x, y]) => new Texture({ source: atlas.source, frame: new Rectangle(x, y, rc.w, rc.h) })));
      }
      return { bg, meta, cells };
    })().catch(() => null);
    cache.set(art, p);
  }
  return p;
}

export class Room3D {
  readonly root = new Container();
  private parts: Sprite[] = [];
  private t = 0;
  private speed = 0;
  private d: Room3DData;
  private glows: { s: Sprite; g: Glow; ph: number }[] = [];
  private flick = 0;

  /** Fits the render into w x h world units. */
  constructor(d: Room3DData, w: number, h: number) {
    this.d = d;
    const bg = new Sprite(d.bg);
    const s = w / d.meta.w;
    bg.scale.set(s, h / d.meta.h);
    this.root.addChild(bg);
    d.meta.rects.forEach((rc, i) => {
      const sp = new Sprite(d.cells[i][0]);
      sp.position.set(rc.x * s, rc.y * (h / d.meta.h));
      sp.scale.set(s, h / d.meta.h);
      this.parts.push(sp);
      this.root.addChild(sp);
    });
    const glowLayer = new Container();
    glowLayer.blendMode = 'add';
    for (const g of GLOWS[d.meta.name ?? ''] ?? []) {
      const sp = new Sprite(softDot());
      sp.anchor.set(0.5);
      sp.tint = g.color;
      sp.position.set(g.x * w, g.y * h);
      sp.width = sp.height = g.r * 2 * w;
      sp.alpha = g.base;
      glowLayer.addChild(sp);
      this.glows.push({ s: sp, g, ph: Math.random() * 6 });
    }
    this.root.addChild(glowLayer);
  }

  update(dt: number, activity: number): void {
    // spin up fast, wind down slowly
    const target = activity > 0.01 ? 0.35 + 0.65 * activity : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * (target > this.speed ? 4 : 1.2));
    this.t += dt * this.speed;
    const n = this.d.meta.frames;
    const k = Math.floor(this.t * this.d.meta.fps) % n;
    for (let i = 0; i < this.parts.length; i++) this.parts[i].texture = this.d.cells[i][k];
    this.flick += dt;
    const on = Math.max(0.2, this.speed);
    for (const { s, g, ph } of this.glows) {
      const t = this.flick;
      const v = g.kind === 'fire' ? 0.6 * Math.sin(t * 11 + ph) + 0.4 * Math.sin(t * 23 + ph * 2) + (Math.random() - 0.5) * 0.4
        : g.kind === 'arc' ? (Math.random() < 0.55 ? 1 : 0)
        : Math.sin(t * 2.2 + ph);
      s.alpha = Math.max(0, (g.base + g.amp * v) * (g.kind === 'arc' ? this.speed : on));
    }
  }
}
