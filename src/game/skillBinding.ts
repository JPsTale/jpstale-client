/**
 * 技能绑定（拳位 / F1~F8）在客户端侧的**唯一解释处**（AGENTS #15：判定只写一份）。
 *
 * 真值 = **服务端** `S2C_SkillBindings`（`gameStore.skillBindings`，按角色存在 `characterinfo.props`）；
 * 本模块只管"拿到这张表以后，某个拳位/某个 F 键**该怎么理解**"，三处共用：
 *   · `ui/Hud.ts` 画主 HUD 中央那两个拳位图标；
 *   · `ui/WorldView.ts` 判"这一击用哪个技能（还是普通攻击）"；
 *   · `ui/react/SkillPanel.tsx` 画绑定角标、录 F 键。
 *
 * **值 = 数字 `skillId`，`0` = 未绑**；图标/职业由 `skillRowBySkillId` 反查（单一定义）。
 * 早先绑定身份是 `{classDir, iconFile}` 且存在全局 localStorage —— 那正是"换个角色看到的还是
 * 上一个角色的绑定、HUD 画出别职业的技能图标"的来源，2026-09-24 已删。
 *
 * ⚠ 本模块**零兜底**（AGENTS #12）：查不到身份、异职业、表还没到，一律给**显式的"没有/未知"**，
 * 绝不换一个值顶上（不换成默认图标、不换成普通攻击、不换成别的技能）。
 */
import type { SkillBindings } from '../app/gameStore.js';
import { CLASS_DIR } from './skillData.js';
import { skillRowBySkillId, type SkillIdentityRow } from './skillIdentity.js';
import { reportFallback } from '../char/fallback-log.js';

/** `C2S_SetSkillBinding.kind`：拳位。 */
export const BIND_KIND_FIST = 1;
/** `C2S_SetSkillBinding.kind`：快捷栏（F1~F8）。 */
export const BIND_KIND_QUICK = 2;

/** 拳位的 `index`（**协议编码**：1=左 / 2=右；与 props 键里的 `left`/`right` 是两套写法）。 */
export const FIST_INDEX = { left: 1, right: 2 } as const;

/** `skill_id` 0 = 未绑（拳位 0 = 普通攻击拳；F 键 0 = 该键没绑东西）。 */
export const UNBOUND = 0;

/** F1~F8 的槽数（= 服务端 `PlayerKey.QUICK_BIND_COUNT`）。 */
export const QUICK_SLOT_COUNT = 8;

export type FistSlot = 'left' | 'right';

/**
 * 某个拳位此刻的**意图** —— 施法与 HUD 共读的唯一判定。
 *
 * - `unknown`：`S2C_SkillBindings` 还没到（**显式未知**：不画、不放、并上报）
 * - `normal`：该拳位**未绑**（0）⇒ 普通攻击。**这是原版规格**：`lpAttackSkill = 0` 时那一击就是普通攻击
 *   （村庄里被清成 0 见 `playmain.cpp:2316-2317`；"恢复普攻"也是面板上的显式操作）
 * - `skill`：绑了本角色的技能，`row` 是身份行（图标/职业/animation 由它反查）
 * - `invalid`：**绑了、但这个 id 不属于本角色那 20 行**（异职业/查不到）——
 *   ⚠ 不能当成 `normal`（那就成了"把异职业绑定当没绑定，再退化普攻"，AGENTS #12 明令禁止）
 */
export type FistIntent =
  | { kind: 'unknown' }
  | { kind: 'normal' }
  | { kind: 'skill'; skillId: number; row: SkillIdentityRow }
  | { kind: 'invalid'; skillId: number };

/** 通过校验的显式 0（未绑）—— 用常量名代替裸 0，读起来才知道那是"没有绑定"而不是"某个技能"。 */
export const isUnbound = (skillId: number): boolean => skillId === UNBOUND;

/** 某只拳的 skillId（表没到 ⇒ null，**不是 0**：0 是"明确未绑"）。 */
export function fistSkillIdOf(bindings: SkillBindings | null, slot: FistSlot): number | null {
  if (bindings == null) return null;
  return slot === 'left' ? bindings.fistLeft : bindings.fistRight;
}

/**
 * 该 id 在当前角色身上对应的技能身份行；**不属于本角色 ⇒ null**（并上报）。
 *
 * @param job     当前角色职业号（服务端 `S2C_CharacterStatus.job`）；`null` = 还不知道 = 显式未知
 * @param what    上报文案里那句"这是从哪问的"（拳位/F 键），便于定位
 */
