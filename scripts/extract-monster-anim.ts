/**
 * 怪物**动画条目表** → `monster-anim.json`（给**服务端**用）。
 *
 * ── 为什么服务端要持有这个（用户 2026-09-16 定）
 * 目标架构见 `docs/chars/语义化动画系统.md` / `docs/chars/动画同步.md`：
 *   **服务端持有动画数据 → 自己选变体 → 把"变体 ID（`.inx` 条目索引）"同步给所有客户端**；
 *   客户端只负责"拿到 ID 后用本地 `.smb` 播出来"。
 *
 * 玩家那条链已经是这么走的（`C2S/S2C_PlayerMove.anim_index`，谁播的谁上报）。怪物**没有上报者**
 * （它的动画是各客户端自己选的），当前只能用 `deriveAnimSeed(monsterId, state)` 各端确定性派生
 * —— 那是 `动画同步.md` §3 明写的**过渡方案**，终局就是本表：服务端从表里选一条、下发索引。
 *
 * 顺带解决"服务端怎么知道怪在攻击状态要站多久"：
 *   服务端**知道选中条目的帧区间** ⇒ 时长 = `(end - start) × 160 ÷ 播放步进 ÷ 60` 秒（精确），
 *   不必再对多条取 max 猜一个上界。
 *
 * ── 导出什么
 *   每个模型 × 每个状态 → **条目数组**：`{ index, start, end, repeat }`
 *     · `index` = `.inx` 条目序号（`MotionInfo.index`）—— **跨端播放的唯一依据**，客户端拿它
 *       `playMotion(该条目)`，与玩家 `anim_index` 同一语义；
 *     · `start` / `end` = `.inx` 里的**原始帧号**（`fps` 见顶层；客户端本地 `.smb` 自己套
 *       `tmFrame` 偏移，服务端不需要）；
 *     · `repeat` = 是否循环（服务端判"要不要等它播完"）。
 *   键与服务端 `MonsterSpawnService.normalizeModelPath` 的产物同形（小写、正斜杠、`.inx` 结尾）。
 *
 * ── 实测（555 个 `.inx`，543 个有可识别状态）
 *   ATTACK 455 个模型 / 643 条（169 个模型有多条变体）；SKILL 覆盖 280 个模型。
 *   ATTACK 帧数 min 20 / 中位 40 / max 122 ⇒ 0.67~4.07 秒（30fps）。
 *
 * 用法：npx tsx scripts/extract-monster-anim.ts   （npm run monster-anim）
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { parseInx } from '../src/core/char-parser.js';

const ASSET_ROOT = resolve(process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client');
/** 服务端 resources（相对本仓库；服务器上 src/jpstale-server 与 src/jpstale-client 并列） */
const OUT = resolve('../jpstale-server/pt-game-server/src/main/resources/monster-anim.json');
const MONSTER_DIR = join(ASSET_ROOT, 'char/monster');
const FPS = 30;

/**
 * 只导出**服务端会用到**的状态（与 `char-format.ts` 的 `CHRMOTION_STATE` 同值）。
 * 键用可读名字 —— 服务端按名字查，避免两边各自维护一份十六进制表。
 */
const STATES: Array<[number, string]> = [
  [0x40, 'stand'],
  [0x50, 'walk'],
  [0x60, 'run'],
  [0x70, 'sprint'],
  [0x80, 'falldown'],
  [0x100, 'attack'],
  [0x110, 'damage'],
  [0x120, 'dead'],
  [0x140, 'eat'],
  [0x150, 'skill'],
  [0x170, 'fallstand'],
  [0x180, 'falldamage'],
  [0x200, 'restart'],
  [0x210, 'warp'],
  [0x220, 'yahoo'],
  [0x230, 'taunt'],
];
const STATE_NAME = new Map(STATES);

interface Entry { index: number; start: number; end: number; repeat: number }

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.toLowerCase().endsWith('.inx')) out.push(p);
  }
  return out;
}

