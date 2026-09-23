import { readFileSync } from 'node:fs';
const paths = [
  'E:/repo/NewSourcePT-2023/SrcGame/src/character.cpp',
  'E:/repo/NewSourcePT-2023/SrcGame/src/SkillSub.cpp',
];
for (const p of paths) {
  const lines = readFileSync(p, 'latin1').split(/\r?\n/);
  console.log('=====', p);
  let pending: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    const lab = /^(?:case|default)\s+(SKILL_PLAY_\w+|SKILL_\w+)\s*:/.exec(t);
    if (lab) { pending.push(lab[1]!); continue; }
    if (/^(break|return)\b/.test(t)) { pending = []; continue; }
    if (!pending.length) continue;
    if (/WeaponPlaySound|PlayWaponSoundDirect|SkillPlaySound/.test(t)) {
      const m = /(WeaponPlaySound\s*\(\s*[^)]*\)|PlayWaponSoundDirect\s*\([^)]*\)|SkillPlaySound\s*\(\s*(SKILL_SOUND_\w+))/.exec(t);
      console.log(`  L${i + 1} ${pending.join('|')} → ${m ? m[0] : t.slice(0, 70)}`);
    }
  }
}
