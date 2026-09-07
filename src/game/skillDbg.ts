// 技能动画调试模块（验证完毕将 SKILL_DEBUG 置 false 后整体移除）。
// 能力：把某技能临时设到 0~10 级（0=未学习）覆盖自动推断；为自机临时指定武器，
// 以便观察"技能动画随等级 / 随手持武器（Archer 弓/弩变体）"的实际播放效果。

export const SKILL_DEBUG = true;

// 调试武器清单：dorp(模型) + idcode(动画白名单匹配用) + type + 名称。
// 依据 pviewer 验证过的挂载逻辑：idCode 决定动画匹配，dorp 决定模型。
// dorp 前缀族（ex-machina sinItem 权威）：WA=斧 WC=锤? WS=弓/弩族 WP=枪 WM=法杖 WD=匕首 ...
// Archer 的弓/弩全部用 WS 前缀：WS101=Short Bow(双手) WS104=CrossBow(双手) WS103=HandCrossBow(单手)。
export interface DbgWeapon {
  label: string;
  dorp: string;      // DropItem 模型代码，如 'WS101' / 'WS104'
  idcode: number;    // 32bit 武器 idcode（动画 itemCodeList 精确匹配）
  weaponType: string | null; // 'BOW'|'CROSSBOW'|'SWORD'|...；null=空手走精确匹配
}

// idcode 前缀（weapon-type.ts）：AXE=0x0101 CLAW=0x0102 HAMMER=0x0103 STAFF=0x0104
// SCYTHE=0x0105 BOW/CROSSBOW=0x0106 SWORD=0x0107 JAVELIN=0x0108 DAGGER=0x010A
export const DBG_WEAPONS: DbgWeapon[] = [
  { label: '空手', dorp: '', idcode: 0, weaponType: null },
  { label: '弓 Short Bow (双手)', dorp: 'WS101', idcode: 0x01060100, weaponType: 'BOW' },
  { label: '单手弩 Hand CrossBow', dorp: 'WS103', idcode: 0x01060200, weaponType: 'CROSSBOW' },
  { label: '双手弩 CrossBow', dorp: 'WS104', idcode: 0x01060300, weaponType: 'CROSSBOW' },
  { label: '剑 (单手)', dorp: 'WS201', idcode: 0x01070100, weaponType: 'SWORD' },
  { label: '斧 (单手)', dorp: 'WA102', idcode: 0x01010100, weaponType: 'AXE' },
  { label: '长枪 (双手)', dorp: 'WP115', idcode: 0x01080100, weaponType: 'JAVELIN' },
  { label: '法杖 (双手)', dorp: 'WM102', idcode: 0x01040100, weaponType: 'STAFF' },
  { label: '匕首 (刺客)', dorp: 'WD102', idcode: 0x010A0100, weaponType: 'DAGGER' },
];

const LS_LEVELS = 'pt.skillDbg.levels';
const LS_WEAPON = 'pt.skillDbg.weapon';

type LevelMap = Record<string, number>;

function load<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch { return fallback; }
}

let levels: LevelMap = SKILL_DEBUG ? load<LevelMap>(LS_LEVELS, {}) : {};
let weaponIndex = SKILL_DEBUG ? load<number>(LS_WEAPON, 0) : 0;
const listeners = new Set<() => void>();

function emit(): void {
  if (!SKILL_DEBUG) return;
  try {
    localStorage.setItem(LS_LEVELS, JSON.stringify(levels));
    localStorage.setItem(LS_WEAPON, JSON.stringify(weaponIndex));
  } catch { /* ignore */ }
  for (const l of [...listeners]) l();
}

export function subscribeSkillDbg(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getSkillDbgSnapshot(): { levels: LevelMap; weaponIndex: number } {
  return { levels, weaponIndex };
}

/** 技能调试等级（iconFile 含 .bmp）；未手动设置返回 null */
export function dbgLevel(iconFile: string): number | null {
  if (!SKILL_DEBUG) return null;
  const v = levels[iconFile];
  return v === undefined ? null : v;
}

/** 设置调试等级：0=未学习，1~10=技能等级；null=清除（回归自动推断） */
export function setDbgLevel(iconFile: string, lv: number | null): void {
  if (!SKILL_DEBUG) return;
  if (lv == null) {
    delete levels[iconFile];
  } else {
    levels[iconFile] = Math.max(0, Math.min(10, Math.round(lv)));
  }
  emit();
}

export function resetDbgLevels(): void {
  levels = {};
  emit();
}

/** 当前调试武器索引；0=空手/不指定 */
export function dbgWeaponIndex(): number {
  return SKILL_DEBUG ? weaponIndex : 0;
}

export function setDbgWeapon(index: number): void {
  if (!SKILL_DEBUG) return;
  weaponIndex = Math.max(0, Math.min(DBG_WEAPONS.length - 1, index));
  emit();
}

export function dbgWeapon(): DbgWeapon {
  return DBG_WEAPONS[dbgWeaponIndex()] ?? DBG_WEAPONS[0];
}