if (!existsSync(MONSTER_DIR)) {
  console.error(`找不到怪物资产目录：${MONSTER_DIR}（设 PT_ASSET_ROOT 指向资产根）`);
  process.exit(1);
}

const files = walk(MONSTER_DIR);
const models: Record<string, Record<string, Entry[]>> = {};
let parseFailed = 0;
let skippedNoState = 0;
let skippedInvalid = 0;

for (const f of files) {
  let inx;
  try {
    const b = readFileSync(f);
    inx = parseInx(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  } catch {
    parseFailed++;
    continue;
  }
  const byState: Record<string, Entry[]> = {};
  for (let i = 0; i < inx.motionCount; i++) {
    const m = inx.motions[i];
    if (!m) continue;
    const name = STATE_NAME.get(m.state);
    if (!name) continue;
    // ⚠ `char-parser` 用 `getUint32` 读帧号 ⇒ **负帧号会变成 0xFFFFFFxx 这种巨大无符号数**
    // （实测 `sakura.inx` 的 dead 条目 `end = 4294967288 = 0xFFFFFFF8 = -8`）。
    // 这种条目是"未使用的槽位"，必须在这里剔掉 —— 否则服务端的 `int` 装不下、整个表加载失败
    // （2026-09-16 实测：`Numeric value (4294967288) out of range of int` → Server tick error）。
    const start = m.startFrame | 0;   // uint32 → int32（负数即无效）
    const end = m.endFrame | 0;
    if (start < 0 || end < 0 || end <= start) {
      skippedInvalid++;
      continue;
    }
    (byState[name] ??= []).push({
      index: i,
      start,
      end,
      repeat: m.repeat ? 1 : 0,
    });
  }
  if (Object.keys(byState).length === 0) {
    skippedNoState++;
    continue;
  }
  const key = f.slice(ASSET_ROOT.length + 1).replace(/\\/g, '/').toLowerCase();
  models[key] = byState;
}

const keys = Object.keys(models);
if (keys.length === 0) {
  console.error('一个状态条目都没统计到 —— 资产根或目录结构不对，不写文件');
  process.exit(1);
}

const dir = resolve(OUT, '..');
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
writeFileSync(OUT, JSON.stringify({
  note: '怪物动画条目表（由 scripts/extract-monster-anim.ts 统计 .inx 生成）。'
    + '服务端据此**自己选变体**并把条目索引下发给客户端（与玩家 anim_index 同一语义），'
    + '同时用它算"进入某状态后要站多久"（帧数 × 160 ÷ 播放步进 ÷ 60 秒）。'
    + 'index = .inx 条目序号；start/end = .inx 原始帧号（客户端本地 .smb 自己套 tmFrame 偏移）。',
  fps: FPS,
  source: `assets:${MONSTER_DIR}`,
  count: keys.length,
  models,
}, null, 1) + '\n');

// 摘要
const attacks: number[] = [];
for (const k of keys) for (const e of models[k]!.attack ?? []) attacks.push(e.end - e.start);
attacks.sort((a, b) => a - b);
const pct = (p: number) => attacks[Math.min(attacks.length - 1, Math.floor(attacks.length * p))]!;
const nModelsWithAttack = keys.filter((k) => (models[k]!.attack ?? []).length > 0).length;
console.log(`[monster-anim] ${files.length} 个 .inx → ${keys.length} 个有可识别状态`
  + (skippedNoState ? `（${skippedNoState} 个没有任何已知状态）` : '')
  + (parseFailed ? `（${parseFailed} 个解析失败）` : '')
  + (skippedInvalid ? `（剔除 ${skippedInvalid} 条无效条目：负帧号/空区间）` : ''));
if (attacks.length) {
  console.log(`  ATTACK：${nModelsWithAttack} 个模型 / ${attacks.length} 条条目`
    + `，帧数 min=${attacks[0]} 中位=${pct(0.5)} max=${attacks[attacks.length - 1]}`
    + `  ⇒ 秒 ${(attacks[0]! / FPS).toFixed(2)}~${(attacks[attacks.length - 1]! / FPS).toFixed(2)}`);
}
console.log(`  → ${OUT}`);
