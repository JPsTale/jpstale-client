/**
 * 用 11 职业服务端的 OpenItem 扫描结果补齐我方缺失的物品。
 *
 * 背景：`ITEM_DEFS` 生成自 `gamedb.itemlist`（994 条），而 DB 是 10 职业年代的，
 * 缺 517 条（含格斗家的整套 WV 拳套 36 条）。权威文本源是
 * `src/game/data/source/items-11job.json`（1511 条，扫自 `GameServer/OpenItem/*.txt`，
 * 含 `code` / 中文 `name` / `idCode` / 数值）。
 *
 * 该扫描**没有** icon / classitem / modelposition —— 这三项按以下规则派生：
 *   icon  = 小写 code（与原版 `codeImg1`、模型名 `it{icon}.smd` 的规律一致）
 *   class / pos / w / h / sound = 从**同前缀已知道具**里投票取众数
 * 全部派生字段都带 `derived` 标注，不做静默填充。
 *
 * 输出：src/game/data/items-supplement.generated.json
 * 用法：npx tsx scripts/extract-items-from-11job.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ITEM_DEFS } from '../src/game/data/itemDefs.js';

const SRC = resolve('src/game/data/source/items-11job.json');
const OUT = resolve('src/game/data/items-supplement.generated.json');

interface ScanItem {
  code: string; name: string; idCode: number; category: string; group: string;
  sourceFile: string; weight?: number; price?: number; reqLevel?: number;
}
const scan = JSON.parse(readFileSync(SRC, 'utf8')) as ScanItem[];

const knownCodes = new Set(ITEM_DEFS.map((d) => d.code));
const missing = scan.filter((x) => x.idCode && !knownCodes.has(x.idCode));

/** 前缀（code 前两字母）→ 已知道具，用于投票派生 */
const byPrefix = new Map<string, typeof ITEM_DEFS>();
for (const d of ITEM_DEFS) {
  // 我方 ITEM_DEFS 的 icon 就是小写 code（如 wa101），取前两字母作前缀
  const p = d.icon.slice(0, 2).toLowerCase();
  byPrefix.set(p, [...(byPrefix.get(p) ?? []), d]);
}
const mode = <T,>(arr: T[]): T | undefined => {
  const m = new Map<T, number>();
  for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/** 武器前缀 → 单双手（1xx=单手 / 2xx=双手），与 .in 的武器代码段一致 */
const WEAPON_PREFIXES = new Set(['wa', 'wc', 'wd', 'wh', 'wm', 'wn', 'wp', 'ws', 'wt', 'wv']);
/** 派生用的兜底：任取一个已知 1H 武器的 (class,w,h,pos,sound) */
const anyWeapon = ITEM_DEFS.filter((d) => d.folder === 'weapon');
const fallback = {
  class: mode(anyWeapon.filter((d) => d.class === 4).map((d) => d.class)) ?? 4,
  w: mode(anyWeapon.map((d) => d.w)) ?? 1,
  h: mode(anyWeapon.map((d) => d.h)) ?? 3,
  pos: mode(anyWeapon.map((d) => d.pos)) ?? 4,
};

const out = missing.map((x) => {
  const icon = x.code.toLowerCase();
  const prefix = x.code.slice(0, 2).toLowerCase();
  const siblings = byPrefix.get(prefix) ?? [];
  const isWeapon = WEAPON_PREFIXES.has(prefix);
  const derived: Record<string, string> = {};
  const pick = <T,>(field: keyof typeof fallback, sib: T[]): T => {
    const m = mode(sib);
    derived[field] = m === undefined ? 'fallback(全体武器众数)' : `同前缀 ${prefix}×${siblings.length} 众数`;
    return (m ?? (fallback[field as keyof typeof fallback] as T)) as T;
  };
  const cls = pick('class', siblings.map((d) => d.class));
  const w = pick('w', siblings.map((d) => d.w));
  const h = pick('h', siblings.map((d) => d.h));
  const pos = pick('pos', siblings.map((d) => d.pos));
  const sound = mode(siblings.map((d) => d.sound)) ?? 0;
  if (siblings.length === 0) derived.sound = '无同族，取 0（拾取音未知）';
  return {
    code: x.idCode,
    name: x.name,
    icon,
    folder: isWeapon ? 'weapon' : (x.group === 'Armors' ? 'defense' : x.group.toLowerCase()),
    w, h,
    class: cls,
    pos,
    sound,
    reqLv: x.reqLevel ?? 0,
    /** 记录每项派生字段的依据，供人工核对 */
    derived,
    /** 原文来源，便于回溯 */
    src: { code: x.code, category: x.category, group: x.group, sourceFile: x.sourceFile },
  };
});

writeFileSync(OUT, JSON.stringify({
  note: '用 11 职业服务端 OpenItem 扫描结果（src/game/data/source/items-11job.json）补齐的'
    + '我方缺失物品。icon/class/pos/w/h/sound 为**派生值**（同前缀已知道具众数），'
    + '每条的 derived 字段记录了依据。生成物，勿手改。',
  sourceFile: 'src/game/data/source/items-11job.json',
  scanTotal: scan.length, knownInItemDefs: ITEM_DEFS.length, missingCount: out.length,
  byPrefix: Object.fromEntries([...new Map(out.map((o) => [o.icon.slice(0, 2), 0])).keys()]
    .map((p) => [p, out.filter((o) => o.icon.slice(0, 2) === p).length])),
  items: out,
}, null, 1) + '\n');

console.log(`扫描 ${scan.length} 条；我方 ITEM_DEFS ${ITEM_DEFS.length} 条；缺失 ${out.length} 条 → ${OUT}`);
const byP = new Map<string, number>();
for (const o of out) byP.set(o.icon.slice(0, 2), (byP.get(o.icon.slice(0, 2)) ?? 0) + 1);
console.log('缺失物品按前缀：');
for (const [p, n] of [...byP.entries()].sort((a, b) => b[1] - a[1])) {
  const sib = (byPrefix.get(p) ?? []).length;
  console.log(`  ${p.toUpperCase()}  ${String(n).padStart(4)} 条   同族已知道具 ${sib} 条`);
}
console.log('\n样例（WV 拳套）：');
for (const o of out.filter((x) => x.icon.startsWith('wv')).slice(0, 4)) {
  console.log(`  ${o.code}  ${o.name}  图标 ${o.icon}  class=${o.class} pos=${o.pos} reqLv=${o.reqLv}`);
}
