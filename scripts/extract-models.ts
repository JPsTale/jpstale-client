/**
 * 模型清单提取 —— 扫描资产树生成"可加载模型"清单，供资产检查器选择怪物/NPC。
 *
 * 为什么不用 pviewer 的 monster-list.json：那份是旧快照
 *   pviewer/js/monster-list.json = 414 条，而我们的资产树有 555 个怪物 .inx，
 *   直接抄会漏掉 141 个模型。
 *
 * 用法：npx tsx scripts/extract-models.ts
 *   可用 PT_ASSET_ROOT 覆盖资产根。
 */
import { writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ASSET_ROOT = resolve(process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client');
const OUT_DIR = resolve('src/tools/inspector/data');

export interface ModelEntry {
  /** 资产相对路径（小写，正斜杠），直接喂 loadMonsterModel */
  p: string;
  /** 分类：monster / npc / pet */
  cat: string;
}

const ROOTS: Array<[string, string]> = [
  ['char/monster', 'monster'],
  ['char/npc', 'npc'],
  ['char/lowlevelpet', 'pet'],
  ['char/pcbangpet', 'pet'],
];

const out: ModelEntry[] = [];

function walk(dirAbs: string, dirRel: string, cat: string): void {
  let entries: string[];
  try { entries = readdirSync(dirAbs); } catch { return; }
  for (const name of entries) {
    const abs = join(dirAbs, name);
    let isDir = false;
    try { isDir = statSync(abs).isDirectory(); } catch { continue; }
    const rel = `${dirRel}/${name.toLowerCase()}`;
    if (isDir) walk(abs, rel, cat);
    else if (name.toLowerCase().endsWith('.inx')) out.push({ p: rel, cat });
  }
}

for (const [root, cat] of ROOTS) walk(join(ASSET_ROOT, root), root, cat);

out.sort((a, b) => a.p.localeCompare(b.p));

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'model-list.json'), JSON.stringify(out, null, 1) + '\n');

const byCat = new Map<string, number>();
for (const e of out) byCat.set(e.cat, (byCat.get(e.cat) ?? 0) + 1);
console.log(`[extract-models] ${out.length} 个模型：` +
  [...byCat.entries()].map(([k, v]) => `${k}=${v}`).join(' '));
console.log(`[extract-models] 写出 ${OUT_DIR}/model-list.json`);

/* ─────────── 特效清单：INI 广告牌 + `.part` 粒子脚本 ─────────── */

/** f='ini' 走 effect/animationdata，f='part' 走 effect/particle/script 或 game/scripts/particles */
interface EffectEntry { n: string; f: 'ini' | 'part' }

const iniNames = readdirSync(join(ASSET_ROOT, 'effect/animationdata'))
  .filter((f) => f.toLowerCase().endsWith('.ini'))
  .map((f) => f.replace(/\.ini$/i, '').toLowerCase());

// `.part` 分散在两个目录，名字集合不同（经典 401 / 较新 106），合并去重
const partNames = [...new Set([
  ...readdirSync(join(ASSET_ROOT, 'effect/particle/script'))
    .filter((f) => f.toLowerCase().endsWith('.part'))
    .map((f) => f.replace(/\.part$/i, '').toLowerCase()),
  ...readdirSync(join(ASSET_ROOT, 'game/scripts/particles'))
    .filter((f) => f.toLowerCase().endsWith('.part'))
    .map((f) => f.replace(/\.part$/i, '').toLowerCase()),
])].sort();

const effects: EffectEntry[] = [
  ...iniNames.map((n) => ({ n, f: 'ini' as const })).sort((a, b) => a.n.localeCompare(b.n)),
  ...partNames.map((n) => ({ n, f: 'part' as const })).sort((a, b) => a.n.localeCompare(b.n)),
];

writeFileSync(join(OUT_DIR, 'effect-list.json'), JSON.stringify(effects, null, 1) + '\n');
console.log(`[extract-models] 特效 ${effects.length} 个（ini=${iniNames.length} part=${partNames.length}）→ ${OUT_DIR}/effect-list.json`);
