import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, normalize, resolve } from 'node:path';

const RAW_DIR = resolve(import.meta.dirname, 'art-src');
const OUT_DIR = resolve(import.meta.dirname, 'public/art');

function listPngs(): string[] {
  const out: string[] = [];
  for (const sub of ['raw', 'sheets', 'kit']) {
    try {
      for (const f of readdirSync(join(RAW_DIR, sub))) if (f.endsWith('.png')) out.push(`${sub}/${f}`);
    } catch {
      // folder may not exist yet
    }
  }
  return out;
}

/**
 * Dev-only endpoints for the art pipeline page (tools/art.html):
 * list and serve the raw paintings exported from Canva, and save processed WebP files into public/art.
 */
function artPipeline(): Plugin {
  return {
    name: 'art-pipeline',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (url === '/__art/list') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(listPngs()));
          return;
        }
        if (url.startsWith('/__art/raw/')) {
          const file = normalize(join(RAW_DIR, decodeURIComponent(url.slice('/__art/raw/'.length))));
          if (!file.startsWith(RAW_DIR)) { res.statusCode = 403; res.end(); return; }
          res.setHeader('Content-Type', 'image/png');
          res.end(readFileSync(file));
          return;
        }
        // Store assets (icons, screenshots, feature graphic): only into public/ or store/.
        if (url.startsWith('/__store/save/') && req.method === 'POST') {
          const rel = decodeURIComponent(url.slice('/__store/save/'.length));
          const file = normalize(join(import.meta.dirname, rel));
          const ok = [resolve(import.meta.dirname, 'public'), resolve(import.meta.dirname, 'store')].some(d => file.startsWith(d + '\\') || file.startsWith(d + '/'));
          if (!ok) { res.statusCode = 403; res.end(); return; }
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, Buffer.concat(chunks));
            res.end('ok');
          });
          return;
        }
        if (url.startsWith('/__art/save/') && req.method === 'POST') {
          const file = normalize(join(OUT_DIR, decodeURIComponent(url.slice('/__art/save/'.length))));
          if (!file.startsWith(OUT_DIR)) { res.statusCode = 403; res.end(); return; }
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, Buffer.concat(chunks));
            res.end('ok');
          });
          return;
        }
        next();
      });
    },
  };
}

/**
 * Plan 4 wave 3 (perf): Pixi's renderer picker loads the WebGL, WebGPU and Canvas renderers through three dynamic imports, and
 * because all of pixi.js is forced into one chunk (below) the two the game never runs were shipped anyway: about 66 KB minified,
 * 20 KB gzipped. The game is WebGL-only (its filters are GLSL, `postfx.ts` says WebGPU is "not used today"), so in production
 * builds those two modules become stubs that throw when chosen; a device with no WebGL then gets the same "could not start" screen
 * it got before (Pixi's Canvas renderer is experimental and the game's filters are GLSL). Dev server and tools keep the full library.
 */
function pixiWebglOnly(): Plugin {
  const STUBS: Record<string, string> = {
    './gpu/WebGPURenderer.mjs': 'WebGPURenderer',
    './canvas/CanvasRenderer.mjs': 'CanvasRenderer',
  };
  const ID = '\0pixi-renderer-stub:';
  return {
    name: 'pixi-webgl-only',
    apply: 'build',
    enforce: 'pre',
    resolveId(source, importer) {
      const cls = STUBS[source];
      if (cls && importer && importer.replace(/\\/g, '/').includes('/pixi.js/lib/rendering/renderers/autoDetectRenderer')) return ID + cls;
      return null;
    },
    load(id) {
      if (!id.startsWith(ID)) return null;
      const cls = id.slice(ID.length);
      return `export class ${cls} { async init() { throw new Error('The ${cls} is not part of this build (WebGL only).'); } }`;
    },
  };
}

/**
 * [plan4:UX-14] After a production build: gives dist/sw.js a build id and the list of hashed build files to keep offline, and writes
 * the same id into dist/index.html (<meta name="build">). A browser only installs a new service worker when sw.js changes byte for
 * byte; before this it never changed, so the "new version" chip had nothing to react to. The page compares its own id with the one
 * the waiting worker reports, so a worker that carries the very code the page already runs never raises the chip.
 */
function stampServiceWorker(): Plugin {
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    writeBundle(options) {
      const dist = options.dir ? resolve(options.dir) : resolve(import.meta.dirname, 'dist');
      const swPath = join(dist, 'sw.js');
      const htmlPath = join(dist, 'index.html');
      if (!existsSync(swPath) || !existsSync(htmlPath)) return;
      const assets = readdirSync(join(dist, 'assets')).sort();
      const html = readFileSync(htmlPath, 'utf8');
      const build = createHash('sha1').update(assets.join('|')).update(html).digest('hex').slice(0, 10);
      const sw = readFileSync(swPath, 'utf8')
        .replace("'__BUILD_ID__'", JSON.stringify(build))
        .replace('/*__PRECACHE__*/[]', JSON.stringify(assets.map(f => `./assets/${f}`)));
      writeFileSync(swPath, sw);
      if (!html.includes('name="build"')) writeFileSync(htmlPath, html.replace('</head>', `  <meta name="build" content="${build}" />\n</head>`));
    },
  };
}

/**
 * Plan 4 wave 3 (perf): code split off the main chunk (string tables, the Bunker Book, the sound recipes) is fetched only when needed, so
 * a player who goes offline right after the first visit could be missing one of those files. This writes `asset-manifest.json`, the list of
 * every script and stylesheet of the build that the game can ask for, and the service worker (public/sw.js) puts them all in its cache when
 * it installs. The `?debug` probe chunk and the unused renderer stubs are left out.
 */
function assetManifest(): Plugin {
  return {
    name: 'asset-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.values(bundle)
        .filter(o => /\.(js|css)$/.test(o.fileName) && o.name !== 'perf' && !String(o.name).startsWith('_pixi-renderer-stub'))
        .map(o => `./${o.fileName}`)
        .sort();
      this.emitFile({ type: 'asset', fileName: 'asset-manifest.json', source: JSON.stringify(files) });
    },
  };
}

export default defineConfig(({ command }) => ({
  // Relative asset paths so the build works from any host or sub-folder (and as an installed PWA).
  base: './',
  plugins: [artPipeline(), pixiWebglOnly(), assetManifest(), stampServiceWorker()],
  // Production only: the string tables load as their own chunks (src/i18n/locales.ts). Dev and the Node test bundles keep them linked in.
  define: command === 'build' ? { __LAZY_LOCALES__: 'true' } : {},
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => (id.includes('node_modules/pixi.js') ? 'pixi' : undefined),
      },
    },
  },
}));
