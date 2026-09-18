/**
 * **`.part` 源语覆盖率扫描** —— 用我们的解析器跑遍所有 `.part`，汇总**没被翻译的键**。
 *
 * 背景：`.part` 是原版**自研的一套源语**，解释器在 `HoBaram/HoNewParticle.cpp`
 * （tokenizer 里那张关键字表：`PARTICLESYSTEM / EVENTSEQUENCE / NUMPARTICLES / EMITRATE /
 * SOURCEBLENDMODE / DESTBLENDMODE / SPAWNDIR / PARTANGLEX..Z / LOCALANGLE..Z / REDCOLOR…
 * INLENGTH / OUTLENGTH / SIZEEXT / EVENTTIMER` …），而我们这边是
 * `core/effect/part-script.ts`（解析）→ `part-to-quarks.ts`（翻成 quarks 源语）→ `quarks-runtime`（执行）。
 *
 * 那个解析器只覆盖了源语的一部分，而**没被读到的键此前是静默丢弃**的
 * （`initial partAngleZ` 就这么丢了很久，表现为"粒子朝向全一样、看着不动"）。
 * 这个扫描把缺口量出来，让"哪些源语还没翻译"变成可见的数字（AGENTS #12）。
 *
 * **第三张表（"谁在用"）**：把每个 `.part` 反查到**怪物 / 技能**，好让分析能在实验室被肉眼核对
 * （用户 2026-09-18 要求："不要只做静态分析，要能挑一个样本去实验室看"）。数据链：
 *   · 怪 → 资产：`MONSTER_ATTACK_FX`（`render/effects/monster-attack-fx.ts`）
 *   · effectId → 怪名：`efria-studio/output/monsters-resolved.json`（可用 `PT_MONSTERS_JSON` 指定）
 *   · 技能 → `.part`：`src/game/data/skill-fx.json` 的 `part:` 引用
 *
 * 用法：`npx tsx scripts/scan-part-coverage.ts [资产根]`
 */
import fs from 'node:fs';
import path from 'node:path';
import { parsePart } from '../src/core/effect/part-script.js';

const ASSET = process.argv[2] ?? process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client';
/** `.part` 的两个来源（与 `part-assets.partScriptPaths` 一致） */
const ROOTS = ['effect/particle/script', 'game/scripts/particles'];

let files = 0;
let withUnhandled = 0;
/** 键 → { 次数, 例子 } */
const counter = new Map<string, { n: number; sample: string }>();
/** 键出现在多少个不同文件里（比"次数"更能说明覆盖面） */
const filesOf = new Map<string, Set<string>>();

for (const root of ROOTS) {
  const dir = path.join(ASSET, root);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.part')) continue;
    files++;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const sys = parsePart(text);
    const un = sys.unhandled ?? [];
    if (un.length > 0) withUnhandled++;
    for (const k of un) {
      const c = counter.get(k) ?? { n: 0, sample: `${root}/${f}` };
      c.n++;
      counter.set(k, c);
      (filesOf.get(k) ?? filesOf.set(k, new Set()).get(k)!).add(f);
    }
  }
}

const rows = [...counter.entries()]
  .map(([k, v]) => ({ key: k, uses: v.n, files: filesOf.get(k)!.size, sample: v.sample }))
  .sort((a, b) => b.files - a.files || b.uses - a.uses);

console.log(`扫描 ${files} 个 .part（资产根 ${ASSET}）`);
console.log(`其中 ${withUnhandled} 个文件含**未被翻译**的键；不同键 ${rows.length} 个：\n`);
console.log('  文件数  出现次数  键                                        例子');
for (const r of rows) {
  console.log(`  ${String(r.files).padStart(5)}  ${String(r.uses).padStart(7)}  ${r.key.padEnd(40)} ${r.sample}`);
}
if (rows.length === 0) console.log('  （无 —— 全部键都被翻译）');

// ── 第二张表：**时间轴属性**（`fade so at <t> <prop>`）── 解析器收得到，但转换器只应用了一部分
//
// ⚠ 这里的"已应用"清单必须与 `part-to-quarks.ts` 里的 `numKfOf/kfOf` 调用一致
//   （运行时还有一道兜底：`part-assets.loadPartFromSystem` 会把未应用的轨道走 `reportFallback` 报出来）
// 已应用清单**只有一份**（导出自 `part-to-quarks.ts`）；这里直接用，别再抄
const { APPLIED_KEYFRAME_PROPS } = await import('../src/render/effects/part-to-quarks.js');
const APPLIED = new Set<string>(APPLIED_KEYFRAME_PROPS);
const props = new Map<string, { uses: number; files: Set<string> }>();
for (const root of ROOTS) {
  const dir = path.join(ASSET, root);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.part')) continue;
    const sys = parsePart(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const em of sys.emitters) {
      for (const p of Object.keys(em.keyframes ?? {})) {
        const e = props.get(p) ?? { uses: 0, files: new Set<string>() };
        e.uses++;
        e.files.add(f);
        props.set(p, e);
      }
    }
  }
}
const propsSorted = [...props.entries()].sort((a, b) => b[1].files.size - a[1].files.size);
console.log(`\n时间轴属性（\`fade so at <t> <属性>\`）共 ${propsSorted.length} 种：\n`);
console.log('  文件数  出现次数  属性                   转换器已应用？');
for (const [p, e] of propsSorted) {
  console.log(`  ${String(e.files.size).padStart(5)}  ${String(e.uses).padStart(7)}  ${p.padEnd(20)} ${APPLIED.has(p) ? '✓' : '✗ **未应用**'}`);
}

