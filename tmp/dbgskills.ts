import { readFileSync } from 'node:fs';
const g = process.argv[2] ?? 'm1';
const j = JSON.parse(readFileSync('src/game/data/anim-in/anim-' + g + '.generated.json', 'utf8')) as {
  entries: Array<{ skills: string[]; inxSkillCodes: number[]; classes: string[]; inxFrames: [number, number]; inxIndex?: number; state?: number }>;
};
for (const e of j.entries) {
  if (!e.skills.length) continue;
  console.log('frames=' + JSON.stringify(e.inxFrames) + ' classes=' + JSON.stringify(e.classes)
    + ' codes=[' + e.inxSkillCodes.join(',') + '] skills=[' + e.skills.join(' | ') + ']');
}
