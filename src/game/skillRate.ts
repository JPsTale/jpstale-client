/**
 * **技能动作速率** —— 唯一实现（AGENTS #15）。
 *
 * 原版机制：动作速度**只在 `FrameStep` 里**（帧号是纯函数，见 `docs/技能动画速度-原版机制.md` §A1）。
 * 每帧分派（`character.cpp:5715-5743`）：
 *   · `MotionLoop == 0` ⇒ `FrameStep = (80 * AttackSpeed) >> 8`（**普攻那条，随攻速**）
 *   · `MotionLoop != 0` ⇒ `FrameStep = MotionLoopSpeed`（**每个技能自己给的值**，`SkillSub.cpp`）
 * 两者都由**服务端**一起算（服务端也跑 `frame += FrameStep`）。
 *
 * 数据 = `data/skill-motion-speed.generated.json`（`npm run skill-motion-speed --write`），
 * 逐技能给出 `MotionLoopSpeed` 的**形态**与出处行号。
 *
 * 换算（基准本轮不动，`ANIM_FPS_BASE = 30`）：
 *   原版每秒推进 = `FrameStep × 70` 子帧 = `FrameStep × 70 / 160` 动作帧（引擎是 70Hz 逻辑帧、
 *   1 动作帧 = 160 子帧）；我们 `rate = 1` 时每秒 30 动作帧
 *   ⇒ **`rate = FrameStep / 68.5714`**（68.5714 = 4800/70）。
 *
 * ── 预留：服务端将来下发施法时长/冷却 ─────────────────────────────
 * 服务端把"这一招该播多久"作为事实下发时（`S2C_*` 里带 duration/cd），**本函数多一个分支**
 * （服务端时长优先、直接换算成 rate），**调用点不改** —— 因为调用点只认"给我这一招的 rate"。
 *
 * ⚠ **查不到 = null，不猜**（AGENTS #12）。调用方用 `?? 1` 时必须已上报降级。
 */
import RATE from './data/skill-motion-speed.generated.json';
import TABLES from './data/skill-tables.generated.json';
import { skillRowBySkillId } from './skillIdentity.js';
import { skillLevelByIcon } from './skillLevel.js';
import { reportFallback } from '../char/fallback-log.js';

/** 帧步进 → 播放速率倍率的分母（= 4800/70，推导见文件头） */
export const RATE_DIVISOR: number = (RATE as { rateDivisor: number }).rateDivisor;

type Kind = 'const' | 'gaf-const' | 'attack-speed' | 'skill-level' | 'loop-count' | 'other';
interface RateRow {
  job: number; classDir: string; icon: string; name: string;
  kind: Kind; value?: number; add?: number; base?: number; table?: string; mult?: number; per?: number;
  expr: string;
  sites: Array<{ scope: string; caseLine: number; assignLine: number; form: string; expr: string }>;
}

const ROWS = (RATE as { rows: RateRow[] }).rows;
const BY_ICON = new Map<string, RateRow>();
for (const r of ROWS) BY_ICON.set(r.icon.replace(/\.bmp$/i, '').toLowerCase(), r);

/** `GetAttackSpeedFrame(as, add)` 的帧步进（`playsub.cpp:6338-6356`；`fONE=256`/`FLOATNS=8`） */
function frameStepFromAttackSpeed(attackSpeed: number | null, add: number): number | null {
  if (attackSpeed == null) return null;      // 攻速未知 ⇒ 这一形态**算不出**（不拿别处的值顶上）
  const clamped = Math.max(0, Math.min(attackSpeed - 6, 6));
  const addBonus = add > 0 && add < 6 ? add * 32 : 0;
  return (80 * (256 + 32 * clamped + addBonus)) >> 8;
}

