import { Application, Container, RenderTexture, Sprite, Text, UPDATE_PRIORITY } from 'pixi.js';
import { T } from './tokens';
import { makeTextures } from './textures';
import { buildBack, buildFar, buildFore, buildMid, buildSky, screenFx } from './layers';
import { backWalls, buildStructures, outerRock, paintRock, rims } from './play';
import { buildLighting } from './lighting';
import { buildFog } from './fog';
import { buildPeople } from './people';
import { Camera } from './camera';
import { labels } from './scene';
import { isPhone } from './util';

async function boot() {
  const t0 = performance.now();
  const mark = (s: string) => console.debug('[protoA]', s, Math.round(performance.now() - t0));
  const q = new URLSearchParams(location.search).get('phone');
  const phone = q === null ? isPhone() : q === '1';
  if (phone) (T.detail as { density: number }).density = T.render.phoneDensity;
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: T.palette.clear,
    antialias: T.render.antialias,
    resolution: Math.min(devicePixelRatio || 1, phone ? T.render.maxDpr.phone : T.render.maxDpr.desktop),
    autoDensity: true,
    preference: 'webgl',
  });
  mark('app.init');
  document.getElementById('stage')!.appendChild(app.canvas);
  // The lightmap multiplies colour but must keep the destination alpha, so the far layers still show
  // through the open caverns of the lit play-plane texture: rgb = src*dst, a = dst.
  {
    const r = app.renderer as unknown as { gl: WebGL2RenderingContext; state: { blendModesMap: Record<string, number[]> } };
    const gl = r.gl;
    r.state.blendModesMap.multiply = [gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE];
  }
  const tx = makeTextures();
  mark('textures');
  mark('pre-meta');
  const meta = await fetch('/art/meta.json').then(r => r.json()).catch(() => ({}));

  // ---------------- layers
  const sky = await buildSky();
  mark('sky');
  const far = buildFar(tx);
  mark('far');
  const back = buildBack(tx);
  mark('back');
  const mid = buildMid();
  mark('mid');
  const play = new Container();
  const built = await buildStructures();
  mark('structures');
  const rock = new Sprite(paintRock());
  rock.scale.set(1 / T.world.rockRes);
  mark('rock');
  const lighting = buildLighting(tx, meta);
  mark('lighting');
  const people = buildPeople((x, y) => {
    const dyn = { x, y, on: true };
    lighting.addDynamic({ x, y, r: 150, c: T.light.colors.lantern, i: 0.75, flicker: 0.15, glow: 0.7 }, dyn);
    return dyn;
  });
  mark('people');
  play.addChild(outerRock(), backWalls(), built.rooms, rock, rims(), built.structures, people.layer, built.front);

  // lit group (mid + play) → playRT, multiplied by the lightmap
  const lightRoot = new Container();
  lightRoot.addChild(lighting.lightPlay);
  const litRoot = new Container();
  const lightSprite = new Sprite();
  lightSprite.blendMode = 'multiply';
  litRoot.addChild(mid, play, lightSprite);

  const playGlow = new Container();
  const signs = new Container();
  const hiddenSigns: { x: number; y: number; items: Text[] }[] = [];
  for (const l of labels) {
    const t = new Text({
      text: l.text,
      style: { fontFamily: 'Rubik, Heebo, Segoe UI, Arial', fontSize: 22, fill: 0xf3dcb0, fontWeight: '700',
        dropShadow: { color: 0x000000, alpha: 0.9, blur: 6, distance: 0 } },
      resolution: 2,
    });
    t.anchor.set(0.5, 1); t.x = l.x; t.y = l.y;
    const s = new Text({
      text: l.sub,
      style: { fontFamily: 'Rubik, Heebo, Segoe UI, Arial', fontSize: 12, fill: 0xb8a888, dropShadow: { color: 0x000000, alpha: 0.9, blur: 4, distance: 0 } },
      resolution: 2,
    });
    s.anchor.set(0.5, 0); s.x = l.x; s.y = l.y + 2;
    signs.addChild(t, s);
    if (l.sub.startsWith('נחשפ')) hiddenSigns.push({ x: l.x, y: l.y + 40, items: [t, s] });
  }
  playGlow.addChild(lighting.glow, built.labels, signs);
  const fog = buildFog(app.renderer, tx);
  mark('fog');
  const fore = buildFore(tx);
  const fx = screenFx(tx);
  if (phone && !T.render.phoneGrain) fx.c.children[1].visible = false;

  mark('built');
  const playSprite = new Sprite();
  app.stage.addChild(sky, far.layer, back.layer, playSprite, playGlow, fog.layer, fore, fx.c);

  // ---------------- render targets
  let lightRT: RenderTexture, playRT: RenderTexture;
  const cam = new Camera(app.canvas);
  const resize = () => {
    const w = app.screen.width, h = app.screen.height;
    const ls = phone ? T.render.lightScalePhone : T.render.lightScale;
    lightRT?.destroy(true); playRT?.destroy(true);
    lightRT = RenderTexture.create({ width: Math.ceil(w * ls), height: Math.ceil(h * ls), resolution: 1 });
    playRT = RenderTexture.create({ width: w, height: h, resolution: app.renderer.resolution });
    lightSprite.texture = lightRT; lightSprite.width = w; lightSprite.height = h;
    playSprite.texture = playRT; playSprite.width = w; playSprite.height = h;
    lightRoot.scale.set(ls);
    fx.resize(w, h);
    cam.resize(w, h, phone);
  };
  resize();
  app.renderer.on('resize', resize);

  cam.onTap = (x, y) => fog.reveal(x, y);
  for (const h of hiddenSigns) for (const it of h.items) it.alpha = 0;

  // ---------------- frame loop
  let t = 0;
  const amb = T.light.ambient;
  const ambient: [number, number, number, number] = [((amb >> 16) & 255) / 255, ((amb >> 8) & 255) / 255, (amb & 255) / 255, 1];
  app.ticker.add(tk => {
    const dt = Math.min(0.05, tk.deltaMS / 1000);
    t += dt;
    cam.update(dt);
    cam.apply(sky, T.layers.sky.p);
    // the sky scrolls slowly sideways but its horizon stays pinned just under the ground line
    sky.y = cam.sh / 2 + (T.world.groundY - cam.y) * cam.zoom - T.world.groundY * T.layers.sky.p * sky.scale.y + 40 * cam.zoom;
    cam.apply(far.layer, T.layers.far.p);
    cam.apply(back.layer, T.layers.back.p);
    cam.apply(mid, T.layers.mid.p);
    cam.apply(play, 1);
    cam.apply(lighting.lightPlay, 1);
    cam.apply(playGlow, 1);
    cam.apply(fog.layer, 1);
    cam.apply(fore, T.layers.fore.p);
    fore.alpha = Math.min(1, Math.max(0, (cam.zoom - 0.5) / 0.35));
    fore.visible = fore.alpha > 0.01;
    far.anim.update(t, dt);
    back.anim.update(t, dt);
    people.update(t, dt);
    lighting.update(t, dt);
    fog.update(t, dt);
    for (const h of hiddenSigns) {
      const target = fog.seen(h.x, h.y) ? 1 : 0;
      for (const it of h.items) { it.alpha += (target - it.alpha) * Math.min(1, dt * 2); it.visible = it.alpha > 0.01; }
    }
    fx.update(t);
    app.renderer.render({ container: lightRoot, target: lightRT, clear: true, clearColor: ambient });
    app.renderer.render({ container: litRoot, target: playRT, clear: true, clearColor: [0, 0, 0, 0] });
  }, undefined, UPDATE_PRIORITY.NORMAL);

  // ---------------- HUD (DOM, RTL)
  const $ = (id: string) => document.getElementById(id)!;
  $('reveal').onclick = () => fog.revealAll();
  $('reset').onclick = () => fog.reset();
  let fps = 60;
  app.ticker.add(tk => {
    fps += (1000 / Math.max(1, tk.deltaMS) - fps) * 0.05;
    $('fps').textContent = `${fps.toFixed(0)} fps · זום ${cam.zoom.toFixed(2)}`;
  }, undefined, UPDATE_PRIORITY.UTILITY);

  const count = (c: Container): number => c.children.reduce((s, ch) => s + 1 + count(ch as Container), 0);
  (window as unknown as Record<string, unknown>).__protoA = {
    app, cam, fog, bootMs: Math.round(performance.now() - t0),
    objects: () => count(app.stage) + count(litRoot) + count(lightRoot),
    goto(x: number, y: number, z: number) { cam.x = x; cam.y = y; cam.zoom = cam.targetZoom = z; },
  };
}

boot();
