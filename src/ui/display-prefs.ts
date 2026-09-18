/**
 * 显示偏好 —— localStorage 持久化（同屏怪物显示预算）。
 *
 * 与 `ui-prefs.ts` / `camera-prefs.ts` / `audio/prefs.ts` 同一套路：
 * **读的时候做类型校验，坏数据一律回默认**，绝不因为一条脏数据把界面搞坏。
 *
 * 用户 2026-09-14 定调：这个策略**要能关**（关掉 = 退回旧行为，所有 AOI 怪都显示、都算动画），
 * 距离**要给玩家选** —— 万一策略在某些场景不合适，玩家自己能救自己，不必等我们发版。
 */
const KEY = 'pt.display';

/** 显示距离档（档位表在 `render/monster-visibility.ts`，这里只存键） */
export type DisplayRangeKey = 'near' | 'mid' | 'far' | 'max';

export const DISPLAY_RANGE_KEYS: DisplayRangeKey[] = ['near', 'mid', 'far', 'max'];

export interface DisplayPrefs {
  /** 同屏怪物显示预算：true=按档位裁剪（默认）；false=不裁剪（全部 AOI 怪都显示并参与动画） */
  monsterBudget: boolean;
  /** 显示距离档 */
  range: DisplayRangeKey;
  /**
   * **屏幕震动**（原版 `WaveCameraMode`，见 `render/wave-camera.ts`）——默认开。
   * 很多玩家不喜欢震动，故做成可关的全局开关；关掉后**完全不触发**（不是调小）。
   */
  shake: boolean;
}

export const DISPLAY_PREFS_DEFAULT: DisplayPrefs = { monsterBudget: true, range: 'mid', shake: true };

function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === 'boolean' ? v : dflt;
}

export function loadDisplayPrefs(): DisplayPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>;
    const range = DISPLAY_RANGE_KEYS.includes(raw.range as DisplayRangeKey)
      ? (raw.range as DisplayRangeKey)
      : DISPLAY_PREFS_DEFAULT.range;
    return {
      monsterBudget: bool(raw.monsterBudget, DISPLAY_PREFS_DEFAULT.monsterBudget),
      range,
      shake: bool(raw.shake, DISPLAY_PREFS_DEFAULT.shake),
    };
  } catch {
    return { ...DISPLAY_PREFS_DEFAULT };
  }
}

export function saveDisplayPrefs(p: DisplayPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式/配额满：忽略即可，不影响本次游玩 */
  }
}
