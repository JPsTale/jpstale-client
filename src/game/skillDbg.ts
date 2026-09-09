// 技能等级调试模块（仅技能等级覆盖，供 SkillPanel 观察技能随等级效果）。
// 能力：把某技能临时设到 0~10 级（0=未学习）覆盖自动推断。
// 注：武器调试已移除（装备栏真实装备取代）；技能动画的武器类型由自机外观 selfAppearance 驱动。

export const SKILL_DEBUG = true;

const LS_LEVELS = 'pt.skillDbg.levels';

type LevelMap = Record<string, number>;

function load<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch { return fallback; }
}

let levels: LevelMap = SKILL_DEBUG ? load<LevelMap>(LS_LEVELS, {}) : {};
const listeners = new Set<() => void>();

// 快照对象：useSyncExternalStore 要求 getSnapshot 返回稳定缓存引用，
// 每次变更时替换整对象（与 gameStore 同款模式），否则无限重渲染。
let snapshot = { levels };

function emit(): void {
  if (!SKILL_DEBUG) return;
  snapshot = { levels };
  try {
    localStorage.setItem(LS_LEVELS, JSON.stringify(levels));
  } catch { /* ignore */ }
  for (const l of [...listeners]) l();
}

export function subscribeSkillDbg(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getSkillDbgSnapshot(): { levels: LevelMap } {
  return snapshot;
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
