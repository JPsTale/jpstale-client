import { SKILLS } from '../src/game/skillData.js';
for (const k of Object.keys(SKILLS)) {
  console.log('==', k, SKILLS[k].length);
  for (const s of SKILLS[k]) console.log('   ', s.iconFile.padEnd(30), s.name.padEnd(26), s.type, s.useCode);
}
