#!/usr/bin/env node
// [phase5] Run-2 check (Agent G). Two steps, each in its own process (module state such as the event bus must start clean):
//   node tools/sim/genesis-run2.mjs genesis --save store/playthrough/saves/d70-seed1.json --plan '{"cls":"ksScholar","shop":true}' --out tmp.json [--src <frozen src>]
//   node tools/sim/genesis-run2.mjs play --from tmp.json --seed 1 --days 3 [--src <frozen src>]     (--from none = a brand-new run 1)
// Prints one JSON line with what the new timeline looks like.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleSim, ROOT } from './bundle.mjs';
import './node-globals.mjs';

const [step, ...rest] = process.argv.slice(2);
const a = {};
for (let i = 0; i < rest.length; i += 2) a[rest[i].replace(/^--/, '')] = rest[i + 1];

const { file } = await bundleSim({ tag: `run2-${step}`, entry: join(ROOT, 'tools', 'sim', 'genesis-run2.ts'), src: a.src });
const mod = await import(pathToFileURL(file).href);
try {
  if (step === 'genesis') {
    const r = await mod.genesisFrom(readFileSync(a.save, 'utf8'), JSON.parse(a.plan ?? '{}'));
    writeFileSync(a.out, r.json);
    console.log(JSON.stringify(r.info));
  } else {
    const json = a.from && a.from !== 'none' ? readFileSync(a.from, 'utf8') : null;
    console.log(JSON.stringify(await mod.playFrom(json, Number(a.seed ?? 1), Number(a.days ?? 3))));
  }
} finally {
  try { rmSync(file); } catch { /* cache file */ }
}
process.exit(0);
