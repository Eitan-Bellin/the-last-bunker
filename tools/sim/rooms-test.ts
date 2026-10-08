// [plan4:BL-15..32] Node-level checks of the twelve wave 2 rooms on the sample saves (run by rooms-test.mjs): each room's effect reaches its reader
// with the number buildings.json promises, the weather rooms follow the sun and the wind, children go to the nursery and the school (never to a crew
// place), the fish ponds need the lake, the memorial hall needs its flag, and every room has the data the game looks up (icon, role pair, research).
import { BuildingSystem } from '../../src/systems/BuildingSystem';
import { PopulationSystem } from '../../src/systems/PopulationSystem';
import { ResourceSystem } from '../../src/systems/ResourceSystem';
import { DeathSystem } from '../../src/systems/DeathSystem';
import { StateManager } from '../../src/core/StateManager';
import { isBuildingUnlocked, unlockingResearch } from '../../src/systems/ResearchSystem';
import { BUILDABLE_TYPES, DISTRICT_KINDS, getDef, effectiveLevel, isDistrict, levelMultiplier } from '../../src/data/buildingDefs';
import { cargoMult, childCapacityOf, earlyWarningLead, expeditionTeamsBonus, hygieneMult, mourningMult, quarantineCapacity, returnSafetyMult, roomChildGrowth } from '../../src/data/roomEffects';
import { specsFor, SPECIALIZATIONS } from '../../src/data/specializations';
import { availableDistricts, DISTRICTS } from '../../src/data/districts'; // plan4:BL-24,25
import { IncidentSystem } from '../../src/systems/IncidentSystem'; // plan4:BL-24
import { SeededRandom } from '../../src/core/Random'; // plan4:BL-24
import { allowedFloors } from '../../src/data/zones'; // plan4:BL-34..38
import { AMBIENCE_FOR } from '../../src/audio/ambience'; // plan4:BL-13
import heStrings from '../../src/i18n/he.json'; // plan4:BL-13
import enStrings from '../../src/i18n/en.json'; // plan4:BL-13
import { CHAIN_INPUTS } from '../../src/data/chains'; // plan4:BL-34..38
import { DISTRICT_ART_ALIAS, buildingArtKey } from '../../src/art/registry'; // plan4:BL-24,25
import { timeOfDay, windAt } from '../../src/data/dayCycle';
import { ICON_SVG } from '../../src/ui/icons';
import { BUILDING_ICONS } from '../../src/ui/dom';
import { migrateState, type BuildingInstance, type BuildingType, type GameState, type SurvivorState } from '../../src/core/GameState';

/** [plan4:BL-34..38] The five Act rooms and the role each one is 1.5x of (specializations.ts). */
export const ACT_ROOMS: [BuildingType, string, string][] = [
  ['componentsPlant', 'assemblyLine', 'components'], ['alloyFoundry', 'arcFurnace', 'alloys'], ['dataCenter', 'dataVault', 'data'],
  ['forum', 'councilHall', 'influence'], ['seedLab', 'seedForge', 'seedCores'],
];
/** [plan4:BL-24,25] The two Act districts. */
export const WAVE3_DISTRICTS: BuildingType[] = ['geothermal', 'oldVault'];

export const WAVE2: BuildingType[] = ['quarantineWard', 'solarArray', 'windTurbine', 'watchtower', 'garage', 'decon', 'aquaculture', 'market', 'nursery', 'school', 'bathhouse', 'memorialHall'];

