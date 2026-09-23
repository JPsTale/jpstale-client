import {readFileSync} from 'node:fs';
const g=JSON.parse(readFileSync('src/game/data/anim-in/anim-m1.generated.json','utf8'));
console.log('pairedCount',g.pairedCount,'activeCount',g.activeCount,'inEntryCount',g.inEntryCount,'inxRowCount',g.inxRowCount);
const sk=g.entries.filter(e=>e.inxState==='SKILL');
let empty=0;
for(const e of sk){ if(!(e.inxSkillCodes||[]).length){empty++; console.log('EMPTY-CODE', e.inxIndex, e.motion, JSON.stringify(e.skills).slice(0,120)); } }
console.log('SKILL entries with empty codes:', empty, '/', sk.length);
