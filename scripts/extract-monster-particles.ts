/**
 * **`<资产> → 谁在用` 索引抽取** —— 从原版源码抽出粒子/特效资产的使用者（怪 / 技能）。
 *
 * 为什么需要（用户 2026-09-18 定调）：粒子系统的缺口分析必须能被**肉眼核对**，
 * 而核对要在实验室里放"某只怪的某一招"。只靠 `MONSTER_ATTACK_FX` 里已核验的十几只怪不够
 * （119/445 个 `.part`）；其余资产的归属只在原版源码里。
 *
 * 抽法（**两趟**；v2 是"每条线索重扫全树"，平方级、太慢 ✗）：
 *   第 1 趟（遍历所有 .cpp 一次）：
 *     · 资产名字符串字面量（按基名匹配）→ 记录它所在的**函数 + 最近的 case 标签**；
 *     · **调用边**：每行的 `Name(` → 把"调用点所在的函数 + case"记进 `calls` 索引。
 *   第 2 趟：没撞到 case 的线索用 `calls` 索引向上回溯（≤3 跳），直到
 *     `case snCHAR_SOUND_*:`（怪物的哪一招）/ `case SKILL_PLAY_*:`（玩家技能）。
 *
 * ⚠ 文本匹配，不是编译器：同名函数/宏有噪声，多跳会放大 ⇒ 输出带 `hops`/`via`，
 *   **是线索表，不是真值表**（`Class::Method` 形式的跨文件调用多半追不到，如实记"未撞到 case"）。
 *
 * 用法：`npx tsx scripts/extract-monster-particles.ts [源码根]`
 *   · 源码根默认 `E:/repo/NewSourcePT-2023/SrcGame/src`
 *   · `PT_ASSET_ROOT` 资产根（默认 `E:/JPsTale/client`）
 *   · `PT_MONSTERS_JSON` 怪物表（把 `snCHAR_SOUND_*` 映射成怪名）
 * 输出：`src/game/data/monster-particles.generated.json`
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC_ROOT = process.argv[2] ?? process.env.PT_SRC_ROOT ?? 'E:/repo/NewSourcePT-2023/SrcGame/src';
const ASSET = process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client';
const MONSTERS_JSON = process.env.PT_MONSTERS_JSON
  ?? 'E:/JPsTale/efria/efria-studio/output/monsters-resolved.json';
const OUT = process.env.PT_OUT ?? 'src/game/data/monster-particles.generated.json';

const PARTS = new Set<string>();
for (const root of ['effect/particle/script', 'game/scripts/particles']) {
  const dir = path.join(ASSET, root);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f.toLowerCase().endsWith('.part')) PARTS.add(f.replace(/\.part$/i, '').toLowerCase());
  }
}
const enumToName = new Map<string, string>();
try {
  const mj = JSON.parse(fs.readFileSync(MONSTERS_JSON, 'utf8')) as {
    resolved?: Array<{ name: string; enumName: string }>;
  };
  for (const r of mj.resolved ?? []) if (r.enumName) enumToName.set(r.enumName.toUpperCase(), r.name);
} catch { /* 没有怪物表 ⇒ 只记 case 名 */ }

const files: string[] = [];
(function walk(dir: string): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.cpp')) files.push(p);
  }
})(SRC_ROOT);
const rel = (p: string): string => path.relative(SRC_ROOT, p).replace(/\\/g, '/');

/** 上下文（函数 / case）—— 两趟共用同一套判定，避免规则漂移 */
interface Ctx { func: string; monsterCase: string | null; skillCase: string | null }
const FUNC_RE = /^[A-Za-z_][\w:<>,*&\s]*\(/;
const SKIP_RE = /^(case|if|for|while|switch|return|else|typedef|struct|class)\b/;

interface Hit extends Ctx {
  asset: string; file: string; line: number; hops: number; via: string; monsterName: string | null;
}
const hits: Hit[] = [];
/** 调用索引：被调名字 → 调用点（含其上下文） */
const calls = new Map<string, Array<Ctx & { file: string; line: number }>>();
const CALL_RE = /\b([A-Za-z_]\w{3,})\s*\(/g;
const NOT_A_CALL = /^(if|for|while|switch|return|sizeof)$/;

for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  let ctx: Ctx = { func: '(文件级)', monsterCase: null, skillCase: null };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FUNC_RE.test(line) && !SKIP_RE.test(line)) {
      // 去掉返回类型（`int Foo(` → `Foo`；`void A::B(` → `A::B`）。
      // ⚠ v2 就是这里把返回类型带进去了 ⇒ 回溯时按 `int Foo(` 找调用点，永远找不到 ✗
      ctx = { func: line.trim().split('(')[0]!.trim().split(/\s+/).pop()!, monsterCase: null, skillCase: null };
    }
    const mc = /\bcase\s+(snCHAR_SOUND_[A-Z_0-9]+)\s*:/.exec(line);
    if (mc) ctx = { ...ctx, monsterCase: mc[1]!, skillCase: null };
    const sc = /\bcase\s+(SKILL_PLAY_[A-Z_0-9]+)\s*:/.exec(line);
    if (sc) ctx = { ...ctx, skillCase: sc[1]! };
    // 超长行（数据表）跳过调用索引，省时间
    if (line.length <= 400) {
      CALL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CALL_RE.exec(line)) !== null) {
        const name = m[1]!;
        if (NOT_A_CALL.test(name)) continue;
        (calls.get(name) ?? calls.set(name, []).get(name)!).push({ ...ctx, file: rel(f), line: i + 1 });
      }
    }
    for (const q of line.matchAll(/"([^"]{2,120})"/g)) {
      const base = q[1]!.replace(/\\+/g, '/').split('/').pop()!.replace(/\.[A-Za-z0-9]+$/, '').toLowerCase();
      if (!PARTS.has(base)) continue;
      hits.push({ asset: base, file: rel(f), line: i + 1, hops: 0, via: '资产名出现在该函数体内', monsterName: null, ...ctx });
    }
  }
}

