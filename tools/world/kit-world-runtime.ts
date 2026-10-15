/**
 * Runtime check for src/art/worldKit.ts: draws slice pieces with Pixi through the real accessors (tiling strips, sprites with
 * anchors and flips, emissive overlays, lamp spots). Default: the baked art after preloadWorldKit. `?standin`: draws at once,
 * before any file has arrived, so every piece shows its procedural stand-in.
 *   http://localhost:5176/tools/world/kit-world-runtime.html            baked art
 *   http://localhost:5176/tools/world/kit-world-runtime.html?standin    stand-ins only (no file is requested)
 * The page title becomes "RUNTIME OK <loaded>/<failed> gpu <MB>" when done.
 */
import { Application, Container, Graphics } from 'pixi.js';
import { makeWorldSprite, makeWorldTiling, preloadWorldKit, worldKitStats, worldLamps, worldTex } from '../../src/art/worldKit';
import { SLICE_ASSETS, WORLD_ASSETS, type WorldAssetId } from '../../src/world/tokensAssets';

const STANDIN = new URLSearchParams(location.search).has('standin');

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ width: 1200, height: 700, background: 0x0e0b0c, antialias: false });
  document.body.append(app.canvas);
  if (!STANDIN) await preloadWorldKit([...SLICE_ASSETS, 'door-open', 'door-welded', 'lamp-work', 'lamp-wall', 'timber-set', 'rubble-a']);
  else for (const id of Object.keys(WORLD_ASSETS) as WorldAssetId[]) worldTex(id); // stand-ins (loads start but we draw now)

  const world = new Container();
  world.scale.set(1.3);
  app.stage.addChild(world);
  // rock and the cavity
  world.addChild(makeWorldTiling('rock-shelter', 920, 540, {}));
  const band = makeWorldTiling('band-shelter', 920, 100);
  band.y = 30;
  world.addChild(band);
  const cav = new Container();
  cav.position.set(60, 110);
  world.addChild(cav);
  const wall = makeWorldTiling('hub-vault', 800, 384);
  cav.addChild(wall);
  const ao = makeWorldTiling('edge-ao', 800, 16);
  cav.addChild(ao);
  const rim = makeWorldTiling('edge-rim', 800, 8, { stratum: 1 });
  rim.y = -2;
  rim.alpha = 0.35;
  cav.addChild(rim);
  const deck = makeWorldTiling('deck', 260, 32);
  deck.y = 230;
  cav.addChild(deck);
  const rail = makeWorldTiling('railing', 260, 24, { stratum: 1 });
  rail.y = 230 - 24;
  cav.addChild(rail);
  for (let i = 0; i < 4; i++) {
    const s = makeWorldSprite('stair-flight', { flip: true });
    s.position.set(260 + (4 - i) * 38, 384 - i * 36);
    cav.addChild(s);
  }
  const place = (id: WorldAssetId, x: number, y: number, flip = false) => {
    const s = makeWorldSprite(id, { flip });
    s.position.set(x, y);
    cav.addChild(s);
    const e = WORLD_ASSETS[id].emissive ? makeWorldSprite(id, { flip, emissive: true }) : null;
    if (e) { e.position.set(x, y); cav.addChild(e); }
    // lamp spots as small yellow rings (what the lighting system would read)
    for (const L of worldLamps(id, x, y, flip)) cav.addChild(new Graphics().circle(L.x, L.y, 3).stroke({ color: 0xffff00, width: 1 }));
    return s;
  };
  place('door-closed', 600, 384);
  place('door-open', 680, 384);
  place('door-welded', 760, 384);
  place('lamp-chandelier', 420, 0);
  place('lamp-tube', 700, 2);
  place('lamp-work', 540, 384);
  place('lamp-wall', 120, 180);
  place('rubble-c', 110, 384);
  place('timber-set', 330, 384);
  // a 48-unit person for scale
  cav.addChild(new Graphics().rect(470, 336, 12, 48).fill({ color: 0xffd8a0, alpha: 0.6 }));
  // fore lip on top
  const lip = makeWorldTiling('fore-lip', 920, 128);
  world.addChild(lip);
  app.render();
  const st = worldKitStats();
  document.title = `RUNTIME OK ${st.loaded.length}/${st.failed.length} gpu ${(st.gpuBytes / 1048576).toFixed(1)}MB`;
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(st, null, 1);
  document.body.append(pre);
}

main().catch(e => { document.title = `RUNTIME ERROR ${e}`; console.error(e); });
