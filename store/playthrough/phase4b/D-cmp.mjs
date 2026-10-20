// [phase4b] Agent D: base vs after, per run: Act II/III/IV start (wall h), deaths, raids online by outcome, away raids, tributes, idle share.
// Usage: node store/playthrough/phase4b/D-cmp.mjs D-base-engaged.json D-after-engaged.json ...
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const h = s => (s === undefined ? '  —  ' : (s / 3600).toFixed(1).padStart(5));
const med = a => { const b = a.filter(x => x !== undefined).sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : undefined; };
for (const f of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(resolve(f), 'utf8'));
  console.log(`\n== ${f} (${d.meta.mode}, ${d.meta.days ?? d.meta.hours} ${d.meta.days ? 'd' : 'h'})`);
  console.log('seed  act2  act3  act4  act5 | dead causes        | online raids                         | away raids/lost | tributes | idle');
  const cols = { a2: [], a3: [], a4: [], idle: [], dead: [] };
  for (const r of d.runs) {
    const m = r.milestones;
    const w = k => m[k]?.wall;
    cols.a2.push(w('act 2')); cols.a3.push(w('act 3')); cols.a4.push(w('act 4'));
    const dz = r.danger ?? {};
    const raids = Object.entries(dz.raids ?? {}).map(([k, v]) => `${k}:${v}`).join(' ');
    const causes = Object.entries(r.deaths?.causes ?? {}).map(([k, v]) => `${k}:${v}`).join(' ');
    const dead = r.deaths?.total ?? r.deaths?.count ?? (typeof r.deaths === 'number' ? r.deaths : Object.values(r.deaths?.causes ?? {}).reduce((a, b) => a + b, 0));
    cols.dead.push(dead);
    const idle = r.idle?.share ?? r.idle?.onlineShare;
    cols.idle.push(idle);
    console.log(`${String(r.seed).padStart(4)} ${h(w('act 2'))} ${h(w('act 3'))} ${h(w('act 4'))} ${h(w('act 5'))} | ${String(dead).padStart(2)} ${causes.padEnd(15)} | ${raids.padEnd(36)} | ${String(dz.away?.raids ?? 0).padStart(3)}/${String(dz.away?.raidsLost ?? 0).padEnd(3)} hurt ${dz.away?.hurt ?? 0} | ${String(dz.tributes ?? 0).padStart(4)} | ${idle !== undefined ? (idle * 100).toFixed(0) + '%' : '?'}`);
  }
  console.log(`med  ${h(med(cols.a2))} ${h(med(cols.a3))} ${h(med(cols.a4))}       | deaths ${cols.dead.join(',')}`);
}
