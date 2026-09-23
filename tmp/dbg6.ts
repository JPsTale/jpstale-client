/** 原版"这一招的声音从哪来"：EventSkill 是否 return FALSE（⇒ 落到 WeaponPlaySound）＋ SkillPlaySound 站点 */
import { readFileSync } from 'node:fs';
import { SKILLS } from '../src/game/skillData.js';
const SRC = 'E:/repo/NewSourcePT-2023/SrcGame/src/character.cpp';
const lines = readFileSync(SRC, 'latin1').split(/\r?\n/);
// EventSkill 区间
const start = lines.findIndex((l) => /int smCHAR::EventSkill\(\)/.test(l));
const end = start + lines.slice(start).findIndex((l) => /^\}/.test(l));
// 逐 case 收集
interface Rec { sounds: string[]; weapon: boolean; returnsFalse: boolean; line: number }
const byCode = new Map<string, Rec>();
let pending: string[] = [];
for (let i = 0; i < lines.length; i++) {
  const t = lines[i]!.trim();
  const lab = /^(?:case|default)\s+(SKILL_PLAY_\w+)\s*:/.exec(t);
  if (lab) { pending.push(lab[1]!); continue; }
  if (!pending.length) continue;
  const inEvent = i >= start && i <= end;
  for (const code of pending) {
    const r = byCode.get(code) ?? { sounds: [], weapon: false, returnsFalse: false, line: i + 1 };
    const sm = /SkillPlaySound\(\s*(SKILL_SOUND_\w+)/.exec(t);
    if (sm) r.sounds.push(sm[1]!);
    if (/WeaponPlaySound|PlayWaponSoundDirect/.test(t)) r.weapon = true;
    if (inEvent && /^return FALSE\b/.test(t)) r.returnsFalse = true;
    byCode.set(code, r);
  }
  if (/^(break|return)\b/.test(t)) pending = [];
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const byNorm = new Map<string, string[]>();
for (const list of Object.values(SKILLS)) for (const s of list) byNorm.set(norm(s.name), [s.name, s.iconFile]);
const rows: Array<{ job: number; icon: string; name: string; kind: string; code: string }> = [];
const jobOfDir: Record<string, number> = { fighter: 1, mecha: 2, archer: 3, pikeman: 4, atalanta: 5, knight: 6, magician: 7, priestess: 8, assassin: 9, shaman: 10, martial: 11 };
for (const c of ['fighter', 'pikeman', 'priestess']) {
  for (const s of SKILLS[c]!) {
    const key = norm(s.name);
    const hit = [...byCode.entries()].find(([code]) => norm(code.replace(/^SKILL_PLAY_/, '')) === key);
    const r = hit?.[1];
    const kind = !r ? '?nosrc' : (r.sounds.length ? 'skill-wav' : (r.returnsFalse ? 'weapon' : 'none'));
    rows.push({ job: jobOfDir[c]!, icon: s.iconFile, name: s.name, kind, code: hit?.[0] ?? '-' });
  }
}
for (const j of [1, 4, 8]) {
  console.log('== job', j);
  for (const r of rows.filter((x) => x.job === j)) console.log('  ', r.icon.padEnd(28), r.kind.padEnd(11), r.code);
  const c: Record<string, number> = {};
  for (const r of rows.filter((x) => x.job === j)) c[r.kind] = (c[r.kind] ?? 0) + 1;
  console.log('   counts', JSON.stringify(c));
}
