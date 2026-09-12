/**
 * 把 `.in` 提案的 skillCode 合并进运行时表 `src/game/data/skillIndexByIcon.ts`。
 *
 * 合并规则（保守，不改既有结论）：
 *   1. 表中**已有的非空值一律保留** —— 那是运行时现用值，不动。
 *   2. 表中为 null、或表里根本没有的 iconFile，用 `.in` 提案补：
 *      `/in-name`（.in 技能名与 skillData 名称匹配，证据强）优先于
 *      `positional`（按职业连续代码块顺序推，证据中）。
 *   3. 被动技能保持 null（本就没有动画）。
 *
 * 产物是**重写后的 TS 文件**（保留头部说明并注明新增来源与统计）。
 * 用法：npx tsx scripts/merge-skill-index.ts [--write]
 *   不带 --write 只打印将要发生的变化。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TS = resolve('src/game/data/skillIndexByIcon.ts');
const PROP = resolve('src/game/data/anim-in/skill-index-map.generated.json');
const WRITE = process.argv.includes('--write');

const src = readFileSync(TS, 'utf8');
const body = /export const SKILL_INDEX_BY_ICON[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
if (!body) throw new Error('未找到 SKILL_INDEX_BY_ICON 表');
const existing = new Map<string, number | null>();
// 兼容单引号与双引号：曾因写入用双引号、解析只认单引号，导致解析出空表后
// 静默把整张表覆写成"只剩提案"（丢了 19 个键、改了 50 个值）。
for (const m of body[1]!.matchAll(/['"]([^'"]+)['"]:\s*(null|\d+)/g)) {
  existing.set(m[1]!, m[2] === 'null' ? null : Number(m[2]));
}
if (existing.size === 0) throw new Error('解析出 0 条既有条目 —— 拒绝继续（表格式可能变了）');

const prop = JSON.parse(readFileSync(PROP, 'utf8')) as {
  classes: Record<string, Array<{ iconFile: string; name: string; code: number | null; src: string }>>;
};
/** iconFile → { code, src }，/in-name 优先 */
const proposal = new Map<string, { code: number; src: string }>();
for (const rows of Object.values(prop.classes)) {
  for (const r of rows) {
    if (r.code == null) continue;
    const cur = proposal.get(r.iconFile);
    if (!cur || (cur.src !== '/in-name' && r.src === '/in-name')) {
      proposal.set(r.iconFile, { code: r.code, src: r.src });
    }
  }
}

const merged = new Map(existing);
let kept = 0, filledNull = 0, added = 0, fromName = 0, fromPos = 0;
for (const [icon, p] of proposal) {
  const cur = existing.get(icon);
  if (cur != null) { kept++; continue; }
  merged.set(icon, p.code);
  if (cur === null) filledNull++; else added++;
  if (p.src === '/in-name') fromName++; else fromPos++;
}

const keys = [...merged.keys()].sort((a, b) => a.localeCompare(b, 'en'));
// 键用单引号，与原文件风格一致（减少无意义的 diff 噪音）
const q = (k: string) => `'${k.replace(/'/g, "\\'")}'`;
const lines = keys.map((k) => `  ${q(k)}: ${merged.get(k) ?? 'null'},`).join('\n');

const header = `// 技能图标 → saSkillData 动画索引（skillIndex）。
// 源：skill-mapping.json（Game.exe saSkillData ↔ EU 技能树交叉，2026-08-24）
//     + 11 职业服务端 .in 明文（2026-09-12 合并，见 scripts/merge-skill-index.ts）。
// 用途：WorldView 播放技能动画时，用该索引匹配 .inx SKILL 条目 skillCodeList。
// 未收录的技能（无专属动画，如纯被动）运行时回退普攻动画。
//
// 合并说明：既有非空值全部保留；仅补 null 与缺失项。
// 本次合并：保留既有 ${kept} 项，补 null ${filledNull} 项，新增 ${added} 项
//          （其中 .in 名称匹配 ${fromName} 项、按职业代码块顺序推 ${fromPos} 项）。
// 按顺序推的项若发现配错动画，改回 null 即可回退普攻。

export const SKILL_INDEX_BY_ICON: Record<string, number | null> = {
${lines}
};
`;

// 只替换「头部注释 + 表体」，**保留文件其余内容**（该文件还有
// `export function skillIndexByIcon()` 等导出，整文件重写会把它们弄丢）。
const tableStart = src.indexOf('export const SKILL_INDEX_BY_ICON');
const tableEnd = src.indexOf('\n};', tableStart);
if (tableStart < 0 || tableEnd < 0) throw new Error('未定位表体边界');
const tail = src.slice(tableEnd + 3);   // 表体结尾之后的内容（含其它导出）
const next = header + tail;

console.log(`既有表 ${existing.size} 项（非空 ${[...existing.values()].filter((v) => v != null).length}）`);
console.log(`合并后 ${merged.size} 项：保留 ${kept}，补 null ${filledNull}，新增 ${added}（名称匹配 ${fromName} / 顺序推 ${fromPos}）`);
if (WRITE) {
  if (!tail.includes('export function skillIndexByIcon')) {
    throw new Error('尾部未包含 skillIndexByIcon() —— 拒绝写入，避免再次丢导出');
  }
  // 硬校验：既有非空值一个都不能变，键一个都不能丢
  for (const [k, v] of existing) {
    if (!merged.has(k)) throw new Error(`拒绝写入：键丢失 ${k}`);
    if (v != null && merged.get(k) !== v) {
      throw new Error(`拒绝写入：既有值被改 ${k} ${v} → ${merged.get(k)}`);
    }
  }
  writeFileSync(TS, next);
  console.log(`已写入 ${TS}（尾部保留 ${tail.split('\n').length} 行）`);
} else {
  console.log('（加 --write 执行写入）');
}
