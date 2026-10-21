// v2 pre-rendered 3D rooms (tools/blender -> tools/v2pack.py): a static background plus the moving regions of a loop.
// The machines run at the crew's pace: an idle room winds down and stops, a busy one runs at full speed.
import { Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js';

interface AnimMeta {
  w: number; h: number; fps: number; frames: number;
  rects: { x: number; y: number; w: number; h: number; cells: [number, number][] }[];
  atlas: [number, number] | null;
}

export interface Room3DData { bg: Texture; meta: AnimMeta; cells: Texture[][] }

const ART = `${import.meta.env.BASE_URL}art/v2/`;
const cache = new Map<string, Promise<Room3DData | null>>();

/** Loads a room's background, atlas and frame table once; null when the room has no 3D render yet. */
export function loadRoom3D(art: string): Promise<Room3DData | null> {
  let p = cache.get(art);
  if (!p) {
    p = (async () => {
      const r = await fetch(`${ART}${art}/anim.json`);
      if (!r.ok) return null;
      const meta = (await r.json()) as AnimMeta;
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
  }

  update(dt: number, activity: number): void {
    // spin up fast, wind down slowly
    const target = activity > 0.01 ? 0.35 + 0.65 * activity : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * (target > this.speed ? 4 : 1.2));
    this.t += dt * this.speed;
    const n = this.d.meta.frames;
    const k = Math.floor(this.t * this.d.meta.fps) % n;
    for (let i = 0; i < this.parts.length; i++) this.parts[i].texture = this.d.cells[i][k];
  }
}