/** 该行的帧步进；`null` = 查不到/认不出的形态（**不猜**） */
function frameStepOf(row: RateRow, attackSpeed: number | null): number | null {
  switch (row.kind) {
    case 'const': return row.value ?? null;
    case 'gaf-const': return frameStepFromAttackSpeed(row.value ?? 0, 0);
    case 'attack-speed': return frameStepFromAttackSpeed(attackSpeed, row.add ?? 0);
    case 'skill-level': {
      // `60 + (Charging_Strike_Time[point-1] * 2)`：表在我们自己的生成物里（同一个来源），
      // 等级取当前技能等级（`skillLevelByIcon`，单一来源）
      const lv = skillLevelByIcon(row.icon);
      // 表在**我们自己的生成物**里（与源码同一份数据）；二维表（`int[10][2]`）不是本分支用的形状
      const arr = (TABLES as unknown as { arrays: Record<string, { values: number[] | number[][] }> })
        .arrays[row.table ?? ''];
      if (lv == null || !arr || Array.isArray(arr.values[0])) return null;   // 二维表不是本分支的形状
      const flat = arr.values as number[];
      return (row.base ?? 0) + (flat[lv - 1] ?? 0) * (row.mult ?? 1);
    }
    case 'loop-count': return row.base ?? null;   // `90 + 10*MotionLoop`：循环数我们尚未建模 ⇒ 只取基值
    default: return null;
  }
}

/**
 * 本招（按 `skillId`）此刻的动作速率倍率。
 *
 * @param attackSpeed 服务端下发的 `character.attackSpeed`（与 `smCharInfo.Attack_Speed` 同一量纲，
 *        见 `GetAttackSpeedMainFrame` 与我们的 `attackIntervalMs` 同式）；`null` = 还不知道
 * @returns `null` = 该招的速率**未取证**（源里没有这一行，如 11 职业才有的技能，或攻速未知）——
 *          调用方按 `?? 1` 处理**并必须已上报降级**，不许静默当成 1
 */
export function skillRate(skillId: number, attackSpeed: number | null): number | null {
  const identity = skillRowBySkillId(skillId);
  if (!identity) {
    reportFallback('skill.rate', `skillId=${skillId} 不在技能身份表里 ⇒ 速率未取证（按 1 播）`);
    return null;
  }
  const row = BY_ICON.get(identity.iconFile.replace(/\.bmp$/i, '').toLowerCase());
  if (!row || row.kind === 'other') {
    reportFallback('skill.rate', `「${identity.name}」（${identity.iconFile}）在 SkillSub 的 MotionLoopSpeed 里没有对应行 ⇒ 速率未取证（按 1 播）`);
    return null;
  }
  const step = frameStepOf(row, attackSpeed);
  if (step == null) {
    reportFallback('skill.rate', `「${identity.name}」的速率形态 ${row.kind}（${row.expr}）算不出帧步进 ⇒ 速率未取证（按 1 播）`);
    return null;
  }
  return Math.max(0.01, step / RATE_DIVISOR);
}

/**
 * 按**图标**取同一个速率（远端那条路手里只有图标 —— 它从服务端下发的动画条目反查）。
 * `null` 的含义同 `skillRate`。两条入口共用上面同一份实现与同一张表，不重复判定。
 */
export function skillRateByIcon(iconFile: string, attackSpeed: number | null): number | null {
  const row = BY_ICON.get(iconFile.replace(/\.bmp$/i, '').toLowerCase());
  if (!row || row.kind === 'other') {
    reportFallback('skill.rate', `「${iconFile}」在 SkillSub 的 MotionLoopSpeed 里没有对应行 ⇒ 速率未取证（按 1 播）`);
    return null;
  }
  const step = frameStepOf(row, attackSpeed);
  if (step == null) {
    reportFallback('skill.rate', `「${iconFile}」的速率形态 ${row.kind}（${row.expr}）算不出帧步进 ⇒ 速率未取证（按 1 播）`);
    return null;
  }
  return Math.max(0.01, step / RATE_DIVISOR);
}