export function boundRowOf(job: number | null, skillId: number, what: string): SkillIdentityRow | null {
  if (job == null) {
    reportFallback('skill.bind.job', `${what}：角色职业未知（S2C_CharacterStatus 未到）⇒ 不解析该绑定`);
    return null;
  }
  const selfClass = CLASS_DIR[job];
  if (!selfClass) {
    reportFallback('skill.bind.job', `${what}：职业号 ${job} 没有对应目录（1..11 之外）⇒ 不解析该绑定`);
    return null;
  }
  const row = skillRowBySkillId(skillId);
  if (!row) {
    reportFallback('skill.bind.identity', `${what}：skillId 0x${skillId.toString(16)} 不在技能身份表里`);
    return null;
  }
  if (row.classDir !== selfClass) {
    reportFallback('skill.bind.foreign',
      `${what}：skillId 0x${skillId.toString(16)} 是 ${row.classDir} 的技能，本角色是 ${selfClass} ⇒ 不解析`);
    return null;
  }
  return row;
}

/** 拳位的意图（施法链与 HUD 的唯一判定）。 */
export function fistIntentOf(bindings: SkillBindings | null, job: number | null,
                             slot: FistSlot): FistIntent {
  const skillId = fistSkillIdOf(bindings, slot);
  if (skillId == null) return { kind: 'unknown' };
  if (isUnbound(skillId)) return { kind: 'normal' };
  const row = boundRowOf(job, skillId, `${slot === 'left' ? '左' : '右'}拳位`);
  return row ? { kind: 'skill', skillId, row } : { kind: 'invalid', skillId };
}

/** 该 F 键此刻绑的技能 id；`null` = 表还没到（未知），`0` = 该键明确未绑。 */
export function quickSkillIdOf(bindings: SkillBindings | null, index0: number): number | null {
  if (bindings == null) return null;
  if (index0 < 0 || index0 >= bindings.quick.length) return null;
  return bindings.quick[index0]!;
}

/**
 * 按下 F 键时，该把技能装到**哪只拳** —— 依据按优先级：
 *
 * ① 该技能此刻**已在某只拳上** ⇒ 装回那只（源码里 `MousePosi` 就是"这只技能在哪只拳上"的记录，
 *    按 F 键那一段就是照 `MousePosi` 装：`sinSkill.cpp:1495-1505`）；
 * ② 否则按该技能自己的 `useCode`：只能右键（`RIGHT`）⇒ 右拳；只能左键（`LEFT`）⇒ 左拳。
 *    录 F 键的源码分支要求"按着的那只鼠标"与 `useCode` 相容（`sinSkill.cpp:1447/1460`）：
 *    `RIGHT` 只可能被按着右键录进去 ⇒ `MousePosi` 必然是 RIGHT，与这里的推导**同结果**；
 * ③ `ALL`（左右都能绑，27 条）⇒ **无法确定** ⇒ 返回 null（不猜一只拳；调用方报告并什么都不做）。
 *
 * ⚠ ③ 是**协议里没有"目标拳"字段**的后果：原版把 `MousePosi` 与 `ShortKey` 一起写进存档
 * （`record.cpp:530` `ShortKey | (MousePosi << 4)`），而 `S2C_SkillBindings.quick` 只带 skillId。
 * 要 100% 复刻，需给协议/props 加一个"目标拳"字段 —— 属**待裁定**项（见 docs 审计附录）。
 *
 * @returns `null` = 不放/不装（调用方**什么都不做**并上报，不许换一只拳顶上）
 */
export function quickFistOf(skillId: number, bindings: SkillBindings | null,
                            job: number | null): FistSlot | null {
  if (bindings == null) return null;
  if (isUnbound(skillId)) return null;              // 该 F 键没绑东西（显式"没有"）
  if (bindings.fistLeft === skillId) return 'left';
  if (bindings.fistRight === skillId) return 'right';
  const row = boundRowOf(job, skillId, 'F 键绑定');
  if (!row) return null;
  if (row.useCode === 'RIGHT') return 'right';
  if (row.useCode === 'LEFT') return 'left';
  reportFallback('skill.bind.quickFist',
    `F 键绑的 0x${skillId.toString(16)}（useCode=${row.useCode}）无法确定目标拳 `
    + `⇒ 这一下不做任何事（协议没带 MousePosi；RMB/LMB 录制时的那只拳没有落盘）`);
  return null;
}

/** 该 F 键此刻绑着这个技能吗（面板画 `F1~F8` 角标用）。 */
export function quickKeyOfSkill(bindings: SkillBindings | null, skillId: number): number | null {
  if (bindings == null) return null;
  // ⚠ `0` 是"未绑"而不是"某个技能"：没这条守卫，`quickKeyOfSkill(…, 0)` 会把**第一个空的 F 键**
  // 报成"普攻绑在 F4 上"（值相等 ≠ 这是绑定）。
  if (isUnbound(skillId)) return null;
  for (let i = 0; i < bindings.quick.length; i++) {
    if (bindings.quick[i] === skillId) return i + 1;   // 返回 1..8（F 键号）
  }
  return null;
}

/** 该技能此刻绑在哪只拳上（面板画 L/R 角标用）；`null` = 没绑在任何一只拳上。 */
export function fistSlotOfSkill(bindings: SkillBindings | null, skillId: number): FistSlot | null {
  if (bindings == null) return null;
  if (bindings.fistLeft === skillId) return 'left';
  if (bindings.fistRight === skillId) return 'right';
  return null;
}
