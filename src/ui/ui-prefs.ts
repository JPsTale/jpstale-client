/**
 * 界面/操作偏好 —— localStorage 持久化（走跑档位、小地图开关）。
 *
 * 用户 2026-09-13：这些状态原先**只在内存里**，每次重进游戏都被重置；
 * 与相机偏好（`camera-prefs.ts`）、音频偏好（`audio/prefs.ts`）同一套路：
 * **读的时候做类型校验，坏数据一律回默认**，绝不因为一条脏数据把界面搞坏。
 */
const KEY = 'pt.ui';

export interface UiPrefs {
  /** 走/跑档位（R 键）：true=跑（默认） */
  running: boolean;
  /** 小地图是否展开（TAB / HUD 按钮）：默认展开 */
  minimapOpen: boolean;
}

export const UI_PREFS_DEFAULT: UiPrefs = { running: true, minimapOpen: true };

function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === 'boolean' ? v : dflt;
}

export function loadUiPrefs(): UiPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>;
    return {
      running: bool(raw.running, UI_PREFS_DEFAULT.running),
      minimapOpen: bool(raw.minimapOpen, UI_PREFS_DEFAULT.minimapOpen),
    };
  } catch {
    return { ...UI_PREFS_DEFAULT };
  }
}

export function saveUiPrefs(p: UiPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式/配额满：忽略即可，不影响本次游玩 */
  }
}
