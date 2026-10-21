// v2 people: pre-rendered 3D workers (tools/blender/worker.py -> tools/v2people.py), one atlas per look, one row per
// animation. Walk cycles advance with the distance walked so the feet never slide.
import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';

export type WorkerAnim = 'idle' | 'walk' | 'walkCarry' | 'hammer' | 'lift' | 'tend' | 'type' | 'wrench' | 'inspect';

interface Look { cell: [number, number]; foot: [number, number]; pxPerMetre: number; fps: number; anims: Record<string, { row: number; n: number }>; frames: Record<string, Texture[]> }

const ART = `${import.meta.env.BASE_URL}art/v2/people/`;
/** World units per metre (the rooms are 10 m across 540 units). */
export const UNITS_PER_M = 54;
/** Metres a walk cycle covers (two steps). */
const STRIDE_M = 1.45;

let looks: Look[] = [];
let loading: Promise<void> | null = null;

export function loadPeople(): Promise<void> {
  loading ??= (async () => {
    const r = await fetch(`${ART}index.json`);
    if (!r.ok) return;
    const names = (await r.json()) as string[];
    looks = (await Promise.all(names.map(async n => {
      const info = (await (await fetch(`${ART}${n}.json`)).json()) as Look;
      const tex = await Assets.load<Texture>({ src: `${ART}${n}.webp`, data: { autoGenerateMipmaps: true } });
      info.frames = {};
      for (const [a, { row, n: count }] of Object.entries(info.anims)) {
        info.frames[a] = Array.from({ length: count }, (_, k) =>
          new Texture({ source: tex.source, frame: new Rectangle(k * info.cell[0], row * info.cell[1], info.cell[0], info.cell[1]) }));
      }
      return info;
    }))).filter(Boolean);
  })().catch(() => { looks = []; });
  return loading;
}

export function peopleReady(): boolean { return looks.length > 0; }

export class Worker3D {
  readonly root = new Container();
  private sprite = new Sprite(Texture.EMPTY);
  private look: Look;
  private t = Math.random() * 3;
  private walked = 0;
  private lastX = NaN;

  constructor(lookIndex: number) {
    this.look = looks[((lookIndex % looks.length) + looks.length) % looks.length];
    const shadow = new Graphics().ellipse(0, 0, 20, 5).fill({ color: 0x000000, alpha: 0.4 });
    const s = UNITS_PER_M / this.look.pxPerMetre;
    this.sprite.anchor.set(this.look.foot[0] / this.look.cell[0], this.look.foot[1] / this.look.cell[1]);
    this.sprite.scale.set(s);
    // rendered under studio light: bring them down to the rooms' lamp light
    this.sprite.tint = 0xcfc4b6;
    this.root.addChild(shadow, this.sprite);
  }

  update(dt: number, x: number, y: number, anim: WorkerAnim, faceRight: boolean): void {
    if (!Number.isNaN(this.lastX)) this.walked += Math.abs(x - this.lastX);
    this.lastX = x;
    this.t += dt;
    this.root.position.set(x, y);
    const fr = this.look.frames[anim] ?? this.look.frames.idle;
    const walking = anim === 'walk' || anim === 'walkCarry';
    const k = walking
      ? Math.floor((this.walked / (STRIDE_M * UNITS_PER_M)) * fr.length) % fr.length
      : Math.floor(this.t * this.look.fps) % fr.length;
    this.sprite.texture = fr[k];
    this.sprite.scale.x = Math.abs(this.sprite.scale.x) * (faceRight ? 1 : -1);
  }
}
