// Bundles tools/sim/node-entry.ts + the live game code (or a frozen snapshot of it) with the repo's own rolldown.
import { build } from 'rolldown';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LIVE_SRC = join(ROOT, 'src');
const OUT_DIR = join(ROOT, 'node_modules', '.cache', 'sim');

/** Fingerprint of the economy code (core/systems/data) the bundle was made from, so runs can be compared later. */
export function fingerprint(srcDir) {
  const files = [];
  const walk = d => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|json)$/.test(f)) files.push(p);
    }
  };
  for (const sub of ['core', 'systems', 'data']) if (existsSync(join(srcDir, sub))) walk(join(srcDir, sub));
  files.sort();
  const h = createHash('sha1');
  let newest = 0;
  const recent = [];
  for (const f of files) {
    h.update(relative(srcDir, f)).update(readFileSync(f));
    const m = statSync(f).mtimeMs;
    newest = Math.max(newest, m);
    recent.push([relative(srcDir, f).split(sep).join('/'), m]);
  }
  recent.sort((a, b) => b[1] - a[1]);
  return {
    src: relative(ROOT, srcDir).split(sep).join('/') || '.',
    hash: h.digest('hex').slice(0, 12),
    files: files.length,
    newestChange: new Date(newest).toISOString(),
    lastChanged: recent.slice(0, 8).map(([f, m]) => `${f} @ ${new Date(m).toISOString()}`),
  };
}

const EXTS = ['', '.ts', '.js', '.mjs', '.json', '/index.ts'];

/**
 * @param {{ src?: string, tag?: string, entry?: string }} o  src: a folder holding core/, systems/, data/ (default: live src/); entry: another entry file (default node-entry.ts).
 * @returns {Promise<{ file: string, fingerprint: object }>}
 */
export async function bundleSim(o = {}) {
  const srcDir = o.src ? resolve(ROOT, o.src) : LIVE_SRC;
  if (!existsSync(join(srcDir, 'core', 'GameEngine.ts'))) throw new Error(`no core/GameEngine.ts under ${srcDir}`);
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `sim-${o.tag ?? 'live'}-${process.pid}-${Date.now()}.mjs`);
  const redirect = srcDir !== LIVE_SRC;
  await build({
    input: o.entry ?? join(ROOT, 'tools', 'sim', 'node-entry.ts'),
    platform: 'node',
    logLevel: 'warn',
    // Feature detection reads exports that older code doesn't have; that is expected, not a problem.
    onLog(level, log, handler) { if (log.code !== 'IMPORT_IS_UNDEFINED') handler(level, log); },
    transform: { define: { 'import.meta.env.DEV': 'false', 'import.meta.env': '{"DEV":false}' } },
    plugins: [{
      name: 'sim-resolve',
      async resolveId(source, importer) {
        // The save layer is swapped for an in-memory one at runtime; never pull IndexedDB in.
        if (source === 'idb-keyval') return '\0idb-stub';
        // Packages imported from a snapshot outside node_modules' reach resolve from the project.
        if (redirect && importer && !source.startsWith('.') && !source.startsWith('\0') && !/^[a-zA-Z]:|^\//.test(source)) {
          return this.resolve(source, join(LIVE_SRC, 'main.ts'), { skipSelf: true });
        }
        if (!redirect || !importer || !source.startsWith('.')) return null;
        const abs = resolve(dirname(importer), source);
        if (!abs.startsWith(LIVE_SRC + sep)) return null;
        const target = join(srcDir, relative(LIVE_SRC, abs));
        for (const ext of EXTS) if (existsSync(target + ext) && statSync(target + ext).isFile()) return target + ext;
        throw new Error(`snapshot ${srcDir} has no ${relative(LIVE_SRC, abs)}`);
      },
      load(id) {
        if (id === '\0idb-stub') return 'export const get = async () => undefined; export const set = async () => {}; export const del = async () => {}; export const keys = async () => []; export const clear = async () => {};';
        return null;
      },
    }],
    output: { file, format: 'esm' },
  });
  return { file, fingerprint: fingerprint(srcDir) };
}
