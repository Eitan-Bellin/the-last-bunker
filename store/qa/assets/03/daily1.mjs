import { mkEngine, run, crashlog, clearCrash } from './lib.mjs';
const { e, m, sm, det } = await mkEngine('e10-seed1.json', { seed: 3 });
const clock = det.clock;
const s = sm.state;
const D = e.dailySystem;
const day = () => m.Daily.dayIndex(clock.now);
const snap = tag => console.log(tag.padEnd(28), 'day', s.daily.day, 'today', day(), 'orders', s.daily.orders.map(o => `${o.id}:${o.p}/${o.need}${o.done ? 'D' : ''}${o.claimed ? 'C' : ''}`).join(' '), 'streak', s.daily.streak, 'last', s.daily.lastClaim, 'chest', s.daily.chest, 'credits', Math.round(s.resources.credits.amount));
clearCrash();
run(e, 5, 1);
snap('start');
D.forceComplete(0); D.forceComplete(1);
snap('2 forced');
D.claim(0);
snap('claimed 0');
// next day passes while online
clock.now += 86400_000; run(e, 3, 1);
snap('+1 day online');
// clock goes backward by 3 days
clock.now -= 3 * 86400_000; run(e, 3, 1);
snap('clock -3 days');
// clock jumps forward 400 days, then back to real
clock.now += 400 * 86400_000; run(e, 3, 1);
snap('+400 days');
const farDay = s.daily.day;
clock.now -= 400 * 86400_000; run(e, 3, 1);
snap('back to normal (stuck?)');
console.log('orders refresh while clock back? day stays', s.daily.day === farDay);
// advance 5 normal days
for (let i = 0; i < 5; i++) { clock.now += 86400_000; run(e, 2, 1); }
snap('+5 days after back');
console.log('crash', crashlog().join(' | ') || '-');
// away sim 30 days
const rep = e.simulate(30 * 86400 > 86400 ? 86400 : 86400, 0.8);
snap('away 1 day sim');
det.restore();
