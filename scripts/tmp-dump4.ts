import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync('src/game/data/skill-tables.generated.json', 'utf8')) as any;
console.log('skillIndex sample', JSON.stringify(j.skillIndex).slice(0,600));
console.log('skills[0]', JSON.stringify(j.skills[0], null, 1));
console.log('skills pk', JSON.stringify(j.skills.filter((s:any)=>s.classDir==='pikeman'), null, 1).slice(0,4000));
