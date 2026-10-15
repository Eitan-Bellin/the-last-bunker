// [phase1 cheat] Makes one save per stage of the game with the balance bot (real game logic, engaged player, seed 1),
// so the whole game can be walked in the browser in minutes: open the dev server with `?slot=pt&debug`, then `__pt.load('d10')`.
//
//   node tools/playthrough.mjs                 all stages (d1 d4 d10 d20 d35 d50 d70), 3 at a time
//   node tools/playthrough.mjs d1 d4           only these
//   node tools/playthrough.mjs --mode casual   another player model (default engaged)
//
// Output: store/playthrough/saves/<stage>-seed1.json + store/playthrough/<stage>.txt (the bot's summary for that stage).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const modeAt = args.indexOf('--mode');
const mode = modeAt >= 0 ? args.splice(modeAt, 2)[1] : 'engaged';
const all = ['d1', 'd4', 'd10', 'd20', 'd35', 'd50', 'd70'];
const stages = args.length ? args : all;
mkdirSync('store/playthrough/saves', { recursive: true });

const run = stage => new Promise(done => {
  const days = Number(stage.slice(1));
  const p = spawn(process.execPath, ['tools/sim/run.mjs', '--mode', mode, '--days', String(days), '--seeds', '1', '--jobs', '1',
    '--json', `store/playthrough/${stage}.json`, '--dump-save', `store/playthrough/saves/${stage}`, '--quiet'], { stdio: 'inherit' });
  p.on('exit', code => { console.log(`${stage}: ${code === 0 ? 'ok' : 'failed ' + code}`); done(code); });
});

const queue = [...stages];
const lanes = Array.from({ length: Math.min(3, queue.length) }, async () => { while (queue.length) await run(queue.shift()); });
await Promise.all(lanes);
