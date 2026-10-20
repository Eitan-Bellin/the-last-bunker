const f=process.argv[2];const j=require(f);
for(const r of j.runs){const m=r.milestones;const a=[1];for(let n=2;n<=7;n++)a.push(m['act '+n]?m['act '+n].wall/86400:null);
const end=Object.keys(m).find(k=>k.startsWith('ending'));const g=m['GENESIS available'];
const len=[];for(let n=1;n<7;n++){len.push(a[n]!=null?(a[n]-(n===1?0:a[n-1])).toFixed(2):'-')}
len.push(g&&a[6]!=null?(g.wall/86400-a[6]).toFixed(2):'-');
console.log('seed',r.seed,'starts',a.map(x=>x==null?'-':(+x).toFixed(2)).join(' '),'| lengths I..VII',len.join(' '),'| genesis',g?(g.wall/86400).toFixed(2):'-', end||'','deaths',r.deaths.total);
console.log('   ',Object.keys(m).filter(k=>/^story (frost|winter|quarrel|firstLaw|ridge|siege|signal|northStation|factions|firstVote|lastCensus|arkChapter)/.test(k)).map(k=>k.slice(6)+'='+(m[k].wall/86400).toFixed(1)).join(' '));}