// ── 第三张表：**谁在用**（把 `.part` 反查到怪物 / 技能，好在实验室肉眼核对）──
//
// 用户 2026-09-18："多少应该采集一两个粒子样本，并找到是哪些怪物或技能在用，
// 这样我就可以配合你的分析去实验室肉眼评估，而不是你一个人单纯做静态分析。"
const MONSTERS_JSON = process.env.PT_MONSTERS_JSON
  ?? 'E:/JPsTale/efria/efria-studio/output/monsters-resolved.json';
/** partFile（小写、无扩展名）→ 使用者标签 */
const users = new Map<string, string[]>();
const addUser = (partName: string, label: string): void => {
  const key = partName.replace(/\\/g, '/').split('/').pop()!.replace(/\.part$/i, '').toLowerCase();
  const list = users.get(key) ?? [];
  if (!list.includes(label)) list.push(label);
  users.set(key, list);
};
const hasPart = (name: string): boolean =>
  ROOTS.some((r) => fs.existsSync(path.join(ASSET, r, `${name.replace(/\.part$/i, '').toLowerCase()}.part`)));

// ① 怪 → 资产：`MONSTER_ATTACK_FX` 里的 asset / fly.systems / fly.hit
const { MONSTER_ATTACK_FX } = await import('../src/render/effects/monster-attack-fx.js');
let monsterNames: Record<string, string> = {};
try {
  const mj = JSON.parse(fs.readFileSync(MONSTERS_JSON, 'utf8')) as { resolved?: Array<{ id: string; name: string; valueHex: string }> };
  for (const r of mj.resolved ?? []) monsterNames[String(parseInt(r.valueHex, 16))] = r.name;
} catch { /* 怪物表不在 ⇒ 只报 effectId（不编名字） */ }

const addFxUsers = (effectId: number, asset: string | string[] | undefined): void => {
  const who = monsterNames[String(effectId)] ?? '?';
  for (const a of (Array.isArray(asset) ? asset : asset ? [asset] : [])) {
    if (a.startsWith('code:')) continue;
    if (hasPart(a)) addUser(a, `怪 #0x${effectId.toString(16).toUpperCase()} ${who}`);
  }
};
for (const [k, entry] of Object.entries(MONSTER_ATTACK_FX)) {
  const id = Number(k);
  if ('skillByKeyCode' in entry) {
    for (const sub of Object.values(entry.skillByKeyCode)) {
      addFxUsers(id, sub.asset);
      for (const s of sub.fly?.systems ?? []) addUser(s.asset, `怪 #0x${id.toString(16).toUpperCase()} ${monsterNames[String(id)] ?? '?'}（飞出物附加）`);
      if (sub.fly?.hit?.asset) addUser(sub.fly.hit.asset, `怪 #0x${id.toString(16).toUpperCase()} ${monsterNames[String(id)] ?? '?'}（命中）`);
    }
  } else {
    addFxUsers(id, entry.asset);
    for (const s of entry.fly?.systems ?? []) addUser(s.asset, `怪 #0x${id.toString(16).toUpperCase()} ${monsterNames[String(id)] ?? '?'}（飞出物附加）`);
  }
}
// ② 技能 → `.part`：`skill-fx.json` 的 `part:` 引用
try {
  const sfx = JSON.parse(fs.readFileSync('src/game/data/skill-fx.json', 'utf8')) as {
    rows: Array<{ name: string; classDir: string; fx?: string[]; event?: { fx?: string[] } }>;
  };
  for (const r of sfx.rows) {
    for (const ref of [...(r.fx ?? []), ...(r.event?.fx ?? [])]) {
      if (!ref.startsWith('part:')) continue;
      addUser(ref.slice(5), `技能 ${r.name}（${r.classDir}）`);
    }
  }
} catch { /* 技能表读不到就跳过 */ }

console.log('\n三类"使用者"反查（怪 / 技能）：');
console.log(`  已知使用者关系的 .part：${users.size} 个`);
const withUsers = propsSorted.filter(([p]) => !APPLIED.has(p));
for (const [p] of withUsers.slice(0, 6)) {
  const hit = filesOf.get(p) ? [...filesOf.get(p)!] : [];
  console.log(`\n  **未应用属性「${p}」** —— 用到它的文件里，能反查到使用者的：`);
  let shown = 0;
  for (const f of hit) {
    const u = users.get(f.replace(/\.part$/i, '').toLowerCase());
    if (!u) continue;
    console.log(`    ${f.padEnd(34)} ${u.slice(0, 3).join(' / ')}`);
    if (++shown >= 4) break;
  }
  if (shown === 0) console.log('    （这一批里没有反查到怪/技能 —— 可能来自 AssaParticle 等未登记路径）');
}


