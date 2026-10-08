import { mkEngine, run } from './lib.mjs';
const { e, m, sm, det } = await mkEngine('e30-seed1.json');
const s = sm.state;
run(e, 3, 1);
const open = b => (m.Buildings.getDef(b.type)?.maxWorkers ?? 0) - m.Buildings.crewCount(s, b);
const idle = () => s.survivors.filter(p => !p.assignedBuildingId && !p.child && !p.isOnMission).length;
// free three adults
const adults = s.survivors.filter(p => !p.child && p.assignedBuildingId && !p.assignedBuildingId.startsWith('p_'));
for (const a of adults.slice(0, 3)) e.populationSystem.assignSurvivorToBuilding(sm, a.id, null);
console.log('idle adults', idle());
const rooms = s.buildings.filter(b => !b.isConstructing && open(b) > 0).sort((a, b) => open(b) - open(a));
console.log('rooms with open slots', rooms.slice(0, 4).map(b => `${b.type}@${b.position.floor}:${b.position.x} open=${open(b)}`).join(' | '));
const target = rooms[0];
// seal a door between the shaft and the room with the most open places
const bx = target.position.x > 0 ? target.position.x : target.position.x + m.Buildings.roomSlots(target.type);
console.log('target', target.type, 'boundary x', bx);
m.Doors.setDoor(s, target.position.floor, bx, 'sealed');
console.log('sealedOff?', m.Doors.isSealedOff(s, target.position.floor, target.position.x, m.Buildings.roomSlots(target.type)), 'canAssign', e.populationSystem.canAssign(s, target.id));
s.longGame.meta.act = Math.max(2, s.longGame.meta.act);
e.foremanSystem.set('staff', true);
console.log('foreman report', JSON.stringify(e.foremanSystem.last.staff), 'idle after', idle());
// open the door, rerun
m.Doors.setDoor(s, target.position.floor, bx, 'open');
e.foremanSystem.set('staff', false); e.foremanSystem.set('staff', true);
console.log('with door open -> report', JSON.stringify(e.foremanSystem.last.staff), 'idle after', idle());
det.restore();
