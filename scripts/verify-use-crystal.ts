/**
 * 客户端「右键要发请求」的水晶集合，必须与服务端的分派表**逐一相等**（`npm run verify-use-crystal`）。
 *
 * 为什么需要：这条判据天生有两半、且**无法合并** ——
 *   服务端要知道"用哪颗水晶召哪只怪"（`CrystalService` 的分派表），
 *   客户端要知道"右键要不要发这次请求"（`ItemPanel.onUseBag` **只对** `useWithoutAnimation`
 *   为真的物品发 `C2S_UseItem`）。
 *
 * 两半漂开的症状是**静默**的：客户端多发 → 服务端回 `chat.cmd.useItemUnsupported`（至少可见）；
 * 客户端少发 → **右键毫无反应、连服务端日志都没有** —— 这正是 `useWithoutAnimation` 当初存在的
 * 理由（见它的注释：`requestPlayEat(null)` 恒为 false 把请求吞掉）。所以本脚本直接读**服务端的
 * `CrystalService.java`** 来比对，而不是两边各存一份名单再互相打勾。
 *
 * 做四件事（都只读，失败即非零退出）：
 *   ① 服务端分派表里的水晶码集合（含 `MYSTIC_CRYSTAL` 常量解析）= 客户端 `SUPPORTED_CRYSTALS`；
 *   ② `useWithoutAnimation()` 对每一颗**真的返回 true**（不是只看数组）；
 *   ③ 未列入的水晶（GP117 等）在两边都**不算支持**（防止一边偷偷放宽）；
 *   ④ `item.op.crystal.*` 的文案在 zh/en 两份语言表里都存在且 key 相同。
 *
 * 服务端仓库位置：默认 `<客户端仓库>/../jpstale-server`，可用 `PT_SERVER_ROOT` 覆盖；
 * 找不到时**报告跳过并退出 0**（不假装通过）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SUPPORTED_CRYSTALS, isSummonCrystal, useWithoutAnimation } from '../src/game/useEffect.js';

const SERVER = process.env.PT_SERVER_ROOT ?? resolve('..', 'jpstale-server');
const CRYSTAL_JAVA = resolve(
  SERVER, 'modules/common-service/src/main/java/org/jpstale/common/service/item/CrystalService.java');

if (!existsSync(CRYSTAL_JAVA)) {
  console.log(`[use-crystal] 跳过：找不到 ${CRYSTAL_JAVA}（设 PT_SERVER_ROOT 指向服务端仓库）`);
  process.exit(0);
}

const problems: string[] = [];
const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;

// ---------- ① 服务端：解析分派表 ----------
const java = readFileSync(CRYSTAL_JAVA, 'utf8');

/** `static final int NAME = 0x...` 形式的常量（`MYSTIC_CRYSTAL` 就在里面） */
const consts = new Map<string, number>();
for (const m of java.matchAll(/static\s+final\s+int\s+([A-Z_][A-Z0-9_]*)\s*=\s*0x([0-9A-Fa-f]+)/g)) {
  consts.set(m[1], parseInt(m[2], 16));
}

// 取 `CRYSTALS = List.of(` 的表体：用**括号配平**而不是正则去找结尾 ——
// 表体里嵌着别的 `List.of(...)`（池）与字符串，正则很容易在错的地方收尾。
const startMarker = 'CRYSTALS = List.of(';
const startIdx = java.indexOf(startMarker);
if (startIdx < 0) {
  console.error('[use-crystal] 解析失败：在 CrystalService.java 里找不到 `CRYSTALS = List.of(`');
  process.exit(1);
}
let depth = 0;
let endIdx = -1;
for (let i = startIdx + startMarker.length - 1; i < java.length; i++) {
  const ch = java[i];
  if (ch === '(') depth++;
  else if (ch === ')') {
    depth--;
    if (depth === 0) {
      endIdx = i;
      break;
    }
  }
}
if (endIdx < 0) {
  console.error('[use-crystal] 解析失败：CRYSTALS 的括号没有配平');
  process.exit(1);
}
const block = java.slice(startIdx, endIdx);

