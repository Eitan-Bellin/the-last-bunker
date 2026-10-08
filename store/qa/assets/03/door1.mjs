import { mkEngine, run } from './lib.mjs';
for (const f of ['c-seed1.json', 'e10-seed1.json', 'e30-seed1.json', 'e55-seed1.json']) {
  const { e, m, sm, det } = await mkEngine(f);
  const s = sm.state;
  run(e, 5, 1);
  const p = s.resources.power;
  console.log(f, 'power prod', p.productionRate.toFixed(1), 'cons', p.consumptionRate.toFixed(1), 'stored', p.amount.toFixed(0), 'cap', p.cap, 'ratio', s.powerRatio.toFixed(2), 'rooms', s.buildings.length);
  // a door on every room boundary for every floor
  let n = 0;
  for (const b of s.buildings) for (const x of m.Infra.roomEdgeBoundaries(b)) { const k = m.Doors.getDoor(s, b.position.floor, x); if (k === undefined) { m.Doors.setDoor(s, b.position.floor, x, 'sealed'); n++; } }
  const drain = m.Infra.infraPowerDraw(s);
  run(e, 1, 1);
  console.log('   sealed all', n, 'doors -> infra draw', drain.toFixed(1), '/s ; consumption now', p.consumptionRate.toFixed(1), 'ratio', s.powerRatio.toFixed(2));
  run(e, 3600, 5);
  console.log('   after 1h: stored', p.amount.toFixed(1), 'ratio', s.powerRatio.toFixed(2), 'doorsOperable', m.Infra.doorsOperable(s));
  // can the player recover? try opening all
  const opened = m.Infra.openAllDoors(sm);
  console.log('   openAllDoors ->', opened);
  det.restore();
}
