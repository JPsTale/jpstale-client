import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
for (const g of ['m4']) {
  const j = JSON.parse(readFileSync(resolve('src/game/data/anim-in', `anim-${g}.generated.json`), 'utf8')) as any;
  for (const e of j.entries) {
    if (!e.skills.length) continue;
    console.log(`${g} #${e.inxIndex} ${e.inxState} frames=${e.inxFrames} codes=[${e.inxSkillCodes}] classes=[${e.classes}] skills=[${e.skills}] loc=[${e.locations}]`);
  }
}
