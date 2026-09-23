import {readFileSync} from 'node:fs';
const g=JSON.parse(readFileSync('src/game/data/skill-code-map.json','utf8'));
console.log(Object.keys(g));
console.log('rows',g.rows.length);
const f=g.rows.filter(r=>r.classDir==='fighter');
for(const r of f) console.log(r.code, (r.skill||'-').padEnd(20), JSON.stringify(r.sounds), 'presenters='+JSON.stringify(r.presenters).slice(0,60));
