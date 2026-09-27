// 技能**身份桥**：`iconFile ⇄ skillId ⇄ 生成物整行` —— 唯一实现在此（AGENTS #15）。
//
// 身份规则与各列含义见 `docs/技能ID与映射-评审稿.md` §3/§4；本模块只管**查表**，不派生任何值。
// 与动画匹配链（`data/skillIndexByIcon.ts`，键也是 iconFile）**正交**：那条链管"播哪条动画"，
// 这条管"这是哪个技能"（上报/学习/面板）。两者只共享 iconFile 这个键。
import GEN from './data/skill-tables.generated.json';
import { reportFallback } from '../char/fallback-log.js';

/** 生成物 `skills` 的一行（只声明本模块对外暴露的列）。 */
export interface SkillIdentityRow {
  job: number;
  classDir: string;
  skillId: number;
  skillIdHex: string;
  slotInJob: number;
  tier: number;
  slotInTier: number;
  iconFile: string;
  /** 枚举常量名（不是玩家可见名；不进键、不当判据） */
  name: string;
  constName: string;
  reqLv: number;
  useCode: string;
  weapon: number[];
  macro: string | null;
  pairing: string;
  sourceUseCode: string | null;
  /**
   * `Element[0]`（`0`/`1`）。原版两处语义：`sinSkill.cpp:2064` 熟练度恒满、`:839` 粉色 gage。
   * 取值口径与 provenance 见生成物 `elementNote` / `element0Src`（**不是** Brazil 那一列）。
   */
  element0: number;
  element0Src: string;
  /**
   * CD 公式的 `RequireMastery[2]`（`sinSkill.cpp:2072`）；`null` = 生成物没有这一列
   * （无宏定义的 60 行）⇒ CD 算不出来时显式未知。口径见生成物 `requireMasteryNote`。
   */
  requireMastery: number[] | null;
  requireMasterySrc: string;
}

const ROWS: readonly SkillIdentityRow[] = GEN.skills as readonly SkillIdentityRow[];

/** 归一化：大小写不敏感 + 去 `.bmp`（两端写法不同：面板给 `'ma10 s_strike.bmp'`、绑定给含/不含后缀两种）。 */
function normIcon(iconFile: string): string {
  return iconFile.replace(/\.bmp$/i, '').trim().toLowerCase();
}

const BY_ID = new Map<number, SkillIdentityRow>();
/** 图标 → 行**列表**（保留多候选，不静默取第一个） */
const BY_ICON = new Map<string, SkillIdentityRow[]>();
for (const r of ROWS) {
  BY_ID.set(r.skillId, r);
  const k = normIcon(r.iconFile);
  const list = BY_ICON.get(k);
  if (list) list.push(r); else BY_ICON.set(k, [r]);
}

/**
 * 图标 → 数字 `skillId`。**查不到/多候选都返回 null 并上报**（调用方据此不发包/不点亮，不许兜底）。
 * 多候选（同一个图标对应多行）在此**列出全部候选**，绝不静默取第一个。
 */
export function skillIdByIcon(iconFile: string): number | null {
  const list = BY_ICON.get(normIcon(iconFile));
  if (!list || list.length === 0) {
    reportFallback('skill.identity', `图标不在技能身份表里：'${iconFile}'`);
    return null;
  }
  if (list.length > 1) {
    reportFallback('skill.identity.ambiguous',
      `'${iconFile}' 对应 ${list.length} 行：${list.map((r) => `${r.classDir}#${r.slotInJob}=0x${r.skillIdHex}`).join(' / ')}`);
    return null;
  }
  return list[0]!.skillId;
}

/** 数字 `skillId` → 生成物整行（名字/需求等级/槽位/useCode 的唯一来源）。 */
export function skillRowBySkillId(skillId: number): SkillIdentityRow | null {
  return BY_ID.get(skillId) ?? null;
}

/**
 * 该技能的**目标可以是"别的角色"**（原版 `SkillSub.cpp:2737` 的 `lpChar` 分支：把 `SKILL_PLAY_HEALING`
 * 发给**被选中的角色** —— 玩家或怪都行，服务端 `rsPlayHealing`（`OnSever.cpp:16478`）对任意
 * `smCHAR` 执行 `Life[0] += WParam`）。无目标时才走自疗（`SkillSub.cpp:537` 那支自带
 * `!lpCharSelPlayer` 守卫）。用户 2026-09-27 指出："客户端只有对自己施法，没有对目标施法"。
 *
 * ⚠ 集合仍以「治疗类」为准（`HEALING` / `GRAND_HEALING`）；两个都取同一份依据：
 * `SkillSub.cpp` 的 `case SKILL_HEALING`（自疗分支 + `lpChar` 分支）。
 * 名字从 `skillTargetsPlayers` 改为 `skillTargetsCharacters`：**目标不只是玩家**（怪也能治）。
 */
const TARGET_CHARACTER_CONSTS = new Set(['HEALING', 'GRAND_HEALING']);

/** 该技能的目标可以是**别的角色**（玩家或怪）—— 见上注。 */
export function skillTargetsCharacters(skillId: number): boolean {
  const row = BY_ID.get(skillId);
  return row != null && TARGET_CHARACTER_CONSTS.has(row.constName);
}

/**
 * Multi Spark 每级**道数区间** —— `M_Spark_Num[point-1]`（生成物 `arrays`），实际
 * N = rand(Num/2+1, Num)（随机在服务端结算时发生，并经 `S2C_SkillStart.spark_count`
 * 同步给视觉）。面板技能信息显示这个区间；非 Multi Spark / 表缺失 ⇒ null。
 */
export function sparkCountRange(skillId: number, point: number): { min: number; max: number } | null {
  const row = BY_ID.get(skillId);
  if (!row || row.constName !== 'MULTISPARK') return null;
  const arr = (GEN as { arrays?: { M_Spark_Num?: { values?: number[] } } }).arrays?.M_Spark_Num?.values;
  if (!arr?.length) return null;
  const num = arr[Math.min(Math.max(point, 1), arr.length) - 1];
  if (!num || num < 1) return null;
  return { min: Math.floor(num / 2) + 1, max: num };
}
