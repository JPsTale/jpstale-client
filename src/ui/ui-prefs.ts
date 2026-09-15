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
  /** 大地图窗口几何（CSS px；null = 用默认居中尺寸） */
  worldMapRect: { x: number; y: number; w: number; h: number } | null;
  /** 大地图：**非激活时半透明**（鼠标不在窗口里就变淡，照 FF14） */
  worldMapDim: boolean;
  /** 非激活时的透明度（0~1；用户 2026-09-15：默认 50%，以后可在设置里改） */
  worldMapDimAlpha: number;
  /** 大地图点位显示：off / gates（传送门）/ all（+出生点） */
  worldMapPoi: 'off' | 'gates' | 'all';
  /** 大地图：显示地图上的文字（区域名/等级门） */
  worldMapLabels: boolean;
}

export const UI_PREFS_DEFAULT: UiPrefs = {
  running: true, minimapOpen: true, worldMapRect: null,
  worldMapDim: true, worldMapDimAlpha: 0.5, worldMapPoi: 'gates', worldMapLabels: true,
};

function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === 'boolean' ? v : dflt;
}

/** 窗口几何：四个数都必须是有限数才采纳（半截脏数据一律回 null = 用默认） */
function rect(v: unknown): UiPrefs['worldMapRect'] {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const nums = ['x', 'y', 'w', 'h'].map((k) => r[k]);
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [x, y, w, h] = nums as number[];
  return w > 200 && h > 150 ? { x, y, w, h } : null;
}

/** 透明度：0.1~0.9 之外一律回默认（全透/全不透会让地图没法看） */
function alpha(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0.1 && v <= 0.9
    ? v : UI_PREFS_DEFAULT.worldMapDimAlpha;
}

function poi(v: unknown): UiPrefs['worldMapPoi'] {
  return v === 'off' || v === 'gates' || v === 'all' ? v : UI_PREFS_DEFAULT.worldMapPoi;
}

export function loadUiPrefs(): UiPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>;
    return {
      running: bool(raw.running, UI_PREFS_DEFAULT.running),
      minimapOpen: bool(raw.minimapOpen, UI_PREFS_DEFAULT.minimapOpen),
      worldMapRect: rect(raw.worldMapRect),
      worldMapDim: bool(raw.worldMapDim, UI_PREFS_DEFAULT.worldMapDim),
      worldMapDimAlpha: alpha(raw.worldMapDimAlpha),
      worldMapPoi: poi(raw.worldMapPoi),
      worldMapLabels: bool(raw.worldMapLabels, UI_PREFS_DEFAULT.worldMapLabels),
    };
  } catch {
    return { ...UI_PREFS_DEFAULT };
  }
}

/**
 * 落盘 —— **入参是"要改的那几项"**，其余从当前值带过来。
 *
 * ⚠ 原先要求传完整对象：`saveUiPrefs({ running, minimapOpen })` 这种写法在新加字段时
 * 会**把新字段悄悄清掉**（2026-09-15 加大地图窗口几何时就撞上，tsc 只是恰好报出来了）。
 * 现在改成部分更新，任何调用点都不可能再误删别的偏好。
 */
export function saveUiPrefs(patch: Partial<UiPrefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadUiPrefs(), ...patch }));
  } catch {
    /* 隐私模式/配额满：忽略即可，不影响本次游玩 */
  }
}
