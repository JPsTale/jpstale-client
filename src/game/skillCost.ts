/**
 * **技能的施法前提（客户端预校验）** —— 只看"我们此刻就能判、且与服务端同源"的那几条。
 *
 * ⚠ 这是**预校验**，不是权威：权威判定在服务端（`SkillCastService.begin` 的职业门/已学门/MP 门）。
 * 预校验的用途只有一个 —— **别让客户端先把动画播出去、再被服务端拒**（用户 2026-09-24：
 * "缺少魔法值现在也可以施法，至少客户端应该判断施法前提吧"）。客户端播了动画又不结算，
 * 玩家看到的是"技能放出去了但没效果"，比直接拦下更糟。
 *
 * 数据源 = **与服务端同一份生成物** `data/skill-tables.generated.json`（同 `sourceHash`）：
 *   · 技能定义（`definitions.brazil[].tuple`）给 `useManaTable`（该技能的 MP 表名）；
 *     CD 的 `RequireMastery[2]` 与 `Element[0]` 走生成物 `skills[]`（口径见那里的字段注释）；
 *   · 参数表（`arrays[]`）给逐级的 MP 值。
 * 两边同源 ⇒ 客户端算出的消耗与服务端扣的**按构造一致**（不是"抄了一份公式"）。
 *
 * 原版对应：`sinCheckSkillUseOk` 的 MP 那一半（`sinGetMana() - UseMana[Point-1]`，`Morayion.cpp:97-120`）
 * 与 `OpenPlaySkill` 的闸门。全套原版闸门见 `skillNoTarget.ts` 头部注释（本轮仍未做的：
 * 武器要求 / 持续技能互斥 / CD；逐 `case` 守卫）。
 */
import GEN from './data/skill-tables.generated.json';
import { skillRowBySkillId } from './skillIdentity.js';

type ArrayRow = { dims: number[]; type: string; values: number[] | number[][] };
type DefRow = { tuple: (string | number)[]; code: string; macro: string };

const ARRAYS = GEN.arrays as unknown as Record<string, ArrayRow>;
const DEF_BY_MACRO = new Map<string, DefRow>(
  (GEN.definitions.brazil as unknown as DefRow[]).map((d) => [d.macro, d]),
);

/**
 * 定义表 `tuple` 里 `useManaTable`（MP 表名）的下标。
 * 布局同服务端 `SkillDataRegistry.SkillDefinition` 的 javadoc：`[18]` 函数名 `[19]` 宏 `[20]` useCode `**[21]` MP 表**。
 */
const TUPLE_USE_MANA = 21;
/**
 * ⚠ CD 的 `RequireMastery[2]` 与 `Element[0]` **都不从这里读** —— 走生成物 `skills[]` 里那两个
 * 定好口径的列（`row.requireMastery` / `row.element0`，口径与逐值 provenance 见生成物的
 * `requireMasteryNote` / `elementNote`）。原因：这两列在 Brazil 与 English/Chinese 之间**打架**
 * （前者是私服对高阶技能的一次"无 CD"改写），而本模块只读 `definitions.brazil`。
 * 派生后的熟练度也由服务端下发（`SkillRules.useSkillMastery`，唯一实现）。
 */

/**
 * 该技能**当前等级**要多少 MP（表值，1 基等级 ⇒ 下标 `point-1`）。
 *
 * @returns `null` = **取不到**（不是已学技能 / 定义缺 / 表缺 / 等级未知 / 该级无表值）
 *   —— 调用方必须把 `null` 当"**不判**"（放行）并留痕，**不许**当成 0（那会让"数据缺"变成"免费放"）。
 */
export function skillMpCost(skillId: number, point: number): number | null {
  const row = skillRowBySkillId(skillId);
  if (!row?.macro) return null;
  const def = DEF_BY_MACRO.get(row.macro);
  if (!def) return null;
  const tableName = def.tuple[TUPLE_USE_MANA];
  if (typeof tableName !== 'string' || tableName === '0' || tableName.length === 0) {
    // 源码里 `UseMana` 指针为 0 = **这一招不耗蓝**（原版表末位写 `0`），不是缺数据。
    return 0;
  }
  const table = ARRAYS[tableName];
  if (!table || !Array.isArray(table.values) || table.dims.length !== 1) return null;
  const values = table.values as number[];
  if (point < 1 || point > values.length) return null;
  return values[point - 1];
}

/** 施法被拦的原因（与 i18n `skill.op.*` 同名 —— 服务端的拒绝原因码同一套，见 `SkillRules.Reason`）。 */
export type CastBlock = 'noMp' | 'notEnoughData';

