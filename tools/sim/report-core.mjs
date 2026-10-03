// Aggregation and text tables for simulator results. Plain JS with no Node imports, so the Node runner,
// the report CLI (report.mjs) and the browser page (tools/balance.ts) all share it. Types: report-core.d.mts.

export const KEY_MILESTONES = [
  'era 1 restoration', 'era 2 colony', 'era 3 undercity', 'all ruins cleared', 'first expedition back',
  'floor B4', 'floor B5', 'floor B6', 'floor B7', 'floor B8', 'population 10', 'population 20', 'population 30', 'population 40', 'population 50',
  'research temporalTheory', 'GENESIS available', 'first death',
];
const RES = ['food', 'water', 'power', 'materials', 'knowledge', 'scrap', 'medicine'];

const median = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const fmtT = sec => {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d${String(h % 24).padStart(2, '0')}h`;
  return `${h}h${String(m).padStart(2, '0')}m`;
};
const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`);
const num = v => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));
const sumObj = o => Object.values(o ?? {}).reduce((a, b) => a + b, 0);

export function aggregate(runs) {
  const N = runs.length;
  const keys = new Set(runs.flatMap(r => Object.keys(r.milestones)));
  const milestones = {};
  for (const k of keys) {
    const wall = runs.map(r => r.milestones[k]?.wall).filter(v => v != null);
    const play = runs.map(r => r.milestones[k]?.play).filter(v => v != null);
    milestones[k] = { reached: wall.length, of: N, wallMed: median(wall), wallMin: wall.length ? Math.min(...wall) : null, wallMax: wall.length ? Math.max(...wall) : null, playMed: median(play) };
  }
  const per = f => { const v = runs.map(f).filter(x => x != null && !Number.isNaN(x)); return { med: median(v), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null }; };
  const capShare = Object.fromEntries(RES.map(k => [k, median(runs.map(r => r.capShare[k] ?? 0))]));
  const off = runs.flatMap(r => r.offline);
  return {
    runs: N,
    milestones,
    final: {
      era: per(r => r.final.era), floors: per(r => r.final.floors), pop: per(r => r.final.pop), research: per(r => r.final.research),
      levels: per(r => r.final.levels), explored: per(r => r.final.explored), tutorialStep: per(r => r.final.tutorialStep),
    },
    genesisReached: runs.filter(r => r.genesis).length,
    genesisPayout: per(r => r.genesis?.payout ?? null),
    rebirthPayoutEnd: per(r => r.rebirthPayoutEnd),
    deaths: per(r => r.deaths.total), injuries: per(r => r.injuries.expedition + r.injuries.raid + r.injuries.sickness),
    famineSeconds: per(r => r.famineSeconds), thirstSeconds: per(r => r.thirstSeconds),
    idleShare: per(r => r.idle.share), gapsOver5m: per(r => r.idle.gapsOver5m),
    stallWallH: per(r => r.stallWallH), stallPlayH: per(r => r.stallPlayH),
    chapters: per(r => r.chapters.length), chaptersTotal: runs[0]?.chaptersTotal,
    capShare,
    lateGame: runs.some(r => r.lateGame) ? { stages: per(r => r.lateGame?.stages), projects: per(r => r.lateGame?.projectsDone), ok: per(r => r.lateGame?.caravansOk), lost: per(r => r.lateGame?.caravansLost), weekly: per(r => r.lateGame?.weekly), trained: per(r => r.lateGame?.trained), rank5: per(r => r.lateGame?.rank5) } : null, // [LateGame]
    offline: {
      returns: off.length,
      emptyReturns: off.filter(x => Object.values(x.gained).every(v => v <= 0) && !x.arrivals && !x.missions && !x.research).length,
      gainedMed: Object.fromEntries(RES.map(k => [k, median(off.map(x => x.gained[k] ?? 0))])),
      wastedMed: Object.fromEntries(RES.map(k => [k, median(off.map(x => x.wasted[k] ?? 0))])),
      wastedShareOfPotential: (() => {
        const w = off.reduce((a, x) => a + sumObj(x.wasted), 0), g = off.reduce((a, x) => a + Math.max(0, sumObj(x.gained)), 0);
        return w + g > 0 ? +(w / (w + g)).toFixed(3) : null;
      })(),
      arrivals: off.reduce((a, x) => a + (x.arrivals ?? 0), 0), missions: off.reduce((a, x) => a + (x.missions ?? 0), 0),
      research: off.reduce((a, x) => a + (x.research ?? 0), 0), starvingOnReturn: off.filter(x => x.starvingOnReturn).length,
      wastedEstimated: off.some(x => x.wastedEstimated),
    },
    arrivalsAccepted: per(r => r.arrivals.accepted), arrivalsRefused: per(r => r.arrivals.refused),
    warnings: [...new Set(runs.flatMap(r => r.warnings))],
  };
}

