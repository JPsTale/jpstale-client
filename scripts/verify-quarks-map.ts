/**
 * B1 校验器一：quarks-map.json 的**结构与口径**核对（对应 02-交付标准 §1.1 的校验 1/2/6）。
 *
 *   校验1  id 齐全      —— 与《粒子对照-README.md》§1.2 行号索引逐一对照（26 + L1-L33 + H1-H5 = 64）
 *   校验2  字段齐       —— 每行七组字段都在（id/pt/kind/evidence/quarks/oracle/mutation/diff），
 *                          kind/oracle.kind 在枚举内，evidence 非空（可追溯性）
 *   校验6  无抢字段     —— quarks.writes 里同字段同 scope 的 "own" 写者唯一；
 *                          多写者字段必须在 plugin-api.FIELD_OWNERS 里声明共存；
 *                          声明 replaces 的行必须对应 FIELD_OWNERS 的共存条目
 *
 * 机制核对（校验 3/4/5：oracle 可复算 + mutation 注入变红）在 verify-quarks-mechanisms.ts。
 * 用法：`npx tsx scripts/verify-quarks-map.ts`
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { FIELD_OWNERS } from '../src/render/effects/plugin-api.js';

const here = dirname(fileURLToPath(import.meta.url));
const mapPath = resolve(here, '../src/render/effects/quarks-map.json');
const map = JSON.parse(readFileSync(mapPath, 'utf8')) as {
  meta: { kindEnum: string[]; oracleKindEnum: string[] };
  rows: Array<{
    id: string; vol: string; pt: string; kind: string;
    evidence: string[];
    quarks: { interface: string; attach?: string; state?: string; writes?: Array<{ field: string; mode: string; scope?: string; replaces?: string | null }>; replaces?: string | null };
    oracle: { kind: string; desc: string; check?: unknown };
    mutation: { machine?: string | null; desc: string };
    diff: string;
  }>;
};

let fails = 0;
const ok = (name: string, pass: boolean, detail = ''): void => {
  if (!pass) fails++;
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ── 期望行号索引（README §1.2；本表硬编码 = 对冻结索引的独立誊写，改动索引必须同步这里） ── */
const EXPECTED: string[] = [
  ...Array.from({ length: 26 }, (_, i) => String(i + 1)),
  ...Array.from({ length: 33 }, (_, i) => `L${i + 1}`),
  ...['H1', 'H2', 'H3', 'H4', 'H5'],
];

const rows = map.rows;
const byId = new Map(rows.map((r) => [r.id, r]));

console.log('校验1 id 齐全（对照 README §1.2：26 + L1-L33 + H1-H5 = 64 行）');
{
  const missing = EXPECTED.filter((id) => !byId.has(id));
  const extra = rows.map((r) => r.id).filter((id) => !EXPECTED.includes(id));
  const dup = rows.length !== byId.size;
  ok(`行数 = 64（实际 ${rows.length}）`, rows.length === 64);
  ok(`缺失 = 0${missing.length ? `（${missing.join(',')}）` : ''}`, missing.length === 0);
  ok(`多余 = 0${extra.length ? `（${extra.join(',')}）` : ''}`, extra.length === 0);
  ok(`无重复 id`, !dup);
}

console.log('校验2 字段齐（七组字段 + 枚举）');
{
  let bad = 0;
  for (const r of rows) {
    const probs: string[] = [];
    if (!r.id || !r.vol || !r.pt) probs.push('id/vol/pt 空');
    if (!map.meta.kindEnum.includes(r.kind)) probs.push(`kind=${r.kind} 不在枚举`);
    if (!Array.isArray(r.evidence) || r.evidence.length === 0) probs.push('evidence 空');
    if (!r.quarks || !r.quarks.interface) probs.push('quarks.interface 空');
    if (!r.oracle || !map.meta.oracleKindEnum.includes(r.oracle.kind)) probs.push(`oracle.kind=${r.oracle?.kind} 不在枚举`);
    if (!r.oracle?.desc) probs.push('oracle.desc 空');
    if (!r.mutation?.desc) probs.push('mutation.desc 空');
    if (typeof r.diff !== 'string' || r.diff.length === 0) probs.push('diff 空');
    if (r.oracle.kind === 'ref' && !r.oracle.check) probs.push('ref oracle 缺 check（机器执行数据）');
    if (probs.length) { fails++; bad++; console.log(`  ✗ ${r.id}: ${probs.join('；')}`); }
  }
  ok(`64 行字段齐${bad ? `（${bad} 行缺）` : ''}`, bad === 0);
}

console.log('校验6 无抢字段（一个字段一个写者，§G1）');
{
  const ownersOf = (field: string) => FIELD_OWNERS.find((f) => f.field === field);
  const ownWriters = new Map<string, Array<{ id: string; scope: string; replaces?: string | null }>>();
  for (const r of rows) {
    for (const w of r.quarks.writes ?? []) {
      if (w.mode !== 'own') continue;
      const key = `${w.field} :: ${w.scope ?? '(默认)'}`;
      if (!ownWriters.has(key)) ownWriters.set(key, []);
      ownWriters.get(key)!.push({ id: r.id, scope: w.scope ?? '(默认)', replaces: w.replaces ?? null });
    }
  }
  let clash = 0;
  for (const [key, list] of ownWriters) {
    if (list.length > 1) { fails++; clash++; console.log(`  ✗ 同字段同 scope 多写者：${key} → ${list.map((x) => x.id).join(',')}`); }
  }
  ok(`同字段同 scope 写者唯一`, clash === 0);

  // 多写者字段必须已在 FIELD_OWNERS 声明共存（否则就是"看着像不冲突"）
  const byField = new Map<string, Set<string>>();
  for (const [key, list] of ownWriters) {
    const field = key.split(' :: ')[0]!;
    if (!byField.has(field)) byField.set(field, new Set());
    for (const x of list) byField.get(field)!.add(x.id);
  }
  let undeclared = 0;
  for (const [field, ids] of byField) {
    const decl = ownersOf(field);
    if (ids.size > 1 && !decl?.coOwners) { fails++; undeclared++; console.log(`  ✗ 字段 ${field} 有 ${ids.size} 个 own 写者（${[...ids].join(',')}）但 FIELD_OWNERS 未声明共存`); }
  }
  ok(`多写者字段均声明共存`, undeclared === 0);

  // 声明 replaces 的行：必须对应 FIELD_OWNERS 的共存条目（替代关系显式化）
  let badReplace = 0;
  for (const r of rows) {
    for (const w of r.quarks.writes ?? []) {
      if (w.replaces && !ownersOf(w.field)?.coOwners) { fails++; badReplace++; console.log(`  ✗ ${r.id} 声明 replaces=${w.replaces} 但字段 ${w.field} 未在 FIELD_OWNERS 声明共存`); }
    }
  }
  ok(`replaces 声明均有共存条目`, badReplace === 0);
}

console.log(fails === 0
  ? `\n✓ verify-quarks-map 通过 —— 64 行结构与口径齐备（校验 1/2/6）`
  : `\n✗ ${fails} 条不符 —— 对照 docs/handoff/frozen/ 的冻结卷修数据，别改断言`);
process.exit(fails === 0 ? 0 : 1);
