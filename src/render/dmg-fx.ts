/**
 * 伤害数字打击感参数与纯逻辑 —— 设计依据 `docs/2026-09-18-伤害数字打击感-design.md`。
 *
 * 本模块**不碰 DOM / three**，只提供：
 *   - 模块级可变配置（`dmgFxGet/set/reset`）—— 飘字绘制段每帧读它，改完即生效；
 *   - 纯函数：弹跳曲线 / 弹落弧线 / 屏幕空间漂移方向 / 缓动。
 *
 * 数值含义（设计 §5、§7 + 2026-09-18 用户手感修正）：
 *   - 弹跳：出生瞬间冲到 `scale*` 倍 → 中段略回收 <1（overshoot）→ 1s 内只发生在前 `bounceMs`。
 *   - 垂直运动是"弹上去再掉下来"的弧线（`popArc`：先弹起 `upPeak` px，再加速下坠并落到
 *     起点下方 `dropDepth` px）—— 数字变大后往下掉，而不是一路往上飘（用户 2026-09-18）。
 *   - 漂移：普通命中沿攻击者所在方向滑开一段（朝向谁 = 从谁那边躲开）；
 *     无攻击者（怪打玩家）没有横向，只走垂直弧 + 淡出。
 */
export interface DmgFxConfig {
  /** 弹跳时长（ms，从飘字诞生起算） */
  bounceMs: number;
  /** 普通命中峰值放大倍数 */
  scaleNormal: number;
  /** 暴击峰值放大倍数 */
  scaleCrit: number;
  /** 垂直弧线：先弹起的高度（px） */
  upPeak: number;
  /** 垂直弧线：终点落到起点下方多少（px，>0 = 落在头顶之下） */
  dropDepth: number;
  /** 沿攻击者方向漂移的距离（px）—— 普通 / 暴击（横向 = "蹦得远"的旋钮） */
  driftNormal: number;
  driftCrit: number;
}

const DEFAULT: DmgFxConfig = {
  bounceMs: 140,
  scaleNormal: 1.35,
  scaleCrit: 1.8,
  upPeak: 46,
  dropDepth: 22,
  driftNormal: 46,
  driftCrit: 62,
};

let cfg: DmgFxConfig = { ...DEFAULT };

export function dmgFxGet(): DmgFxConfig {
  return cfg;
}

export function dmgFxSet(partial: Partial<DmgFxConfig>): void {
  cfg = { ...cfg, ...partial };
}

export function dmgFxReset(): void {
  cfg = { ...DEFAULT };
}

/**
 * 弹跳放大：`el=0` 时冲到 `S`（峰值），沿途单调收窄并翻到 `1` 之下（overshoot），
 * `el = bounceMs` 时恰好回到 `1`；`el<0` 截断到 `S`，`el ≥ bounceMs` 恒为 `1`。
 * 曲线：`1 + (S-1)·cos(u·π)·(1-u)`，`u = clamp(el/bounceMs, 0, 1)`。
 */
export function bounceScale(now: number, born: number, S: number, bounceMs: number): number {
  const u = Math.min((now - born) / bounceMs, 1);
  if (u < 0) return S;
  return 1 + (S - 1) * Math.cos(u * Math.PI) * (1 - u);
}

/** 漂移缓动：快速冲出、末段缓停（`t` ∈ [0, 1]） */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** 下坠缓动（加速） */
export function easeIn(t: number): number {
  return t * t;
}

/**
 * 垂直弹落弧线：数字先朝上弹起 `upPeak` px（前 `riseA` 用 easeOut），
 * 然后加速下落，`u=1` 时落到起点**下方** `dropDepth` px —— 呼应"变大后往下掉"。
 * 返回的是"屏幕上移量"（正 = 朝上）；落到头顶之下时结果为 `-dropDepth`。
 */
export function popArc(u: number, upPeak: number, dropDepth: number, riseA = 0.35): number {
  if (u < riseA) return upPeak * easeOutCubic(u / riseA);
  const v = (u - riseA) / (1 - riseA);
  return upPeak * (1 - easeIn(v)) - dropDepth * easeIn(v);
}

/** 屏幕空间"受击目标 → 攻击者"方向的单位向量；任一侧重合/不可判 → null（保持垂直上飘） */
export function dirFromTo(ax: number, ay: number, tx: number, ty: number): { x: number; y: number } | null {
  const dx = tx - ax;
  const dy = ty - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  return { x: dx / len, y: dy / len };
}