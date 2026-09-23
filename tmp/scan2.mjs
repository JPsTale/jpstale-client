import {readFileSync} from 'node:fs';
const g=JSON.parse(readFileSync('src/game/data/item-weapon-semantics.generated.json','utf8'));
const e=Object.entries(g.byIdcode)[0];
console.log(JSON.stringify(e,null,1));
// group by primaryClass
const map={};
for(const [k,v] of Object.entries(g.byIdcode)){ (map[v.primaryClass||'?'] ||= []).push([k,v.type,v.hand]); }
for(const [c,l] of Object.entries(map)) console.log(c, l.length, JSON.stringify(l.slice(0,4)));