// 第 2 趟：回溯（只查表，不重扫）
const outRows: Hit[] = [];
for (const h of hits) {
  if (h.monsterCase || h.skillCase || h.func === '(文件级)') { outRows.push(h); continue; }
  let frontier = [h.func];
  const seen = new Set(frontier);
  let placed = false;
  for (let hop = 1; hop <= 3 && !placed; hop++) {
    const next: string[] = [];
    for (const fn of frontier) {
      for (const c of calls.get(fn) ?? []) {
        if (c.monsterCase || c.skillCase) {
          outRows.push({ ...h, hops: hop, monsterCase: c.monsterCase, skillCase: c.skillCase,
            via: `${h.func} ← ${c.func}（${c.file}:${c.line}）` });
          placed = true;
          break;
        }
        if (!seen.has(c.func) && c.func !== '(文件级)') { seen.add(c.func); next.push(c.func); }
      }
      if (placed) break;
    }
    frontier = next;
  }
  if (!placed) outRows.push({ ...h, via: `仅回溯到 ${h.func}（未撞到 case）` });
}
for (const r of outRows) {
  const en = r.monsterCase?.replace(/^snCHAR_SOUND_/, '') ?? null;
  r.monsterName = en ? enumToName.get(en.toUpperCase()) ?? null : null;
}

const seen = new Set<string>();
const uniq = outRows.filter((r) => {
  const k = `${r.asset}|${r.monsterCase}|${r.skillCase}|${r.file}|${r.line}`;
  if (seen.has(k)) return false; seen.add(k); return true;
});
uniq.sort((a, b) => a.asset.localeCompare(b.asset) || a.file.localeCompare(b.file) || a.line - b.line);

fs.writeFileSync(OUT, JSON.stringify({
  note: '从原版源码抽出的「.part 资产 → 使用者（怪 / 技能）」**线索表**（不是真值表）：'
    + 'via=文本匹配 + ≤3 跳调用者回溯，命中的是 `case snCHAR_SOUND_*`（怪）/`case SKILL_PLAY_*`（玩家技能）。'
    + '生成：scripts/extract-monster-particles.ts（npx tsx scripts/extract-monster-particles.ts）',
  srcRoot: SRC_ROOT, filesScanned: files.length, rows: uniq,
}, null, 1) + '\n');

console.log(`扫描 ${files.length} 个 .cpp（${SRC_ROOT}）`);
console.log(`资产表 ${PARTS.size} 个 .part；线索 ${uniq.length} 条，覆盖 ${new Set(uniq.map((r) => r.asset)).size} 个资产`);
console.log(`撞到怪物 case：${uniq.filter((r) => r.monsterCase).length} 条`
  + `（能映射怪名 ${uniq.filter((r) => r.monsterName).length} 条）；撞到技能 case：${uniq.filter((r) => r.skillCase).length} 条`);
console.log(`写出 ${OUT}`);
for (const probe of ['bluemountainhit1', 'frostwindbegin', 'chaoskaraskilluser', 'alas', 'skill3priestessvigorball1']) {
  const hit = uniq.filter((r) => r.asset === probe);
  console.log(`\n  ${probe}: ${hit.length} 条`);
  for (const h of hit.slice(0, 3)) {
    console.log(`    ${h.file}:${h.line} 跳${h.hops}  ${h.monsterCase ?? h.skillCase ?? '(无 case)'}`
      + `${h.monsterName ? ` → ${h.monsterName}` : ''}   via ${h.via}`);
  }
}
