import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
for (const g of ['m1','m2','m3','m5','m6','m7','m8']) {
  const j = JSON.parse(readFileSync(resolve('src/game/data/anim-in', `anim-${g}.generated.json`), 'utf8')) as any;
  const seen = new Map<number, string[]>();
  for (const e of j.entries) {
    for (const c of e.inxSkillCodes) {
      if (!seen.has(c)) seen.set(c, []);
      seen.get(c)!.push(e.skills.join('/') || '(无)');
    }
  }
  const codes = [...seen.keys()].sort((a, b) => a - b);
  console.log(`== ${g}: ${codes.length} codes`);
  console.log('   ' + codes.map((c) => `${c}:${seen.get(c)![0]}`).join('  '));
  const empty = j.entries.filter((e: any) => e.skills.length && !e.inxSkillCodes.length);
  if (empty.length) console.log(`   [无码] ` + empty.map((e: any) => `${e.skills.join('/')}@${e.inxFrames}`).join('  '));
}
