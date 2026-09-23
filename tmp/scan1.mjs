import {readFileSync} from 'node:fs';
const g=JSON.parse(readFileSync('src/game/data/anim-in/anim-m1.generated.json','utf8'));
const sk=g.entries.filter(e=>e.inxState==='SKILL');
for(const e of sk.slice(0,12)) console.log(e.inxIndex, JSON.stringify(e.inxSkillCodes), e.weapon.kind, JSON.stringify(e.weapon.codes), JSON.stringify(e.classes), JSON.stringify(e.locations));
