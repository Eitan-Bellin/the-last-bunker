// [phase5] node store/playthrough/phase5/A-harness.mjs d20 [days] [onlineSeconds] [awaySeconds]
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from '../../../tools/sim/bundle.mjs';
import '../../../tools/sim/node-globals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [save = 'd20', days = '3', online = '1200', away = '10800'] = process.argv.slice(2);
const { file } = await bundleSim({ tag: 'harnessA', entry: join(ROOT, 'store', 'playthrough', 'phase5', 'A-harness.ts') });
const mod = await import(pathToFileURL(file).href);
try { rmSync(file); } catch { /* cache */ }
for (const name of save.split(',')) {
  const json = readFileSync(join(ROOT, 'store', 'playthrough', 'saves', `${name}-seed1.json`), 'utf8');
  for (const line of mod.runFromSave(name, json, { days: Number(days), online: Number(online), away: Number(away) })) console.log(line);
}
