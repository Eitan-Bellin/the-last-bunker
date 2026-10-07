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

export default defineConfig({
  // Relative asset paths so the build works from any host or sub-folder (and as an installed PWA).
  base: './',
  plugins: [artPipeline(), stampServiceWorker()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => (id.includes('node_modules/pixi.js') ? 'pixi' : undefined),
      },
    },
  },
});
