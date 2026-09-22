/** 一次性诊断：classIconFile 对全表的覆盖（跑完即删） */
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh' }, configurable: true });

const { classIconFile } = await import('../src/ui/itemInfoLines.js');
const { ITEM_DEFS } = await import('../src/game/data/itemDefs.js');

const per = new Map<string, { n: number; sample: string[] }>();
for (const d of ITEM_DEFS) {
  const f = classIconFile({ itemlistId: d.id, itemCode: d.code } as never) ?? '(不画)';
  const e = per.get(f) ?? { n: 0, sample: [] };
  e.n++;
  if (e.sample.length < 3) e.sample.push(`${d.icon} ${d.name}`);
  per.set(f, e);
}
for (const [k, v] of [...per.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(String(v.n).padStart(5), k.padEnd(22), v.sample.join(' / '));
}
console.log('总表', ITEM_DEFS.length, '不画', per.get('(不画)')?.n ?? 0);

// 家族 → 当前判定
const fams = new Map<number, { n: number; icon: string; cls: number }>();
for (const d of ITEM_DEFS) {
  const fam = (d.code >>> 0) & 0xffff0000;
  if (!fams.has(fam)) fams.set(fam, { n: 0, icon: d.icon, cls: d.class });
  fams.get(fam)!.n++;
}
console.log('\n家族 前缀 class 当前图标');
for (const [f, v] of [...fams.entries()].sort((a, b) => a[0] - b[0])) {
  const icon = classIconFile({ itemlistId: ITEM_DEFS.find((d) => ((d.code >>> 0) & 0xffff0000) === f)!.id, itemCode: f } as never) ?? '(不画)';
  console.log('0x' + f.toString(16).padStart(8, '0'), v.icon.replace(/\d+$/, '').padEnd(6), String(v.cls).padStart(5), 'n=' + String(v.n).padStart(3), icon);
}
