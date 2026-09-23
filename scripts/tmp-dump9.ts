import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync('src/game/data/source/skill-mapping.json', 'utf8')) as any;
console.log('keys', Object.keys(j).slice(0, 20));
console.log(JSON.stringify(j).slice(0, 1500));
