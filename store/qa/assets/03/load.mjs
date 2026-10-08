import { bundleSim } from '../../../tools/sim/bundle.mjs';
import '../../../tools/sim/node-globals.mjs';
import { pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
export async function load() {
  const { file } = await bundleSim({ tag: 'qa03', entry: resolve('/home/user/last-bunker-qa/store/qa-tmp/03/entry.ts') });
  const mod = await import(pathToFileURL(file).href);
  try { rmSync(file); } catch {}
  return mod;
}