const serverCodes = new Set<number>();
for (const m of block.matchAll(/CrystalDef\.fixed\(\s*0x([0-9A-Fa-f]+)/g)) {
  serverCodes.add(parseInt(m[1], 16));
}
for (const m of block.matchAll(/new\s+CrystalDef\(\s*([A-Z_][A-Z0-9_]*)\s*,/g)) {
  const v = consts.get(m[1]);
  if (v == null) {
    problems.push(`服务端表里用了常量 ${m[1]}，但在 CrystalService.java 里找不到它的定义`);
    continue;
  }
  serverCodes.add(v);
}
if (serverCodes.size === 0) {
  problems.push('服务端分派表解析出 0 条 —— 正则与文件结构已经对不上，请更新本脚本');
}

// ---------- ② 客户端：集合 + 行为 ----------
const clientCodes = new Set(SUPPORTED_CRYSTALS);
for (const c of clientCodes) {
  if (!serverCodes.has(c)) problems.push(`客户端多出 ${hex(c)}（服务端表里没有）→ 右键会发请求但服务端回"不支持"`);
}
for (const c of serverCodes) {
  if (!clientCodes.has(c)) problems.push(`客户端少了 ${hex(c)}（服务端表里有）→ **右键毫无反应**，且服务端日志里看不到任何东西`);
}
for (const c of clientCodes) {
  if (!isSummonCrystal(c)) problems.push(`${hex(c)} 在 SUPPORTED_CRYSTALS 里，但 isSummonCrystal() 返回 false`);
  if (!useWithoutAnimation(c)) problems.push(`${hex(c)} 是支持的水晶，但 useWithoutAnimation() 返回 false → ItemPanel 不会发请求`);
}

// ---------- ③ 反向：不该放行的不要放行 ----------
const NOT_SUPPORTED: Array<[number, string]> = [
  [0x08021100, 'GP117（事件档水晶，本期未实现）'],
  [0x08021700, 'GP120（billing 档）'],
  [0x08022000, 'GP121（Marvel 档）'],
  [0x08020E00, 'GP114（城堡兵）'],
  [0x080D0100, 'GP201（灵魂石）'],
];
for (const [code, why] of NOT_SUPPORTED) {
  if (isSummonCrystal(code)) problems.push(`${why} ${hex(code)} 不该被当成已实现的水晶`);
  if (useWithoutAnimation(code)) problems.push(`${why} ${hex(code)} 不该走"不发请求"的白名单路径`);
}
// 其它家族的既有判据不能被这次改动带坏
if (!useWithoutAnimation(0x03060100)) problems.push('力量石 0x03060100 应仍然走"不发请求"路径（本脚本的同族回归）');
if (useWithoutAnimation(0x04020100)) problems.push('药水 0x04020100 不该走"不发请求"路径（它要播 EAT）');

// ---------- ④ 文案 ----------
const KEYS = ['level', 'town', 'noTemplate'];
const tables = { zh: 'src/locales/zh.json', en: 'src/locales/en.json' };
for (const [lang, path] of Object.entries(tables)) {
  const json = JSON.parse(readFileSync(resolve(path), 'utf8')) as {
    item?: { op?: { crystal?: Record<string, string> } };
  };
  const crystal = json.item?.op?.crystal;
  if (!crystal) {
    problems.push(`${path} 缺少 item.op.crystal.* 文案`);
    continue;
  }
  for (const k of KEYS) {
    if (!crystal[k]) problems.push(`${path} 缺少 item.op.crystal.${k}`);
  }
  for (const k of Object.keys(crystal)) {
    if (!KEYS.includes(k)) problems.push(`${path} 多出 item.op.crystal.${k}（服务端没有这个 key）`);
  }
}

// ---------- 结论 ----------
const list = [...serverCodes].sort((a, b) => a - b).map(hex).join(' ');
if (problems.length > 0) {
  console.error('[use-crystal] ✗ 不通过：\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(`[use-crystal] ✓ 通过：两边一致，共 ${serverCodes.size} 颗水晶\n  ${list}\n  文案 item.op.crystal.{${KEYS.join(',')}} 在 zh/en 都在`);