/** 施法资源门的结果。 */
export interface ResourceCheck {
  /** 这一级要多少 MP（`null` = 取不到，未判） */
  mpCost: number | null;
  /** 拦下的原因；`null` = 放行 */
  block: CastBlock | null;
}

/**
 * **施法资源门**（客户端预校验）：MP 够不够。
 *
 * ⚠ 本模块**保持纯数据**（只吃生成物 + 入参，不 import store/UI）：等级与 MP 由调用方给 ——
 * 这样它可以被校验脚本直接跑（`gameStore` 那条链会经 `audio/sfx` 拖进 `document`，node 里跑不起来）。
 *
 * 语义与 `skillNoTarget.ts` 的 `noTargetCastBlock` 一致：**取不到就放行并留痕**
 * （"等级未知/表缺"是我方异步时序或数据缺口的产物，静默拦下会变成"技能放不出来"这种最难查的症状）。
 *
 * @param point 该技能当前等级（`skillLevelOf` 的产物；`null`/0 = 未知或未学）
 * @param mp    施法者当前 MP（角色快照 `character.mp`）
 */
export function checkCastResources(skillId: number, point: number | null, mp: number): ResourceCheck {
  if (point == null || point < 1) {
    return { mpCost: null, block: null };   // 等级未知/未学：由 `noTargetCastBlock`/服务端各自把关
  }
  const cost = skillMpCost(skillId, point);
  if (cost == null) {
    return { mpCost: null, block: 'notEnoughData' };
  }
  return { mpCost: cost, block: mp < cost ? 'noMp' : null };
}

/** 定义表 `tuple` 里 `UseStamina` 的两个数（`{基数, 每级增量}`），下标同源布局 `[3]`/`[4]`。 */
const TUPLE_SP_BASE = 3;
const TUPLE_SP_INC = 4;

/**
 * 该技能**该等级**要多少 SP（体力）。原版 `UseStamina = {a, 2}` ⇒ 每级 `a + 2*(level-1)`
 * （`docs/服务端技能系统-设计.md` §2.2：10 级 = `a+18`）。
 * @returns `null` = 取不到（定义缺/等级越界）—— 调用方按"未知"显示，**不要当 0**
 */
export function skillSpCost(skillId: number, point: number): number | null {
  const row = skillRowBySkillId(skillId);
  if (!row?.macro) return null;
  const def = DEF_BY_MACRO.get(row.macro);
  if (!def) return null;
  const base = def.tuple[TUPLE_SP_BASE];
  const inc = def.tuple[TUPLE_SP_INC];
  if (typeof base !== 'number' || typeof inc !== 'number') return null;
  if (point < 1) return null;
  return base + inc * (point - 1);
}

/* ────────────── CD（冷却）与"此刻能不能用" ────────────── */

/* ────────────── CD 时长与"此刻能不能用" ────────────── */

/* ⚠ CD 时长的公式**不再在这里** —— 唯一实现是服务端 `SkillRules.cooldownMs`（逐帧真值），
   服务端在 `S2C_SkillList.skills[].cd_ms` 里下发，客户端只存不算（AGENTS #15：判定只写一份）。
   客户端侧的冷却状态（起表/剩余/进度）在 `game/skillCooldown.ts`。 */

/** 此刻**能不能用**这个技能（原版 `UseSkillFlag`：CD 满 + MP 够 + SP 够；未学恒灰）。 */
export type SkillUnusable = 'unlearned' | 'cooldown' | 'noMp' | 'noSp' | 'unknownData' | null;

/**
 * 判定顺序照原版：未学 ⇒ 灰（`Point == 0`）；CD 未满 ⇒ 灰（`GageLength < 35`）；
 * 再由 `CheckUseSkillState` 看 MP/SP（`sinSkill.cpp:5008-5016`）。
 * 数据缺（表取不到）⇒ `'unknownData'`（**不当作可用也不当作不可用**，调用方自行显示为未知）。
 */
export function skillUsability(skillId: number, point: number | null, mp: number, sp: number,
                               cdRemainingMs: number): SkillUnusable {
  if (point == null || point < 1) return 'unlearned';
  if (cdRemainingMs > 0) return 'cooldown';
  const mpCost = skillMpCost(skillId, point);
  if (mpCost == null) return 'unknownData';
  if (mp < mpCost) return 'noMp';
  const spCost = skillSpCost(skillId, point);
  if (spCost == null) return 'unknownData';
  if (sp < spCost) return 'noSp';
  return null;
}