export function textReport(data) {
  const { meta, runs } = data;
  const agg = data.aggregate ?? aggregate(runs);
  const L = [];
  const len = meta.mode === 'greedy' ? `${meta.hours} h online` : `${meta.days} d`;
  L.push(`=== ${meta.mode} · ${len} · seeds ${runs.map(r => r.seed).join(',')} · think ${meta.think}s · ${meta.fingerprint?.src ?? 'src'} #${meta.fingerprint?.hash ?? '?'} (newest change ${meta.fingerprint?.newestChange ?? '?'}) ===`);
  if (meta.note) L.push(`note: ${meta.note}`);
  L.push('');
  L.push('Milestones (wall time)            reached  median   [min – max]       online(med)');
  const order = [...KEY_MILESTONES, ...Object.keys(agg.milestones).filter(k => k.startsWith('story ')).sort((a, b) => (agg.milestones[a].wallMed ?? 0) - (agg.milestones[b].wallMed ?? 0))];
  for (const k of order) {
    const m = agg.milestones[k];
    if (!m) { if (KEY_MILESTONES.includes(k)) L.push(`  ${k.padEnd(31)} 0/${agg.runs}`); continue; }
    L.push(`  ${k.padEnd(31)} ${`${m.reached}/${m.of}`.padStart(5)}  ${fmtT(m.wallMed).padStart(7)}  [${fmtT(m.wallMin)} – ${fmtT(m.wallMax)}]`.padEnd(70) + fmtT(m.playMed));
  }
  L.push('');
  L.push(' seed  era1    era2    era3    B4      B6      genesis(iso)    pop  res  fl lv   dead famine  idle  stall  chap  wasted/ret');
  for (const r of runs) {
    const ms = k => fmtT(r.milestones[k]?.wall).padEnd(7);
    const gen = r.genesis ? `${fmtT(r.genesis.wall)}(${r.genesis.payout})` : '—';
    const wasted = r.offline.length ? Math.round(r.offline.reduce((a, x) => a + sumObj(x.wasted), 0) / r.offline.length) : 0;
    L.push(` ${String(r.seed).padStart(4)}  ${ms('era 1 restoration')} ${ms('era 2 colony')} ${ms('era 3 undercity')} ${ms('floor B4')} ${ms('floor B6')} ${gen.padEnd(15)} ${String(r.final.pop).padStart(3)}  ${String(r.final.research).padStart(3)}  ${r.final.floors} ${String(r.final.levels).padStart(3)}  ${String(r.deaths.total).padStart(4)} ${fmtT(r.famineSeconds).padStart(6)}  ${pct(r.idle.share).padStart(4)}  ${String(r.stallWallH.toFixed(0) + 'h').padStart(5)}  ${`${r.chapters.length}/${r.chaptersTotal}`.padStart(4)}  ${String(wasted).padStart(6)}`);
  }
  L.push('');
  const f = agg.final;
  L.push(`End state (median [min–max]): era ${num(f.era.med)} · floors ${num(f.floors.med)} [${f.floors.min}–${f.floors.max}] · pop ${num(f.pop.med)} [${f.pop.min}–${f.pop.max}] · research ${num(f.research.med)} [${f.research.min}–${f.research.max}] · room levels ${num(f.levels.med)} · explored ${num(f.explored.med)} · objective step ${num(f.tutorialStep.med)}`);
  L.push(`Genesis available in ${agg.genesisReached}/${agg.runs} runs; payout at unlock ${num(agg.genesisPayout.med)} · payout estimate at end ${num(agg.rebirthPayoutEnd.med)} [${agg.rebirthPayoutEnd.min}–${agg.rebirthPayoutEnd.max}]`);
  L.push(`Danger: deaths ${num(agg.deaths.med)} [${agg.deaths.min}–${agg.deaths.max}] · injuries ${num(agg.injuries.med)} · famine ${fmtT(agg.famineSeconds.med)} · thirst ${fmtT(agg.thirstSeconds.med)} (online)`);
  if (agg.lateGame) { const g = agg.lateGame; L.push(`Late game: project stages ${num(g.stages.med)} (projects done ${num(g.projects.med)}) · caravans home ${num(g.ok.med)} lost ${num(g.lost.med)} · weekly ${num(g.weekly.med)} · trainings ${num(g.trained.med)} · rank-5 workers ${num(g.rank5.med)}`); }
  L.push(`Pace: idle share ${pct(agg.idleShare.med)} [${pct(agg.idleShare.min)}–${pct(agg.idleShare.max)}] · gaps ≥5 min ${num(agg.gapsOver5m.med)} · last progress ${num(agg.stallWallH.med)} h before the end (wall; online ${num(agg.stallPlayH.med)} h) · story ${num(agg.chapters.med)}/${agg.chaptersTotal} chapters`);
  L.push(`At cap (online share, median): ${RES.map(k => `${k} ${pct(agg.capShare[k])}`).join(' · ')}`);
  if (agg.offline.returns) {
    const o = agg.offline;
    const show = obj => RES.filter(k => obj[k]).map(k => `${k} ${Math.round(obj[k])}`).join(' ') || 'nothing';
    L.push(`Offline: ${o.returns} returns, ${o.emptyReturns} brought nothing · median gain per return: ${show(o.gainedMed)} · median wasted: ${show(o.wastedMed)}${o.wastedEstimated ? ' (estimated)' : ''} · wasted share ${pct(o.wastedShareOfPotential)}`);
    L.push(`         door arrivals ${o.arrivals} · teams home ${o.missions} · research done ${o.research} · returns to a starving bunker ${o.starvingOnReturn}`);
  }
  L.push(`Newcomers accepted ${num(agg.arrivalsAccepted.med)} · refused (no bed/food) ${num(agg.arrivalsRefused.med)}`);
  if (agg.warnings.length) { L.push(''); L.push('Warnings:'); for (const w of agg.warnings.slice(0, 15)) L.push(`  - ${w}`); }
  return L.join('\n');
}