export function roomsChecks(games: { name: string; json: string }[]): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const fail = (m: string): void => { if (problems.length < 25) problems.push(m); };
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
  const bs = new BuildingSystem();
  const rs = new ResourceSystem();
  const ps = new PopulationSystem();

  // ---- data every room needs, independent of any save ----
  for (const t of WAVE2) {
    if (!(t in ICON_SVG)) fail(`${t}: no icon`);
    if (!BUILDING_ICONS[t]) fail(`${t}: no BUILDING_ICONS entry`);
    if (!BUILDABLE_TYPES.includes(t)) fail(`${t}: not in BUILDABLE_TYPES`);
    if (specsFor(t).length !== 2) fail(`${t}: ${specsFor(t).length} roles, expected 2`);
    const r = unlockingResearch(t);
    if (!r && t !== 'memorialHall') fail(`${t}: no unlocking research`);
    if (t === 'memorialHall' && (r || !getDef(t)?.place?.needsFlag)) fail('memorialHall must open by its story flag and have no research');
  }

  // ---- [plan4:BL-24,25,34..38] wave 3: the data every room needs, and the numbers the plan promises ----
  for (const t of [...ACT_ROOMS.map(a => a[0]), ...WAVE3_DISTRICTS]) {
    if (!(t in ICON_SVG)) fail(`${t}: no icon`);
    if (!BUILDING_ICONS[t]) fail(`${t}: no BUILDING_ICONS entry`);
    if (!unlockingResearch(t)) fail(`${t}: no unlocking research`);
    if (specsFor(t).length !== 0) fail(`${t}: has ${specsFor(t).length} roles, the plan gives it none`);
  }
  for (const [t] of ACT_ROOMS) if (!BUILDABLE_TYPES.includes(t) || isDistrict(t)) fail(`${t}: must be a buildable room, not a district`);
  for (const t of WAVE3_DISTRICTS) {
    if (!DISTRICT_KINDS.includes(t) || BUILDABLE_TYPES.includes(t)) fail(`${t}: must be a district (dug), not in the build menu`);
    if (!DISTRICTS.some(d => d.kind === t)) fail(`${t}: no DISTRICTS entry`);
    if (!buildingArtKey(t, 0)?.startsWith('districts/')) fail(`${t}: no district painting key (alias ${DISTRICT_ART_ALIAS[t] ?? 'none'})`);
  }
  for (const [t, role, res] of ACT_ROOMS) {
    const def = getDef(t);
    const spec = SPECIALIZATIONS.find(x => x.id === role);
    const entry = def?.production?.[res];
    if (!def || !spec || !entry) { fail(`${t}: no ${res} production or no ${role} role to compare with`); continue; }
    for (const L of [1, 3, 5]) {
      const room = entry.base * levelMultiplier(entry, L);
      const roleOut = (spec.extra?.[res as keyof typeof spec.extra] ?? 0) * L / 5;
      const ratio = room / roleOut;
      // The plan's 1.5x (02-new-buildings.md BL-34..38) was a starting value: a room's output also gets staffing, morale and research multipliers that a role's
      // `extra` does not, and at 1.5x the bot's 100-day Genesis came 23 days early (66 vs 89). The sim picked 0.45x nominal (Genesis day 82, seed 1, casual).
      if (!(ratio >= 0.4 && ratio <= 0.5)) fail(`${t} at level ${L} makes ${room.toFixed(6)} ${res}/s, ${ratio.toFixed(2)}x the ${role} role (expected about 0.45x nominal, see the comment)`);
    }
    for (const i of spec.inputs ?? []) if (!(CHAIN_INPUTS[t] ?? []).some(x => x.resource === i.resource && x.base === i.base)) fail(`${t}: does not eat ${i.resource} like the ${role} role`);
    if (def.maxCopies !== 1 || def.maxLevel !== 5 || def.slots !== 3) fail(`${t}: expected 3 slots, 5 levels and 1 copy`);
  }
  {
    const geo = getDef('geothermal')!.production!.power;
    const power = (L: number) => geo.base * levelMultiplier(geo, L);
    if (!near(power(1), 8) || Math.abs(power(3) - 15.2) > 0.1 || Math.abs(power(5) - 21) > 0.2) fail(`geothermal makes ${power(1)}/${power(3)}/${power(5)} power at levels 1/3/5, expected 8/15.2/21`);
    if (getDef('geothermal')!.powerConsumption !== 0 || getDef('geothermal')!.shape) fail('geothermal must burn no fuel and follow no weather');
    const bp = getDef('oldVault')!.production!.blueprints;
    const rate = (L: number) => bp.base * levelMultiplier(bp, L);
    for (const [L, want] of [[1, 0.00005], [3, 0.000095], [5, 0.000131]] as [number, number][]) if (Math.abs(rate(L) / want - 1) > 0.02) fail(`oldVault level ${L} makes ${rate(L)} blueprints/s, expected ${want}`);
    // Most blueprints a day from a fully staffed level-5 vault: the plan's ceiling is 14 including the shop.
    if (rate(5) * 86400 > 14) fail(`oldVault level 5 makes ${(rate(5) * 86400).toFixed(1)} blueprints a day, above the plan's 14`);
  }

  // ---- [plan4:BL-13] the connection checklist (02-new-buildings.md section 13) for every room of waves 1-3 ----
  const CLASSIC = ['quarters', 'generator', 'farm', 'waterPump', 'workshop', 'medbay', 'canteen', 'laboratory', 'radioTower', 'hydroponics', 'waterPurifier', 'trainingRoom', 'armory', 'reactor', 'storage', 'elevator', 'cave', 'lake', 'metro', 'atrium', 'reactorHall'];
  const checklist = [...BUILDABLE_TYPES, ...DISTRICT_KINDS].filter(t => !CLASSIC.includes(t));
  for (const t of checklist) {
    const def = getDef(t);
    if (!def) { fail(`${t}: in the room lists but has no definition`); continue; }
    if (!(t in ICON_SVG)) fail(`${t}: no icon (ui/icons.ts)`);
    if (!BUILDING_ICONS[t]) fail(`${t}: no BUILDING_ICONS entry (ui/dom.ts)`);
    if (!AMBIENCE_FOR[t]) fail(`${t}: no ambience (audio/ambience.ts)`);
    if (!unlockingResearch(t) && !def.place?.needsFlag) fail(`${t}: nothing unlocks it (no research node, no story flag)`);
    if (def.maxWorkers > 0) {
      for (const [lang, strings] of [['he', heStrings], ['en', enStrings]] as [string, Record<string, string>][]) if (!strings[`memorial.line.${t}`]) fail(`${t}: no memorial line in ${lang} (crew can be remembered)`);
    }
  }
  notes.push(`checklist: ${checklist.length} rooms of waves 1-3 have icon, ambience, unlocking node/flag and memorial lines`);

  for (const g of games) {
    const base = migrateState(JSON.parse(g.json) as GameState);
    for (const r of Object.values(base.resources)) r.amount = r.cap;
    base.buildings = base.buildings.filter(b => !WAVE2.includes(b.type));
    base.storyFlags = base.storyFlags.filter(f => f !== 'memorial:first');
    let n = 0;
    const mk = (type: BuildingType, level: number, floor: number, x: number): BuildingInstance =>
      ({ id: `w2_${type}_${n++}`, type, level, position: { x, y: 0, floor }, assignedSurvivorIds: [], constructionProgress: 0, constructionTotal: 0, isConstructing: false, specialization: null });
    const withRooms = (rooms: BuildingInstance[]): GameState => ({ ...base, buildings: [...base.buildings, ...rooms] });

    // ---- effects reach their readers with the promised numbers ----
    const ward = (lvl: number) => withRooms([mk('quarantineWard', lvl, 40, 0)]);
    if (quarantineCapacity(ward(1)) !== 4 || quarantineCapacity(ward(3)) !== 6) fail(`${g.name}: quarantine ward holds ${quarantineCapacity(ward(1))}/${quarantineCapacity(ward(3))}, expected 4/6 at levels 1/3`);
    if (earlyWarningLead(withRooms([mk('watchtower', 1, 40, 0)])) !== 30) fail(`${g.name}: watchtower L1 gives ${earlyWarningLead(withRooms([mk('watchtower', 1, 40, 0)]))}s of warning, expected 30`);
    if (earlyWarningLead(withRooms([mk('watchtower', 10, 40, 0), mk('watchtower', 10, 40, 2)])) !== 300) fail(`${g.name}: raid warning is not capped at 300s`);
    if (expeditionTeamsBonus(withRooms([mk('garage', 2, 40, 0)])) !== 0 || expeditionTeamsBonus(withRooms([mk('garage', 3, 40, 0)])) !== 1 || expeditionTeamsBonus(withRooms([mk('garage', 8, 40, 0)])) !== 2) fail(`${g.name}: motor pool teams are not 0/1/2 at levels 2/3/8`);
    if (!near(cargoMult(withRooms([mk('garage', 3, 40, 0), mk('market', 1, 40, 4)])), 1 + 0.15 + 0.1)) fail(`${g.name}: garage L3 + market L1 cargo is ${cargoMult(withRooms([mk('garage', 3, 40, 0), mk('market', 1, 40, 4)]))}, expected 1.25`);
    if (!near(returnSafetyMult(withRooms([mk('decon', 1, 40, 0)])), 0.96)) fail(`${g.name}: decon L1 return safety is not 0.96`);
    if (!near(hygieneMult(withRooms([mk('bathhouse', 1, 40, 0)])), 0.96)) fail(`${g.name}: bathhouse L1 hygiene is not 0.96`);
    if (!near(mourningMult(withRooms([mk('memorialHall', 1, 40, 0)])), 0.9)) fail(`${g.name}: memorial hall L1 mourning is not 0.9`);
    if (!near(roomChildGrowth(withRooms([mk('nursery', 1, 40, 0)])), 1.25)) fail(`${g.name}: nursery L1 child growth is not 1.25`);
    if (childCapacityOf(mk('nursery', 1, 0, 0)) !== 4 || childCapacityOf(mk('nursery', 3, 0, 0)) !== 8 || childCapacityOf(mk('school', 1, 0, 0)) !== 6) fail(`${g.name}: child places are not 4/8/6 (nursery L1, L3, school L1)`);

    // ---- weather: the sun and the wind move the power ----
    {
      const s = withRooms([mk('solarArray', 1, -1, 0), mk('windTurbine', 1, -1, 4)]);
      const solar = s.buildings[s.buildings.length - 2], wind = s.buildings[s.buildings.length - 1];
      let day = -1, night = -1, calm = -1, gust = -1;
      for (let t = 0; t < 60000; t += 10) {
        const nt = timeOfDay(t).night;
        if (day < 0 && nt === 0) day = t;
        if (night < 0 && nt === 1) night = t;
        if (calm < 0 && windAt(t) < 0.1) calm = t;
        if (gust < 0 && windAt(t) > 0.9) gust = t;
      }
      const out = (b: BuildingInstance, t: number) => { s.stats.totalPlayTime = t; return rs.getBuildingOutput(s, b).power ?? 0; };
      if (!(out(solar, day) > 2.5)) fail(`${g.name}: solar array makes ${out(solar, day)} power at noon, expected about 3`);
      if (out(solar, night) !== 0) fail(`${g.name}: solar array makes power at night (${out(solar, night)})`);
      if (!(out(wind, gust) > out(wind, calm) * 1.5)) fail(`${g.name}: wind turbine does not follow the wind (${out(wind, calm)} calm, ${out(wind, gust)} gust)`);
    }

    // ---- children: nursery and school hold them, a crew place never does ----
    {
      const sm = new StateManager();
      const st = withRooms([mk('nursery', 1, 40, 0), mk('school', 1, 40, 4)]);
      sm.loadState(st);
      const nursery = sm.state.buildings.find(b => b.type === 'nursery')!;
      const school = sm.state.buildings.find(b => b.type === 'school')!;
      const kid = (i: number): SurvivorState => ({ ...sm.state.survivors[0], id: `w2kid${i}`, name: `kid${i}`, child: true, assignedBuildingId: null, bornAt: 0, isOnMission: false } as SurvivorState);
      const kids = [0, 1, 2, 3, 4, 5].map(kid);
      sm.applyDelta({ path: 'survivors', value: [...sm.state.survivors, ...kids] });
      let placed = 0;
      for (const k of kids) if (ps.assignSurvivorToBuilding(sm, k.id, nursery.id)) placed++;
      if (placed !== 4) fail(`${g.name}: nursery L1 took ${placed} children, expected 4`);
      const left = kids.find(k => sm.state.survivors.find(s => s.id === k.id)?.assignedBuildingId === null);
      if (left && !ps.assignSurvivorToBuilding(sm, left.id, school.id)) fail(`${g.name}: the school refused a child`);
      const workshop = sm.state.buildings.find(b => b.type === 'workshop');
      if (workshop && ps.assignSurvivorToBuilding(sm, kids[0].id, workshop.id)) fail(`${g.name}: a child was put on a workshop crew`);
    }

    // ---- placement: the roof row, the lake, the flag ----
    {
      const open = { ...base, layout: { ...base.layout, surfaceOpen: true } };
      if (bs.placeBlock('solarArray', { x: -8, y: 0, floor: -1 }, open) !== null) fail(`${g.name}: solar array refused on an open roof row`);
      if (bs.placeBlock('solarArray', { x: -8, y: 0, floor: -1 }, { ...base, layout: { ...base.layout, surfaceOpen: false } }) !== 'surface') fail(`${g.name}: solar array was accepted with the roof row closed`);
      if (bs.placeBlock('solarArray', { x: 0, y: 0, floor: 0 }, open) === null) fail(`${g.name}: solar array was accepted underground`);
      if (bs.placeBlock('memorialHall', { x: 0, y: 0, floor: 0 }, base) !== 'locked') fail(`${g.name}: memorial hall is not locked without its flag`);
      if (isBuildingUnlocked(base, 'memorialHall')) fail(`${g.name}: memorial hall counts as unlocked without its flag`);
      const lake = base.buildings.find(b => b.type === 'lake');
      const pond = bs.placeBlock('aquaculture', { x: 0, y: 0, floor: lake?.position.floor ?? 1 }, { ...base, buildings: base.buildings.filter(b => b.type !== 'lake') });
      if (pond !== 'adjacency' && pond !== 'overlap' && pond !== 'zone' && pond !== 'bounds') fail(`${g.name}: fish ponds without a lake gave ${pond ?? 'free'}`);
      if (lake) {
        const f = lake.position.floor;
        const free = [...Array(24).keys()].map(i => lake.position.x - 3 - i).find(x => bs.placeBlock('aquaculture', { x, y: 0, floor: f }, base) === null);
        notes.push(`${g.name}: fish ponds ${free === undefined ? 'have no free spot beside the lake' : `fit at slot ${free} beside the lake on floor ${f}`}`);
      } else notes.push(`${g.name}: no lake yet`);
    }

    // ---- the first remembered death opens the memorial hall ----
    {
      const sm = new StateManager();
      sm.loadState(JSON.parse(JSON.stringify(base)) as GameState);
      const ds = new DeathSystem(sm);
      const dead = sm.state.survivors[0];
      if (dead) {
        ds.onDeath(dead);
        if (sm.state.storyFlags.includes('memorial:first')) fail(`${g.name}: memorial:first is set before the memorial was answered`);
        ds.answerMemorial('carryOn', rs);
        if (!sm.state.storyFlags.includes('memorial:first')) fail(`${g.name}: answering the first memorial did not set memorial:first`);
        if (!isBuildingUnlocked(sm.state, 'memorialHall')) fail(`${g.name}: memorial hall stays locked after the flag`);
      }
    }

    // ---- [plan4:BL-24,25] districts: gated by Act and research, dug on their own floors ----
    {
      const mkDist = (type: BuildingType, floor: number): BuildingInstance => ({ ...mk(type, 1, floor, 12), position: { x: 12, y: 0, floor } });
      const world = (act: number, done: string[]): GameState => {
        const st = JSON.parse(JSON.stringify(base)) as GameState;
        st.currentFloors = 10;
        st.storyFlags = [...new Set([...st.storyFlags, 'districts:unlocked'])];
        st.buildings = [...st.buildings.filter(b => !isDistrict(b.type) && b.position.floor >= 0 && b.position.floor < 5), mkDist('cave', 1), mkDist('lake', 2), mkDist('metro', 3)];
        st.longGame.meta.act = act;
        for (const id of done) (st.research as Record<string, unknown>)[id] = { id, completed: true, progress: 0, active: false };
        return st;
      };
      const kinds = (st: GameState) => availableDistricts(st).map(d => d.kind as string);
      if (kinds(world(3, ['geothermalVents', 'vaultSurvey'])).length) fail(`${g.name}: a district is on offer in Act III: ${kinds(world(3, ['geothermalVents', 'vaultSurvey']))}`);
      if (kinds(world(4, [])).length) fail(`${g.name}: a district is on offer without its research`);
      const a4 = kinds(world(4, ['geothermalVents', 'vaultSurvey']));
      if (a4.join() !== 'geothermal') fail(`${g.name}: Act IV with both nodes offers ${a4.join() || 'nothing'}, expected geothermal only`);
      const a5 = kinds(world(5, ['geothermalVents', 'vaultSurvey']));
      if (a5.join() !== 'geothermal,oldVault') fail(`${g.name}: Act V with both nodes offers ${a5.join() || 'nothing'}, expected geothermal,oldVault`);
      const sm = new StateManager();
      sm.loadState(world(5, ['geothermalVents', 'vaultSurvey']));
      const gt = bs.digDistrict(sm, 'geothermal');
      const ov = bs.digDistrict(sm, 'oldVault');
      if (!gt || gt.position.floor !== 6 || !ov || ov.position.floor !== 5) fail(`${g.name}: the districts were dug on floors ${gt?.position.floor}/${ov?.position.floor}, expected 6/5`);
      if (kinds(sm.state).length) fail(`${g.name}: a dug district is offered again (${kinds(sm.state)})`);
      if (bs.digDistrict(sm, 'geothermal')) fail(`${g.name}: a district was dug twice`);
      for (const b of sm.state.buildings.filter(x => ['geothermal', 'oldVault'].includes(x.type))) if (!b.isConstructing || b.constructionTotal !== getDef(b.type)!.constructionTime) fail(`${g.name}: ${b.type} did not start as a construction`);
    }

    // ---- [plan4:BL-25] the pre-war vault makes whole blueprints from a trickle (stats.planDust carries the fraction) ----
    {
      const sm = new StateManager();
      sm.loadState(withRooms([{ ...mk('oldVault', 3, 5, 12), position: { x: 12, y: 0, floor: 5 } }]));
      const vault = sm.state.buildings[sm.state.buildings.length - 1];
      const before = sm.state.resources.blueprints.amount + sm.state.stats.planDust;
      let expected = 0;
      for (let i = 0; i < 40; i++) {
        for (const r of ['power', 'food', 'water']) (sm.state.resources as Record<string, { amount: number; cap: number }>)[r].amount = (sm.state.resources as Record<string, { cap: number }>)[r].cap;
        expected += (rs.getBuildingOutput(sm.state, vault).blueprints ?? 0) * 1000;
        rs.update(sm, 1000);
      }
      const gained = sm.state.resources.blueprints.amount + sm.state.stats.planDust - before;
      if (!(expected > 0.5)) fail(`${g.name}: a level 3 vault should make a plan or more in 40000 s, expected ${expected}`);
      if (Math.abs(gained - expected) > 0.02 * expected + 1e-6) fail(`${g.name}: the vault made ${gained.toFixed(4)} blueprints in 40000 s, expected ${expected.toFixed(4)}`);
      if (!(sm.state.stats.planDust >= 0 && sm.state.stats.planDust < 1) || !Number.isInteger(sm.state.resources.blueprints.amount - Math.floor(before))) fail(`${g.name}: planDust ${sm.state.stats.planDust} or blueprints ${sm.state.resources.blueprints.amount} is not whole + fraction`);
      const oldSave = JSON.parse(JSON.stringify(base)) as GameState; // a save from before the field: the key is simply absent
      delete (oldSave.stats as Partial<GameState['stats']>).planDust;
      const old = migrateState(oldSave);
      if (old.stats.planDust !== 0) fail(`${g.name}: migrateState does not default stats.planDust to 0`);
    }

    // ---- [plan4:BL-24] a worn level 3+ geothermal vent can burst (the steam disaster); the burst shuts it for a day ----
    {
      const sm = new StateManager();
      const vent = (level: number, wear: number): BuildingInstance => ({ ...mk('geothermal', level, 6, 12), position: { x: 12, y: 0, floor: 6 }, wear });
      const poolHas = (b: BuildingInstance): boolean => {
        sm.loadState(withRooms([b]));
        return new IncidentSystem(sm, new SeededRandom(3), rs).disasterPool(sm.state).some(p => p.kind === 'steam' && p.buildingId === b.id);
      };
      if (poolHas(vent(2, 90))) fail(`${g.name}: a level 2 vent can burst`);
      if (poolHas(vent(3, 39))) fail(`${g.name}: a level 3 vent at 39% wear can burst`);
      if (!poolHas(vent(3, 40))) fail(`${g.name}: a level 3 vent at 40% wear cannot burst`);
      const b = vent(4, 60);
      sm.loadState(withRooms([b]));
      const is = new IncidentSystem(sm, new SeededRandom(3), rs);
      const dz = is.spawnDisaster('steam');
      if (!dz || dz.kind !== 'steam' || dz.buildingId !== b.id) fail(`${g.name}: spawnDisaster('steam') gave ${dz?.kind}`);
      else {
        is.strike(dz, 'online', false);
        if (!((sm.state.danger.disabled?.[b.id] ?? 0) > Date.now())) fail(`${g.name}: a burst vent is not shut down`);
      }
    }

    // ---- [plan4:BL-34..38] where the Act rooms may stand ----
    {
      const deep = allowedFloors('seedLab', 10);
      if (!deep.length || deep.some(f => f < 3)) fail(`${g.name}: the seed lab may stand on ${deep} (deep levels only)`);
      if (!allowedFloors('componentsPlant', 10).includes(2) || !allowedFloors('forum', 10).includes(0)) fail(`${g.name}: plants belong in engineering and the forum in the living level`);
    }
    notes.push(`${g.name}: wave 2 effects, weather, children, placement and the memorial flag, then wave 3 districts, vault plans, steam bursts and Act rooms checked`);
    void effectiveLevel;
  }
  return { problems, notes };
}
