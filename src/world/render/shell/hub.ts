/**
 * [world:C1] The hub atrium of a stratum ("Bell Square" in stratum 1; style guide 12 beat 3): the vault back wall with its observation
 * window and wall lamps, the side walls with a doorway to each vestibule, a balcony per storey on each side (deck + railing on the corridor
 * lane), the zig-zag stair flights, the truss bridge in front of the lift, the plaza floor with its props, the ring chandelier and (from the
 * Colony era) the string lights.
 *
 * [world:M1] Every reached stratum gets its own hub language (CITY.kits, style guide 2), built on the same geometry so routes, balconies
 * and stairs never move: the Service Network's tiled pump hall with pipe racks, a wall fan and steel gantries; the Old Metro's station
 * hall in dirty glazed tile with teal trim, cast-iron columns, a dead tunnel mouth, the enamel plate and the clock; the Mines' hewn
 * chamber under a timber headframe with its winch wheel, timber decks, an ore cart and carbide lanterns; the Deep Caves' natural
 * cavern with a crack open onto the far dark, stilt platforms on rope, crystals and fungus; the Core's magma-lit forge chamber with
 * heat shields, the vault ring door and a magma seam under the plaza that lights it from below. The details live in `hubKits.ts`.
 */
import { Container, Graphics } from 'pixi.js';
import { CITY, DETAIL, PROPS, SIGNS, type StratumId } from '../../tokens';
import { WORLD_KIT_IDS, rockTileId } from '../../tokensAssets';
import { baseTier, type RenderTier } from '../../tokensRender';
import { SHAFT_W, floorTop } from '../../../rendering/geom';
import { floorLineY, storeyBottom } from '../../model/cityLayout';
import { archPoints, blobPoly } from '../../model/outline';
import type { HubGeom } from '../layoutTypes';
import type { LightDef, ShellPiece } from './types';
import { OUTLINE, contactShadow, grain, lamp, mix, palette, rng, rod, shade, sprite, tile, vfill } from './kit';
import type { PresetName } from '../lighting';
import { hubKitBack, hubKitFront, type HubCtx } from './hubKits';

const H = CITY.hub;
const HP = PROPS.hub;
const VAULT_PITCH = H.vaultPitch;
const DECK_H = H.deckH;
const RAIL_H = H.railH;

/** The key light hung in a stratum's hub: the ring chandelier up in the shelter, the stratum's own work light below. */
const HUB_KEY: Record<number, PresetName> = { 1: 'chandelier', 2: 'fluoroTube', 3: 'sodium', 4: 'floodlight', 5: 'crystal', 6: 'magma' };

