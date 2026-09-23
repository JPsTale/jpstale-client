import { SKILL_INDEX_BY_ICON } from '../src/game/data/skillIndexByIcon.js';
const byPrefix = new Map<string, Array<[string, number | null]>>();
for (const [k, v] of Object.entries(SKILL_INDEX_BY_ICON)) {
  const p = k.slice(0, 2);
  const arr = byPrefix.get(p) ?? [];
  arr.push([k, v as number | null]);
  byPrefix.set(p, arr);
}
for (const [p, arr] of [...byPrefix.entries()].sort()) {
  console.log('== ' + p + ' (' + arr.length + ')');
  console.log('   ' + arr.map(([k, v]) => `${k.replace(/\.bmp$/, '')}=${v}`).join('  '));
}
