/**
 * 特效资产**名字核对**（离线）—— 把"代码/数据里引用的资产名"逐个在清单里解一遍。
 *
 * 为什么需要它：清单（`effect-names.generated.json`）把运行时的"探测文件系统"换成了"同步查表"，
 * 于是**名字写错**不再表现为一次可见的 404，而会变成"不在清单里 ⇒ 不放"。
 * 这个脚本把全部引用点离线解一遍 —— 拼错名字、写错家族、清单过期（资产加减后忘了重跑）三件事一次看全。
 *
 * 检查四处：
 *   ① `MONSTER_ATTACK_FX`（怪物普攻/技能特效表）：`asset`（数组则逐个）、`parts[].asset`、
 *      `onUnitsInRange.asset`、`fly.systems[].asset`、`fly.hit.asset`
 *      —— 有 `code` 的条目里 `asset` 只是**显示名**，跳过（见字段说明）
 *   ② `src/game/data/skill-fx.json` 的 `fx` 条目（形如 `ini:skillspiritimpact1`）—— **家族也要对得上**
 *   ③ 代码里的字面量调用：`effects.spawn('X')` / `fx.spawn('X')` / `spawnStoppable('X')` /
 *      `loadEffectByName('X')` / `loadPartByName('X')`
 *   ④ `mesh.path`（ASE/SMD 网格，如 `effect/assaeffect/chaoskara/chao_glacial.smd`）——
 *      它不走名字清单，按**文件在不在**查
 * 不看：`sound` / `castSound`（wav 路径，归 sfx 那条链）。
 *
 * 用法：`npx tsx scripts/verify-fx-names.ts [资产根]`（默认 `PT_ASSET_ROOT` 或 `E:/JPsTale/client`）
 */
import fs from 'node:fs';
import path from 'node:path';
import { lookupEffect, effectCounts } from '../src/render/effects/effect-names.js';
import { MONSTER_ATTACK_FX, isSkillSet, type MonsterAttackFxDef } from '../src/render/effects/monster-attack-fx.js';

const ASSET = path.resolve(process.argv[2] ?? process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client');

interface Ref { where: string; name: string; want?: 'ini' | 'part' | 'lua' | 'luac' }
interface Miss { where: string; name: string; why: string }

const refs: Ref[] = [];
const meshes: Array<{ where: string; p: string }> = [];

/* ① 怪物特效表 */
function collectDef(where: string, def: MonsterAttackFxDef): void {
  // `asset` 是"可播资产"**除了**走代码内 spec 的条目（`code` / `sparks`）—— 那两种情况下
  // `asset` 只是显示名（如 `#0x1960 'O'` 的 `MultiSpark` = `multi-spark.ts` 那份 spec）。
  // 这条与 `fireDef` 的分支顺序一致：`code`/`sparks` 两支持在用到 `asset` 之前就返回了。
  if (!def.code && !def.sparks) {
    for (const a of Array.isArray(def.asset) ? def.asset : [def.asset]) refs.push({ where, name: a });
  }
  for (const p of def.parts ?? []) refs.push({ where: `${where} parts[]`, name: p.asset });
  if (def.onUnitsInRange) refs.push({ where: `${where} onUnitsInRange`, name: def.onUnitsInRange.asset });
  for (const s of def.fly?.systems ?? []) refs.push({ where: `${where} fly.systems[]`, name: s.asset });
  if (def.fly?.hit?.asset) refs.push({ where: `${where} fly.hit`, name: def.fly.hit.asset });
  if (def.mesh) meshes.push({ where: `${where} mesh`, p: def.mesh.path });
}

for (const [idStr, entry] of Object.entries(MONSTER_ATTACK_FX)) {
  const id = Number(idStr);
  const tag = `#0x${id.toString(16).toUpperCase()}`;
  if (isSkillSet(entry)) {
    if (entry.attack) collectDef(`${tag} 普攻`, entry.attack);
    for (const [key, sub] of Object.entries(entry.skillByKeyCode)) {
      collectDef(`${tag} 技能'${key === '' ? '(else)' : key}'`, sub);
    }
  } else {
    collectDef(`${tag} 普攻`, entry);
  }
}

/* ② 技能表现清单 */
const skillFxPath = path.resolve('src/game/data/skill-fx.json');
if (fs.existsSync(skillFxPath)) {
  const data = JSON.parse(fs.readFileSync(skillFxPath, 'utf8')) as {
    rows: Array<{ job: number; name: string; fx: string[] }>;
  };
  for (const row of data.rows) {
    for (const fx of row.fx ?? []) {
      const m = /^(ini|part|lua|luac):(.+)$/.exec(fx);
      if (!m) { refs.push({ where: `skill-fx「${row.name}」`, name: fx }); continue; }
      refs.push({ where: `skill-fx「${row.name}」`, name: m[2]!, want: m[1] as Ref['want'] });
    }
  }
}

/* ③ 代码里的字面量调用 */
const SRC_ROOTS = ['src', path.resolve('../efria/efria-studio/src')];
const LITERAL_RES: Array<{ re: RegExp; label: string }> = [
  { re: /\b(?:effects|fx)\.spawn\(\s*'([^']+)'/g, label: 'spawn' },
  { re: /\b(?:effects|fx)\.spawnStoppable\(\s*'([^']+)'/g, label: 'spawnStoppable' },
  { re: /\bloadEffectByName\(\s*'([^']+)'/g, label: 'loadEffectByName' },
  { re: /\bloadPartByName\(\s*'([^']+)'/g, label: 'loadPartByName' },
];
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'dist') out.push(...walk(p)); }
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}
let scannedFiles = 0;
for (const root of SRC_ROOTS) {
  for (const file of walk(root)) {
    scannedFiles++;
    const text = fs.readFileSync(file, 'utf8');
    for (const { re, label } of LITERAL_RES) {
      for (const m of text.matchAll(re)) {
        refs.push({ where: `${path.relative(process.cwd(), file).replace(/\\/g, '/')} ${label}()`, name: m[1]! });
      }
    }
  }
}

/* ─────────── 判定 ─────────── */
const misses: Miss[] = [];
for (const r of refs) {
  const entry = lookupEffect(r.name);
  if (!entry) {
    misses.push({ where: r.where, name: r.name, why: '清单里没有这个名字（拼错？还是资产增减后忘了重跑 npm run fx-names）' });
    continue;
  }
  if (r.want && entry.family !== r.want) {
    misses.push({ where: r.where, name: r.name, why: `清单里它是 **${entry.family}**，而引用处写的是 ${r.want}（${entry.path}）` });
  }
}
for (const m of meshes) {
  if (!fs.existsSync(path.join(ASSET, m.p))) {
    misses.push({ where: m.where, name: m.p, why: `网格文件不在资产根下（${ASSET}）` });
  }
}

const counts = effectCounts();
console.log(`资产根 ${ASSET}`);
console.log(`清单：${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join('、')}`
  + `；扫了 ${scannedFiles} 个源文件`);
console.log(`引用点：特效名 ${refs.length} 条、网格 ${meshes.length} 条`);
if (misses.length === 0) {
  console.log('✓ 全部可解 —— 运行时的"不在清单里"不会因为拼写或清单过期而发生');
  process.exit(0);
}
console.error(`\n✗ ${misses.length} 条解不开：`);
for (const m of misses) console.error(`   ${m.where}  →  ${m.name}\n      ${m.why}`);
process.exit(1);