export function compareReport(a, b) {
  const A = a.aggregate ?? aggregate(a.runs), B = b.aggregate ?? aggregate(b.runs);
  const L = [`Compare: A = ${a.meta.mode} ${a.meta.fingerprint?.src}#${a.meta.fingerprint?.hash} (${a.meta.startedAt})`, `         B = ${b.meta.mode} ${b.meta.fingerprint?.src}#${b.meta.fingerprint?.hash} (${b.meta.startedAt})`, ''];
  L.push('Milestone (wall, median)           A                 B');
  for (const k of KEY_MILESTONES) {
    const x = A.milestones[k], y = B.milestones[k];
    const cell = m => (m ? `${fmtT(m.wallMed)} ${m.reached}/${m.of}` : `— 0/${A.runs}`);
    L.push(`  ${k.padEnd(31)} ${cell(x).padEnd(17)} ${cell(y)}`);
  }
  const row = (label, fa, fb) => L.push(`  ${label.padEnd(31)} ${String(fa).padEnd(17)} ${fb}`);
  L.push('');
  row('final pop', num(A.final.pop.med), num(B.final.pop.med));
  row('final research', num(A.final.research.med), num(B.final.research.med));
  row('final floors', num(A.final.floors.med), num(B.final.floors.med));
  row('genesis reached', `${A.genesisReached}/${A.runs}`, `${B.genesisReached}/${B.runs}`);
  row('payout at end', num(A.rebirthPayoutEnd.med), num(B.rebirthPayoutEnd.med));
  row('deaths', num(A.deaths.med), num(B.deaths.med));
  row('famine (online)', fmtT(A.famineSeconds.med), fmtT(B.famineSeconds.med));
  row('idle share', pct(A.idleShare.med), pct(B.idleShare.med));
  row('stall before end (wall h)', num(A.stallWallH.med), num(B.stallWallH.med));
  row('story chapters', num(A.chapters.med), num(B.chapters.med));
  for (const k of RES) row(`at cap: ${k}`, pct(A.capShare[k]), pct(B.capShare[k]));
  row('offline empty returns', `${A.offline.emptyReturns}/${A.offline.returns}`, `${B.offline.emptyReturns}/${B.offline.returns}`);
  row('offline wasted share', pct(A.offline.wastedShareOfPotential), pct(B.offline.wastedShareOfPotential));
  return L.join('\n');
}
