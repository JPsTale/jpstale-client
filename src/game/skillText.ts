/**
 * **技能的显示名与描述** —— 取**原版语言文件**里的文本（不是 wartale 的名字）。
 *
 * 数据源：生成物 `data/skill-tables.generated.json` 的 `definitions.<lang>`，
 * 逐条来自 `Language/<Lang>/<x>_sinSkill_Info.h` 的 `sSKILL_INFO` 初始化列表
 * （元组 `[0]` = 名、`[1]` = 描述；中文那份是 **GBK**，抽取器已按 GBK 解好，见 `extract-skill-tables`）。
 *
 * 为什么不用 `skillData.ts` 的 `name`：那是 wartale（另一个私服）的命名，
 * 用户 2026-09-24 要求"至少英文、中文对应的技能名字、描述都遵循原版" ⇒ 面板以**原版语言文件**为准。
 *
 * ⚠ **覆盖不齐是事实**：中文/英文两份都是**8 职业时代**（各 151 条），
 * **没有刺客/萨满那 47 条** ⇒ 查不到时按下面的链回退，并 `reportFallback` **显式留痕**
 * （AGENTS #12：不许静默给空串/别的名字当没事）。
 */
import GEN from './data/skill-tables.generated.json';
import { skillRowBySkillId } from './skillIdentity.js';
import { getLocale } from '../i18n/index.js';
import { reportFallback } from '../char/fallback-log.js';

interface DefRow {
  tuple: Array<string | number | null>;
  macro: string;
  code: string | null;
  src: string;
}

/** 语言键 → 生成物 `definitions` 的段名。UI 语言决定首选（zh→中文表、en→英文表）。 */
const LANG_BY_LOCALE: Record<string, string> = { zh: 'chinese', en: 'english' };

/** 名称/描述在元组里的位置（`sSKILL_INFO`：`[0]` 名、`[1]` 描述）。 */
const NAME_AT = 0;
const DESC_AT = 1;

function defsOf(lang: string): Map<string, DefRow> {
  const rows = (GEN.definitions as unknown as Record<string, DefRow[] | undefined>)[lang] ?? [];
  return new Map(rows.map((r) => [r.macro, r]));
}

/** 常量名（不是玩家可见名）—— 回退链最后一环用 `skillIdentity` 的行数据。 */
function textOf(lang: string, macro: string | null, at: number): string | null {
  if (!macro) return null;
  const row = defsOf(lang).get(macro);
  const v = row?.tuple[at];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * 取该技能的**名**（`at = 0`）或**描述**（`at = 1`），按顺序：
 *   ① UI 语言对应的原版语言表（zh→中文、en→英文）
 *   ② 另一份原版语言表（英文）—— 中文表缺刺客/萨满 47 条时会走到这
 *   ③ `null`（调用方自己决定显示什么；**这里不编名字**）
 *
 * 走到 ② 时 `reportFallback` 留痕（"这一条该语言没有"是可查的事实，不是静默替换）。
 */
function skillText(skillId: number, at: number): string | null {
  const row = skillRowBySkillId(skillId);
  if (!row) {
    reportFallback('skill.text.identity', `取技能文本：skillId 0x${skillId.toString(16)} 不在身份表里`);
    return null;
  }
  const want = LANG_BY_LOCALE[getLocale()] ?? 'english';
  const own = textOf(want, row.macro, at);
  if (own != null) return own;
  const other = want === 'english' ? 'chinese' : 'english';
  const fallback = textOf(other, row.macro, at);
  if (fallback != null) {
    reportFallback('skill.text.lang',
      `技能 ${row.macro} 在 ${want} 语言表里没有（该表是 8 职业时代，缺刺客/萨满）⇒ 用 ${other} 的文本`);
    return fallback;
  }
  reportFallback('skill.text.missing',
    `技能 ${row.macro} 的两份原版语言表都没有${at === NAME_AT ? '名' : '描述'} ⇒ 显示为空`);
  return null;
}

/** 原版技能名（该语言缺失时按 `skillText` 的链回退）；两份表都没有 ⇒ `null`。 */
export function skillName(skillId: number): string | null {
  return skillText(skillId, NAME_AT);
}

/** 原版技能描述（同上）；两份表都没有 ⇒ `null`。 */
export function skillDesc(skillId: number): string | null {
  return skillText(skillId, DESC_AT);
}
