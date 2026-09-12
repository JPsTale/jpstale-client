/**
 * 相机偏好 —— localStorage 持久化（观察距离 / 俯仰角 / 朝向）。
 *
 * 用户 2026-09-12：
 *   1. 初始距离 400（原 100 太近）；最大距离支持到 600（原 440）。
 *   2. 这些设置**必须留在客户端** —— 原先只存在内存里，每次重进游戏都要重设一遍。
 *
 * 与音频偏好（`src/audio/prefs.ts`）同一套路：读的时候做类型 + 范围校验，坏数据一律回默认，
 * 绝不让一个 NaN 把相机推到无穷远。
 */
const KEY = 'pt.camera';

/** 观察距离（世界单位）：下限 40、上限 600、默认 400（用户指定） */
export const CAM_DIST_MIN = 40;
export const CAM_DIST_MAX = 600;
export const CAM_DIST_DEFAULT = 400;

/** 俯仰角（弧度）：引擎角 40..976 → 弧度，与原版 debug 相机（/pt/maps/）取值范围一致 */
export const CAM_ANX_MIN = (40 / 4096) * Math.PI * 2;
export const CAM_ANX_MAX = (976 / 4096) * Math.PI * 2;
export const CAM_ANX_DEFAULT = (384 / 4096) * Math.PI * 2; // 33.75°

export interface CameraPrefs {
  /** 观察距离（拖近拖远） */
  dist: number;
  /** 俯仰角（弧度高） */
  anx: number;
  /** 水平朝向（弧度高），归一化到 [0, 2π) */
  any: number;
  /**
   * 相机模式（原版 `PlayCameraMode`）：**0=手动 / 1=自动 / 2=固定**，默认 1（自动）。
   * 用户 2026-09-13：模式与自动回正原先只在内存里，重进游戏就被重置。
   */
  mode: number;
  /** 自动回正（原版 `AutoCameraFlag`）：手动动过相机后关掉，平滑到位后再打开 */
  autoRecenter: boolean;
}

const TAU = Math.PI * 2;

/** 相机模式取值范围（原版只有这三档） */
export const CAM_MODE_MIN = 0;
export const CAM_MODE_MAX = 2;
export const CAM_MODE_DEFAULT = 1; // 自动

function num(v: unknown, lo: number, hi: number, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
}

function angle(v: unknown, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt;
  return ((v % TAU) + TAU) % TAU;
}

export function loadCameraPrefs(): CameraPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>;
    return {
      dist: num(raw.dist, CAM_DIST_MIN, CAM_DIST_MAX, CAM_DIST_DEFAULT),
      anx: num(raw.anx, CAM_ANX_MIN, CAM_ANX_MAX, CAM_ANX_DEFAULT),
      any: angle(raw.any, 0),
      // 取整并夹到 0..2：老数据里没有这两个字段 → 回默认（自动 / 自动回正开）
      mode: Math.round(num(raw.mode, CAM_MODE_MIN, CAM_MODE_MAX, CAM_MODE_DEFAULT)),
      autoRecenter: typeof raw.autoRecenter === 'boolean' ? raw.autoRecenter : true,
    };
  } catch {
    return { dist: CAM_DIST_DEFAULT, anx: CAM_ANX_DEFAULT, any: 0, mode: CAM_MODE_DEFAULT, autoRecenter: true };
  }
}

export function saveCameraPrefs(p: CameraPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式/配额满：忽略即可，不影响本次游玩 */
  }
}
