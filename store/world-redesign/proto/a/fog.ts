/**
 * Fog of war: a low-res render texture (1 texel = T.render.fogCell world units) holding darkness.
 * Revealing = rendering soft brushes into it with the 'erase' blend mode. Upscaled bilinearly it
 * gives soft, organic edges for free; two jittered copies make the edge "breathe".
 */
import { BlurFilter, Container, Graphics, Renderer, RenderTexture, Sprite, TilingSprite } from 'pixi.js';
import { T } from './tokens';
import type { Textures } from './textures';
import { holes, startExplored } from './scene';
import { smooth } from './util';

export function buildFog(renderer: Renderer, tx: Textures) {
  const W = T.world.width, H = T.world.height, cell = T.render.fogCell;
  const G = T.world.groundY;
  const top = G - 40;                       // fog never covers the sky
  const rt = RenderTexture.create({ width: Math.ceil(W / cell), height: Math.ceil((H - top) / cell), resolution: 1 });
  const layer = new Container();

  const main = new Sprite(rt);
  main.x = 0; main.y = top; main.scale.set(cell);
  main.tint = T.palette.fogOfWar;
  const halo1 = new Sprite(rt), halo2 = new Sprite(rt);
  for (const h of [halo1, halo2]) { h.scale.set(cell * 1.0); h.y = top; h.tint = T.palette.fogOfWar; h.alpha = T.fog.edgeBreath; }
  // the world beyond the map edges is always unexplored
  const frame = new Graphics();
  const E = 5000;
  frame.rect(-E, top, E, H - top + E).fill({ color: T.palette.fogOfWar, alpha: T.fog.density });
  frame.rect(W, top, E, H - top + E).fill({ color: T.palette.fogOfWar, alpha: T.fog.density });
  frame.rect(0, H, W, E).fill({ color: T.palette.fogOfWar, alpha: T.fog.density });
  layer.addChild(frame, halo1, main);

  const brush = new Sprite(tx.brush);
  brush.anchor.set(0.5);
  brush.blendMode = 'erase';
  const brushRoot = new Container();
  brushRoot.addChild(brush);

  const reveals: { x: number; y: number; t: number; r: number }[] = [];
  const history: { x: number; y: number; r: number }[] = [];
  let all = false;

  /** blend modes are ignored on the root of a render call, so always wrap */
  function erase(d: Container) {
    d.blendMode = 'erase';
    const w = new Container(); w.addChild(d);
    renderer.render({ container: w, target: rt, clear: false });
    w.removeChild(d);
  }

  function reset() {
    const c = new Container();
    const base = new Graphics();
    base.rect(0, 0, rt.width, rt.height).fill({ color: 0xffffff, alpha: T.fog.density });
    const n = new TilingSprite({ texture: tx.noise, width: rt.width, height: rt.height });
    n.tileScale.set(0.6);
    n.tint = 0x000000; n.alpha = T.fog.noiseAlpha * 0.25;
    c.addChild(base, n);
    renderer.render({ container: c, target: rt, clear: true, clearColor: [0, 0, 0, 0] });
    // fade the top rows (sky side) out
    const fade = new Graphics();
    for (let i = 0; i < 6; i++) fade.rect(0, i, rt.width, 1).fill({ color: 0xffffff, alpha: 1 - i / 6 });
    erase(fade);
    // erase the areas that start explored (blurred → soft)
    const ex = new Graphics();
    const toFog = (pts: number[]) => pts.map((v, i) => (i % 2 ? (v - top) / cell : v / cell));
    for (const p of startExplored) ex.poly(toFog(p)).fill({ color: 0xffffff, alpha: 1 });
    for (const h of holes) if (h.explored) ex.poly(toFog(h.pts)).fill({ color: 0xffffff, alpha: 1 });
    // the dark edge: half-seen rubble with something glowing beyond
    ex.poly(toFog([150, 880, 440, 870, 440, 1040, 150, 1040])).fill({ color: 0xffffff, alpha: 0.55 });
    ex.poly(toFog([40, 900, 150, 880, 150, 1040, 40, 1040])).fill({ color: 0xffffff, alpha: 0.3 });
    // blur the mask in a scratch texture, then erase with it
    const tmp = RenderTexture.create({ width: rt.width, height: rt.height, resolution: 1 });
    ex.filters = [new BlurFilter({ strength: 4, quality: 3 })];
    const holder = new Container(); holder.addChild(ex);
    renderer.render({ container: holder, target: tmp, clear: true, clearColor: [0, 0, 0, 0] });
    erase(new Sprite(tmp));
    ex.destroy(); tmp.destroy(true);
    reveals.length = 0;
    history.length = 0;
    all = false;
  }
  reset();

  return {
    layer,
    reset,
    reveal(x: number, y: number, r: number = T.fog.revealRadius) { reveals.push({ x, y, t: 0, r }); history.push({ x, y, r }); },
    /** has the player uncovered this point (by tapping near it)? */
    seen(x: number, y: number) { return all || history.some(h => Math.hypot(h.x - x, h.y - y) < h.r + 60); },
    revealAll() {
      all = true;
      const g = new Graphics();
      g.rect(0, 0, rt.width, rt.height).fill(0xffffff);
      erase(g);
      g.destroy();
    },
    update(t: number, dt: number) {
      const b = Math.sin(t * T.fog.breathSpeed * Math.PI * 2) * 0.5 + 0.5;
      const d = 6 + 10 * b;
      halo1.x = d; halo1.y = top + d;
      halo2.x = -d; halo2.y = top - d * 0.6;
      halo1.alpha = halo2.alpha = T.fog.edgeBreath * (0.6 + 0.4 * b);
      if (!reveals.length) return;
      for (let i = reveals.length - 1; i >= 0; i--) {
        const rv = reveals[i];
        rv.t += dt;
        const k = smooth(Math.min(1, rv.t / T.fog.revealTime));
        brush.x = rv.x / cell; brush.y = (rv.y - top) / cell;
        brush.width = brush.height = (rv.r * 2 * (0.25 + 0.75 * k)) / cell;
        brush.alpha = 0.35 + 0.65 * k;
        renderer.render({ container: brushRoot, target: rt, clear: false });
        if (rv.t >= T.fog.revealTime) reveals.splice(i, 1);
      }
    },
  };
}
