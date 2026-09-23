import {readFileSync} from 'node:fs';
const j=JSON.parse(readFileSync('src/game/data/source/skills.json','utf8'));
console.log(Object.keys(j));
const s=JSON.stringify(j);
console.log(s.slice(0,600));