export function buildHub(h: HubGeom, quality: RenderTier, era: number): ShellPiece {
  const s = h.s as StratumId;
  const P = palette(s);
  const kit = CITY.kits[s] ?? CITY.kits[1];
  const back = new Container();
  const front = new Container();
  const glow = new Container();
  back.label = `hub:${s}:back`;
  front.label = `hub:${s}:front`;
  const lights: LightDef[] = [];
  const top = floorTop(h.floors[0]);
  const fz = h.floors[h.floors.length - 1];
  const x0 = h.rect.x, x1 = h.rect.x + h.rect.w, y0 = h.rect.y, y1 = h.rect.y + h.rect.h;
  const cx = SHAFT_W / 2;
  const area = (f: number) => `f:${f}`;
  const dens = DETAIL[baseTier(quality)].density;
  const plazaY = h.balconies.find(b => b.floor === fz)?.y ?? floorLineY(fz) + 13;
  const ctx: HubCtx = { h, s, P, x0, x1, y0, y1, top, fz, cx, plazaY, dens, era, back, front, glow, lights, area };
  // The vault cut (raggedness included): the back wall must reach up into it.
  const yTopCut = y0 - kit.vaultRag - 4;

  // ----------------------------------------------------------------------------------------------------------- the vault wall
  const wall = new Container();
  if (kit.vault === 'hub') {
    const vault = tile('hub-vault', x0, y0, x1 - x0, y1 - y0);
    const k = VAULT_PITCH / H.vaultTileW;
    vault.tileScale.set(vault.tileScale.x * k, vault.tileScale.y * k);
    // A bay centred on the spine, every bay's bottom on a storey's floor line.
    vault.tilePosition.set(cx - VAULT_PITCH / 2 - x0, floorLineY(h.floors[0]) - VAULT_PITCH - y0);
    wall.addChild(vault);
  } else if (kit.vault === 'service' || kit.vault === 'station') {
    // Glazed tile halls: the corridor tile, locked to every storey's floor line, the service green or the metro's dirty cream.
    const tint = kit.vault === 'station' ? PROPS.kit.station.tile : mix(P.built, 0xffffff, 0.45);
    wall.addChild(tile('corridor-tile', x0, yTopCut, x1 - x0, y1 - yTopCut, { oy: floorLineY(h.floors[0]), tint }));
  } else {
    // Hewn or natural rock (mines, caves, core): the stratum's own rock painting, lit a step brighter than the cut face around it.
    const tint = kit.vault === 'forge' ? mix(PROPS.rock.tint, PROPS.kit.forge.basalt, 0.2) : mix(PROPS.rock.tint, 0xffffff, 0.22);
    wall.addChild(tile(rockTileId(WORLD_KIT_IDS[s]), x0, yTopCut, x1 - x0, y1 - yTopCut, { tint }));
  }
  // Depth: the wall darkens toward the top of the vault and toward the side walls (light falls from the key light and the balconies).
  const shadeG = new Graphics();
  for (let i = 0; i < 6; i++) {
    const t = i / 6;
    shadeG.rect(x0, yTopCut + (top - yTopCut) * t * 0.4, x1 - x0, 24).fill({ color: 0x000000, alpha: 0.05 });
  }
  for (const side of [-1, 1]) {
    const wx = side < 0 ? x0 + H.wallW : x1 - H.wallW;
    for (let i = 0; i < 5; i++) shadeG.rect(side < 0 ? wx : wx - 6 - i * 5, yTopCut, 6 + i * 5, y1 - yTopCut).fill({ color: 0x000000, alpha: 0.05 });
  }
  wall.addChild(shadeG);

  // The opening behind the spine: the observation window (shelter), a crack onto the far dark (caves); the other kits dress that wall.
  const winHalf = H.windowHalfW;
  const winTop = top - H.vaultRise + 18;
  const winBot = floorLineY(h.floors[0]) - 8;
  const roomForWindow = winHalf > 0 && winBot - winTop > 60;
  if (roomForWindow && kit.vault === 'hub') {
    const wx0 = cx - winHalf, wx1 = cx + winHalf;
    const spring = winTop + winHalf * 0.8;
    const arch = archPoints(wx0, wx1, spring, winHalf * 0.8, 18);
    const hole = new Graphics();
    hole.poly([wx0, winBot, ...arch, wx1, winBot]).fill(0xffffff);
    wall.addChild(hole);
    wall.setMask({ mask: hole, inverse: true });
    back.addChild(wall);
    // The frame: a heavy steel arch, mullions and transoms (thin parts in vector with the shared outline), a sill.
    const fr = new Graphics();
    const steel = shade(P.metal, 0.85);
    fr.poly([wx0, winBot, ...arch, wx1, winBot], true).stroke({ width: 6 + OUTLINE.width * 2, color: OUTLINE.color, alpha: OUTLINE.alpha, join: 'round' });
    fr.poly([wx0, winBot, ...arch, wx1, winBot], true).stroke({ width: 6, color: steel, join: 'round' });
    fr.poly([wx0 + 1, winBot, ...arch, wx1 - 1, winBot], true).stroke({ width: 1.2, color: shade(P.metal, 1.35), alpha: 0.7 });
    const archY = (x: number): number => {
      for (let i = 0; i < arch.length - 2; i += 2) if (x >= arch[i] && x <= arch[i + 2]) return arch[i + 1] + ((arch[i + 3] - arch[i + 1]) * (x - arch[i])) / (arch[i + 2] - arch[i]);
      return spring;
    };
    const mull = 3;
    for (let i = 1; i < mull; i++) {
      const x = wx0 + ((wx1 - wx0) * i) / mull;
      rod(fr, x, archY(x) + 2, x, winBot, H.windowMullion, steel);
    }
    for (let y = spring; y > winTop + 20; y -= 200) {
      const half = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, spring - y) / (winHalf * 0.8), 2))) * winHalf;
      if (half < 12) continue;
      rod(fr, cx - half + 2, y, cx + half - 2, y, 2.2, steel);
    }
    fr.rect(wx0 - 6, winBot - 2, wx1 - wx0 + 12, 6).fill(vfill(P.builtDark, winBot - 2, winBot + 4)).stroke(OUTLINE);
    back.addChild(fr);
  } else if (roomForWindow && kit.vault === 'cavern') {
    // A natural crack in the cavern's back wall onto the far planes: the deep caves go on beyond the hub.
    const hole = new Graphics();
    const crack = blobPoly(cx - winHalf * 0.9, winTop + 10, cx + winHalf * 0.9, winBot + 4, 5101 + s, 0.34, 24);
    hole.poly(crack).fill(0xffffff);
    wall.addChild(hole);
    wall.setMask({ mask: hole, inverse: true });
    back.addChild(wall);
    const lip = new Graphics();
    lip.poly(crack, true).stroke({ width: 3, color: P.rockRim, alpha: 0.45, join: 'round' });
    lip.poly(crack, true).stroke({ width: 8, color: 0x000000, alpha: 0.25, join: 'round' });
    back.addChild(lip);
  } else {
    back.addChild(wall);
  }
  back.addChild(grain(x0, yTopCut, x1 - x0, y1 - yTopCut, 0.1));

  // The kit's dressing on the back wall (pipes, tile trim, timber, flowstone, shields...) before the side walls.
  hubKitBack(ctx);

  // Side walls: concrete piers between the storeys (shelter, service, metro, core), timber posts in the mines, bare rock in the caves.
  const walls = new Graphics();
  if (kit.vault !== 'cavern') {
    for (const side of [-1, 1] as const) {
      const wx = side < 0 ? x0 : x1 - H.wallW;
      const wallCol = kit.vault === 'mine' ? PROPS.kit.mine.timberDark : kit.vault === 'forge' ? PROPS.kit.forge.shield : P.builtDark;
      walls.rect(wx, y0 + H.vaultRise * 0.6, H.wallW, y1 - y0 - H.vaultRise * 0.6).fill(vfill(wallCol, y0, y1));
      for (const f of h.floors) {
        const dTop = floorLineY(f) - 76, dBot = floorLineY(f) + 18;
        walls.rect(wx, dTop, H.wallW, dBot - dTop).fill({ color: HP.doorway, alpha: HP.doorwayAlpha });
        walls.rect(wx - 1, dTop - 4, H.wallW + 2, 5).fill(shade(wallCol, 1.25)).stroke({ ...OUTLINE, width: 1 });
        for (let y = dTop + 2; y < dBot - 4; y += 10) walls.rect(side < 0 ? wx + H.wallW - 2.5 : wx, y, 2.5, 5).fill(P.hazard);
      }
      walls.moveTo(side < 0 ? wx + H.wallW : wx, y0 + H.vaultRise * 0.6).lineTo(side < 0 ? wx + H.wallW : wx, y1).stroke({ ...OUTLINE, width: 1.2 });
    }
  } else {
    // The caves: each doorway is a dark mouth in the living rock, its lip rimmed.
    for (const side of [-1, 1] as const) {
      const wx = side < 0 ? x0 : x1 - H.wallW;
      for (const f of h.floors) {
        const dTop = floorLineY(f) - 76, dBot = floorLineY(f) + 18;
        const mouth = blobPoly(wx - 2, dTop - 8, wx + H.wallW + 2, dBot, 900 + f * 7 + side, 0.2, 14, true);
        walls.poly(mouth).fill({ color: HP.doorway, alpha: HP.doorwayAlpha });
        walls.poly(mouth, true).stroke({ width: 1.4, color: P.rockRim, alpha: 0.35 });
      }
    }
  }
  back.addChild(walls);

  // Soffit shadows under every balcony deck on the wall behind, and the plaza's contact line.
  const soff = new Graphics();
  for (const b of h.balconies) {
    if (b.floor === fz) continue;
    for (let i = 0; i < 4; i++) soff.rect(b.x0, b.y + DECK_H + i * 4, b.x1 - b.x0, 4).fill({ color: 0x000000, alpha: 0.16 - i * 0.035 });
  }
  back.addChild(soff);

  // Wall lamps, one per storey each side: brass sconces in the shelter, caged lamps in the service and core halls, sodium globes on the
  // metro's columns (hubKits), carbide lanterns hung from the mine's timbers, fungus and crystal clusters in the caves (hubKits).
  for (const f of h.floors) {
    for (const side of [-1, 1]) {
      const lx = side < 0 ? x0 + H.wallW + 30 : x1 - H.wallW - 30;
      const ly = floorTop(f) + 30;
      if (kit.vault === 'hub') lights.push(...lamp(back, glow, 'lamp-wall', lx, ly, { kind: 'civic', area: area(f) }));
      else if (kit.vault === 'service' || kit.vault === 'forge') lights.push(...lamp(back, glow, 'lamp-cage', lx, ly, { kind: 'civic', area: area(f) }, { flip: side > 0 }));
      else if (kit.vault === 'mine') {
        const hang = new Graphics();
        rod(hang, lx, ly - 18, lx, ly - 2, 0.8, PROPS.kit.mine.rope);
        back.addChild(hang);
        lights.push(...lamp(back, glow, 'lamp-lantern', lx, ly - 2, { kind: 'civic', area: area(f) }));
      }
    }
  }

  // A notice board on the plaza wall (stratum 1): pinned papers in the enamel palette.
  if (s === 1) {
    const nb = new Graphics();
    const bx = x0 + H.wallW + 12, by = floorLineY(fz) - 50;
    nb.rect(bx, by, 34, 24).fill(vfill(HP.noticeBoard, by, by + 24)).stroke(OUTLINE);
    const r = rng(77);
    for (let i = 0; i < 5; i++) {
      const px = bx + 3 + r() * 24, py = by + 3 + r() * 14;
      nb.rect(px, py, 6 + r() * 4, 7 + r() * 3).fill(mix(SIGNS.plate.text, HP.notePaper, r()));
      nb.circle(px + 3, py + 1, 0.8).fill(HP.notePin);
    }
    back.addChild(nb);
  }

  // ----------------------------------------------------------------------------------------------------------- stairs
  const stairs = new Container();
  const posts = new Graphics();
  const rails = new Graphics();
  const railCol = kit.deck === 'timber' || kit.deck === 'stilts' ? PROPS.kit.mine.rope : shade(P.secondary, 1.05);
  const postCol = kit.deck === 'timber' || kit.deck === 'stilts' ? PROPS.kit.mine.timber : P.metal;
  for (const st of h.stairs) {
    const half = 19;
    posts.rect(st.x - 23, st.top - 4, 3, st.bottom - st.top + 8).fill(vfill(postCol, st.top, st.bottom)).stroke({ ...OUTLINE, width: 1 });
    posts.rect(st.x + 20, st.top - 4, 3, st.bottom - st.top + 8).fill(vfill(shade(postCol, 0.8), st.top, st.bottom)).stroke({ ...OUTLINE, width: 1 });
    let k2 = 0;
    for (let y = st.top; y < st.bottom - 1; y += 36, k2++) {
      const even = k2 % 2 === 0;
      // Even flights run down to the left, odd ones down to the right (people zig-zag TOWER_AMP each way).
      const fl = sprite('stair-flight', even ? st.x - half : st.x + half, y + 36, { flip: !even });
      if (kit.deck === 'timber' || kit.deck === 'stilts') fl.tint = mix(PROPS.kit.mine.timber, 0xffffff, 0.45);
      stairs.addChild(fl);
      const xa = even ? st.x + half : st.x - half, xb = even ? st.x - half : st.x + half;
      rod(rails, xa, y - 14, xb, y + 36 - 14, kit.deck === 'stilts' ? 1 : 1.6, railCol);
      // The landing at the turn.
      const lx = even ? st.x - half - 6 : st.x + half - 6;
      posts.rect(lx, y + 36, 12, 3.5).fill(shade(postCol, 1.1)).stroke({ ...OUTLINE, width: 1 });
    }
  }
  front.addChild(posts, stairs, rails);

  // ----------------------------------------------------------------------------------------------------------- balconies, plaza, bridge
  const decks = new Container();
  const railsC = new Container();
  const under = new Graphics();
  const deckTint = kit.deck === 'gantry' ? mix(P.metal, 0xffffff, 0.35) : kit.deck === 'timber' || kit.deck === 'stilts' ? mix(PROPS.kit.mine.timber, 0xffffff, 0.4) : undefined;
  for (const b of h.balconies) {
    const w = b.x1 - b.x0;
    if (b.floor === fz) continue;
    decks.addChild(tile('deck', b.x0, b.y, w, DECK_H, deckTint !== undefined ? { tint: deckTint } : {}));
    if (kit.deck === 'balcony' || kit.deck === 'gantry') {
      railsC.addChild(tile('railing', b.x0, b.y - RAIL_H, w, RAIL_H, kit.deck === 'gantry' ? { tint: mix(P.metal, 0xffffff, 0.5) } : { stratum: s }));
    } else {
      // Rope rails on timber stanchions (mines) or on the stilts' poles (caves).
      for (let x = b.x0 + 4; x <= b.x1 - 2; x += 22) rod(under, x, b.y - 18, x, b.y + 2, 2, PROPS.kit.mine.timber);
      const sag: number[] = [];
      for (let x = b.x0 + 4; x <= b.x1 - 2; x += 4) sag.push(x, b.y - 16 + Math.sin(((x - b.x0 - 4) / 22) * Math.PI) * 2.5);
      under.poly(sag, false).stroke({ width: 1, color: PROPS.kit.mine.rope });
    }
    if (kit.deck === 'gantry') {
      // A steel gantry: a lattice under the deck back to the wall.
      const ty0 = b.y + DECK_H * 0.6, ty1 = ty0 + 12;
      for (let x = b.x0; x < b.x1 - 6; x += 12) rod(under, x, ty0, x + 12, ty1, 1.1, shade(P.metal, 0.9));
      rod(under, b.x0, ty1, b.x1, ty1, 1.5, P.metal);
    } else if (kit.deck === 'stilts') {
      // Stilt poles down to the plaza (or to the next platform) and cross-lashing.
      const down = Math.min(plazaY, b.y + 144) - b.y;
      for (const x of [b.x0 + 10, (b.x0 + b.x1) / 2, b.x1 - 10]) rod(under, x, b.y + DECK_H * 0.5, x + (x < cx ? -3 : 3), b.y + down, 2.4, PROPS.kit.mine.timberDark);
    }
  }
  // The plaza floor of the bottom storey: one deck across the atrium (no railing) on a concrete slab.
  const slab = new Graphics();
  const slabCol = kit.vault === 'mine' || kit.vault === 'cavern' ? shade(P.rockDark, 1.25) : P.builtDark;
  slab.rect(x0 + H.wallW, plazaY + DECK_H - 4, x1 - x0 - 2 * H.wallW, storeyBottom(fz) - plazaY - DECK_H + 4).fill(vfill(slabCol, plazaY, storeyBottom(fz)));
  slab.rect(x0 + H.wallW, storeyBottom(fz) - 3, x1 - x0 - 2 * H.wallW, 3).fill(shade(slabCol, 0.6));
  decks.addChild(slab, tile('deck', x0 + H.wallW, plazaY, x1 - x0 - 2 * H.wallW, DECK_H, deckTint !== undefined ? { tint: deckTint } : {}));
  if (h.bridge) {
    const br = h.bridge;
    decks.addChild(tile('deck', br.x0, br.y, br.x1 - br.x0, DECK_H * 0.75, deckTint !== undefined ? { tint: deckTint } : {}));
    if (kit.deck === 'balcony' || kit.deck === 'gantry') railsC.addChild(tile('railing', br.x0, br.y - RAIL_H, br.x1 - br.x0, RAIL_H, { stratum: s }));
    // The truss under the bridge deck (thin vector diagonals).
    const tr = new Graphics();
    const ty0 = br.y + DECK_H * 0.75, ty1 = ty0 + 10;
    const trussCol = kit.deck === 'timber' || kit.deck === 'stilts' ? PROPS.kit.mine.timber : P.metal;
    for (let x = br.x0; x < br.x1 - 4; x += 10) {
      rod(tr, x, ty0, x + 10, ty1, 1.2, trussCol);
      rod(tr, x + 10, ty0, x, ty1, 1.2, shade(trussCol, 0.8));
    }
    rod(tr, br.x0, ty1, br.x1, ty1, 1.6, trussCol);
    decks.addChild(tr);
  }
  front.addChild(under, decks, railsC);

  // ----------------------------------------------------------------------------------------------------------- plaza props
  const props = new Graphics();
  if (s === 1 && dens > 0.3) {
    // A bench by the notice board.
    const bx = x0 + H.wallW + 28, by = plazaY;
    contactShadow(props, bx + 18, by, 36);
    props.rect(bx, by - 11, 36, 3.5).fill(vfill(HP.benchSeat, by - 11, by - 7)).stroke({ ...OUTLINE, width: 1 });
    rod(props, bx + 3, by - 8, bx + 3, by, 2, HP.benchLeg);
    rod(props, bx + 33, by - 8, bx + 33, by, 2, HP.benchLeg);
    // Crates and a water drum on the east side.
    const ex = x1 - H.wallW - 64;
    contactShadow(props, ex + 10, by, 22);
    props.rect(ex, by - 16, 20, 16).fill(vfill(HP.crate, by - 16, by)).stroke(OUTLINE);
    props.moveTo(ex, by - 16).lineTo(ex + 20, by).stroke({ width: 1, color: HP.crateStrap, alpha: 0.7 });
    props.rect(ex + 3, by - 26, 13, 10).fill(vfill(HP.crateSmall, by - 26, by - 16)).stroke(OUTLINE);
    contactShadow(props, ex + 36, by, 18);
    props.roundRect(ex + 27, by - 24, 17, 24, 3).fill(vfill(HP.waterDrum, by - 24, by)).stroke(OUTLINE);
    props.rect(ex + 27, by - 17, 17, 2).fill({ color: 0x000000, alpha: 0.35 });
    // The fire barrel (a warmer, flickering second pool on the square).
    const fx = x1 - H.wallW - 18;
    contactShadow(props, fx, by, 14);
    props.roundRect(fx - 7, by - 18, 14, 18, 2).fill(vfill(HP.fireBarrel, by - 18, by)).stroke(OUTLINE);
    props.rect(fx - 7, by - 12, 14, 1.6).fill({ color: 0x000000, alpha: 0.4 });
    const flame = new Graphics();
    flame.poly([fx - 6, by - 18, fx - 2, by - 29, fx + 1, by - 22, fx + 4, by - 31, fx + 6, by - 18]).fill({ color: HP.flame, alpha: 0.85 });
    flame.poly([fx - 3, by - 18, fx, by - 25, fx + 3, by - 18]).fill({ color: HP.flameCore, alpha: 0.9 });
    flame.blendMode = 'add';
    glow.addChild(flame);
    lights.push({ x: fx, y: by - 24, preset: 'fireBarrel', kind: 'shell', area: area(fz) });
  }
  front.addChild(props);
  hubKitFront(ctx);

  // ----------------------------------------------------------------------------------------------------------- key light and string lights
  const key = HUB_KEY[s] ?? 'cageLamp';
  const apexY = top - H.vaultRise + 3;
  if (key === 'chandelier') {
    const chain = new Graphics();
    rod(chain, cx, apexY - 2, cx, apexY + 4, 1.4, P.metal);
    front.addChild(chain);
    lights.push(...lamp(front, glow, 'lamp-chandelier', cx, apexY, { kind: 'shell', area: area(h.floors[0]) }));
  } else if (key === 'fluoroTube') {
    // The service hall: a row of caged tubes under the vault, the middle one failing.
    for (const dx of [-60, 0, 60]) {
      lights.push(...lamp(front, glow, 'lamp-tube', cx + dx, top + 4, { kind: 'shell', preset: dx === 0 ? 'failingTube' : 'fluoroTube', area: area(h.floors[0]) }));
    }
  }
  // (Metro sodium globes, the mine's headframe flood, the caves' crystals and the core's magma are hubKits' key lights.)
  if (era >= 2 && (kit.vault === 'hub' || kit.vault === 'station' || kit.vault === 'mine')) {
    // Colony and later: two catenary runs of string bulbs across the atrium.
    const n = DETAIL[baseTier(quality)].stringBulbsPerRun;
    const wire = new Graphics();
    for (let run = 0; run < Math.min(2, h.floors.length); run++) {
      const ya = floorTop(h.floors[run]) + 16, xa = x0 + H.wallW + 4, xb = x1 - H.wallW - 4;
      const pts: number[] = [];
      for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push(xa + (xb - xa) * t, ya + Math.sin(Math.PI * t) * 26); }
      wire.poly(pts, false).stroke({ width: 0.9, color: HP.stringWire, alpha: 0.9 });
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, bx = xa + (xb - xa) * t, by = ya + Math.sin(Math.PI * t) * 26;
        lights.push(...lamp(front, glow, 'lamp-bulb', bx, by, { kind: 'civic', area: area(h.floors[run]) }));
      }
    }
    front.addChildAt(wire, 0);
  }
  front.addChild(glow);
  return { back, front, lights };
}
