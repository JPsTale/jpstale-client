import { readFileSync } from 'node:fs';
import { SKILLS, CLASS_DIR } from '../src/game/skillData.js';
import { SKILL_INDEX_BY_ICON } from '../src/game/data/skillIndexByIcon.js';

const j = JSON.parse(readFileSync('src/game/data/source/skill-mapping.json', 'utf8')) as {
  mapping: Array<{ index: number; class: string | null; our_name: string | null; eu_name: string | null; eu_code: string | null }>;
};
const norm = (s: string) => s.replace(/[\s_\-']/g, '').toUpperCase();
const codeByClass = new Map<string, Map<string, number[]>>();
for (const m of j.mapping) {
  if (!m.our_name || !m.class) continue;
  const c = m.class.toLowerCase();
  const m2 = codeByClass.get(c) ?? new Map<string, number[]>();
  const arr = m2.get(norm(m.our_name)) ?? [];
  arr.push(m.index);
  m2.set(norm(m.our_name), arr);
  codeByClass.set(c, m2);
}

for (const [idStr, dir] of Object.entries(CLASS_DIR)) {
  const id = Number(idStr);
  const table = codeByClass.get(dir === 'mecha' ? 'mechanician' : dir === 'priestess' ? 'priest' : dir) ?? new Map();
  console.log('== job' + id + ' ' + dir + '  名字表 ' + table.size);
  for (const sk of SKILLS[dir] ?? []) {
    const cur = (SKILL_INDEX_BY_ICON as Record<string, number | null>)[sk.iconFile] ?? null;
    const hits = new Set<number>();
    for (const n of [sk.name, sk.alt].filter(Boolean) as string[]) {
      for (const c of table.get(norm(n)) ?? []) hits.add(c);
    }
    const list = [...hits].sort((a, b) => a - b);
    const mark = list.length === 1 ? (list[0] === cur ? '  ' : '<<') : '??';
    console.log(mark + ' ' + sk.iconFile.padEnd(28) + ' ' + String(cur).padStart(4) + ' -> [' + list.join(',') + ']  ' + sk.name + (sk.alt ? ' / ' + sk.alt : '') + '  type=' + sk.type + ' use=' + sk.useCode);
  }
}
