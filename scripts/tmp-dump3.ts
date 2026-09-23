import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync('src/game/data/skill-tables.generated.json', 'utf8')) as any;
console.log('counts', JSON.stringify(j.counts));
console.log('defects', JSON.stringify(j.defects, null, 1));
console.log('macros[0..5]', JSON.stringify(j.macros.slice(0,3)));
console.log('align keys', Object.keys(j.align));
console.log('align', JSON.stringify(j.align).slice(0, 2000));
