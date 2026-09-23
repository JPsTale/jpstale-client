/**
 * **无目标施放** —— 右键"点空地也能放"的那批技能（原版 `OpenPlaySkill`）。
 *
 * 出处：`SkillSub.cpp:29` 的 `int OpenPlaySkill(sSKILL *lpSkill)`；调用点只有两处、都传 `pRightSkill`
 * （`Winmain.cpp:3087` 右键按下 / `ActionGame.cpp:229` 动作模式）。逐行调研见
 * `docs/技能施法-原版流程.md`（§3.2 / §5.1 / §12）。
 *
 * **名单**（能不能无目标放）来自生成物 `data/source/skill-openplay-macros.json`
 * （`npm run openplay-skills` 从源码机械抽取；判据见 `scripts/openplay-scan.ts`）。
 *
 * 闸门顺序**照源码**（原版 `OpenPlaySkill` 头 6 行 + 调用点）：
 *   ① 村庄 ⇒ 不放（`SkillSub.cpp:41`；调用点还有一条 `playmain.cpp:2316`，见 WorldView）
 *   ② 职业组掩码不符 ⇒ 不放（`sinCheckSkillUseOk`，`Morayion.cpp:76-87`）
 *   ③ 未学 / 等级 > 10 ⇒ 不放（`Point == 0` 经 `UseSkillFlag` 归零、`Point > 10` 显式拒绝）
 *   ④ 技能不在名单里 ⇒ 不放（`switch` 里没有它的 `case`，函数尾 `return flag` = 0）
 *
 * ⚠ **本轮明确未实现**（源码有、我们没做 —— 别当成"已生效"）：
 *   · **MP / SP**：原版查 `sinGetMana() - UseMana[Point-1]`（`Morayion.cpp:97-120`）与
 *     `RequireStateCheck`（`Tempskron.cpp:329`）。我方**没有可信的数值表** —— `UseMana` 那 484 张表
 *     在原版是 **启动时从 `<职业>.ini` 读入覆盖**的（`sinSkill_Info.cpp` 里 870 处 `ReadSkillInt`，
 *     文件名 `Fighter/Mech/Archer/Pike/Knight/Atalanta/Sacer/Mage/Assassin/Shaman.ini`），
 *     而这些 ini **在任何一份资产源里都不存在**（`grep -rl E_Shield_UseMana client/` 无命中）。
 *     我们生成物里那几个数是**编译期初值**，用它判"MP 不够"会在数值不符时**静默放不出技能**。
 *   · **武器要求**（`UseWeaponCode` vs 主手 `sInven[0]`，`Morayion.cpp:166-236`）、
 *     **持续技能互斥**（`sinNotToggleSkill_CODE`，`Morayion.cpp:139-160`）、
 *     **CD / `UseSkillFlag`**（`sinSkill.cpp:2114-2124`）。
 *   · **每个 `case` 自己的守卫**：如 `SKILL_TRIUMPH_OF_VALHALLA` / `HEALING` / `VIRTUAL_LIFE` /
 *     `ENCHANT_WEAPON` 要求**光标下没有任何角色**（`!lpCharSelPlayer`，`SkillSub.cpp:512/537/643/703`）
 *     —— 我们只做到"技能在名单里且不在施法动作中就放"，这类逐案条件**未复刻**。
 */
import OPENPLAY from './data/source/skill-openplay-macros.json';
import { skillRowBySkillId } from './skillIdentity.js';
import { skillLevelOf } from './skillLevel.js';
import { reportFallback } from '../char/fallback-log.js';

/** 名单（宏名集合）—— 生成物的 `macros[].macro` */
const MACROS: ReadonlySet<string> = new Set(OPENPLAY.macros.map((m) => m.macro));

/** 名单条数（校验脚本/日志用；不是"我们的常量"，它就是生成物的计数） */
export const NO_TARGET_SKILL_COUNT = MACROS.size;

/** 名单里有没有这个宏（供校验脚本与调试用；世界逻辑请走 `noTargetCastBlock`） */
export function isInNoTargetList(macro: string | null): boolean {
  return macro != null && MACROS.has(macro);
}

/** 不放的原因（调用方据此区分"该退回原有路径"与"数据有问题"；**不弹消息**，原版也不弹） */
export type NoTargetBlock =
  | 'village'        // 村庄地图（原版 SkillSub.cpp:41）
  | 'class'          // 不是本职业的技能（sinCheckSkillUseOk 的职业组掩码）
  | 'notInList'      // 该技能在 OpenPlaySkill 的 switch 里没有 case
  | 'unlearned'      // Point == 0（经 UseSkillFlag 归零 ⇒ 校验不过）
  | 'pointTooHigh'   // Point > 10（SkillSub.cpp:45）
  | 'unknownSkill';  // skillId 不在我方技能身份表里

/**
 * 这个技能此刻能不能**无目标施放**。
 * @returns `null` = 可以放；否则是**不放的原因**（调用方一律静默退回原有路径）
 *
 * ⚠ `skillId` 的等级未知时（`S2C_SkillList` 还没到）**不拦**，但会 `reportFallback` 留痕 ——
 *   "等级未知"是我方异步时序的产物、不是源码里的状态，静默拦住会变成"右键没反应"这种最难查的症状。
 */
export function noTargetCastBlock(skillId: number, selfClassDir: string, village: boolean): NoTargetBlock | null {
  if (village) return 'village';
  const row = skillRowBySkillId(skillId);
  if (!row) {
    reportFallback('skill.cast.identity', `无目标施放：skillId 不在技能身份表里（0x${skillId.toString(16)}）`);
    return 'unknownSkill';
  }
  if (row.classDir !== selfClassDir) return 'class';
  if (!isInNoTargetList(row.macro)) return 'notInList';
  const point = skillLevelOf(skillId);
  if (point == null) {
    reportFallback('skill.cast.level', `无目标施放：技能等级未知（S2C_SkillList 未到）⇒ 不判未学/上限，放行（${row.macro}）`);
    return null;
  }
  if (point <= 0) return 'unlearned';
  if (point > 10) return 'pointTooHigh';
  return null;
}
