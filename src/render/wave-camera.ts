/**
 * 屏幕震动（原版 `EffectWaveCamera` + `WaveCameraMode`）—— **唯一实现**，游戏（`WorldView`）与实验室共用。
 *
 * 原版不是"晃相机位置"，而是**在观察距离（`ViewDist`）上叠一个来回衰减的量**：
 *
 * ```cpp
 * // 触发（Main.cpp / HoLinkHeader.cpp:318）
 * EffectWaveCamera(int factor, int delay) { WaveCameraFlag = TRUE; WaveCameraFactor = factor; WaveCameraDelay = delay; }
 * // 每帧（Main.cpp:1733-1754）
 * if (WaveCameraFlag && WaveCameraMode) {
 *     WaveCameraTimeCount++;
 *     if (WaveCameraTimeCount > WaveCameraDelay) {
 *         WaveCameraTimeCount = 0;
 *         if (WaveCameraDelay > 1 && WaveCameraFactor < 40)
 *             WaveCameraFactor = -(int)(WaveCameraFactor / 10.f * 9.f);   // 来回：变号 + 衰减 ×0.9
 *         else
 *             WaveCameraFactor = -(int)(WaveCameraFactor / 10.f * 8.f);   // 短促那种用 ×0.8
 *         ViewDist += WaveCameraFactor;                                   // 只在这一帧叠加
 *     }
 *     if (abs(WaveCameraFactor) < 1) { WaveCameraFlag = FALSE; WaveCameraTimeCount = 0; }
 * }
 * ```
 *
 * 触发点举例（距离 = 爆点与**本地玩家**的世界单位距离）：
 * `AssaParticle.cpp:8658` / `hoAssaParticleEffect.cpp:1587,5177` 的 `EffectWaveCamera((500 - 距离)/15, 2)`。
 *
 * ⚠ **全局开关**：原版是 `WaveCameraMode`（`Main.cpp:161`，默认 TRUE）——很多玩家不喜欢震动，
 * 我们把它做成**持久化的画面设置项**（`display-prefs.shake`，系统设置里可关）。
 * 关掉后本模块**什么也不做**（不是"把震动调小"，是完全不触发）。
 */

/** 原版 `WaveCameraMode`，默认开（玩家可在画面设置里关掉） */
let enabled = true;
/** 原版 `WaveCameraFlag` / `WaveCameraFactor` / `WaveCameraDelay` / `WaveCameraTimeCount` */
let flag = false;
let factor = 0;
let delay = 0;
let count = 0;

/**
 * 触发一次震动（原版 `EffectWaveCamera(factor, delay)`）——`factor` 为 0 时不触发。
 *
 * ⚠ **同一时刻只有一个震动实例**（原版也是一个全局 `WaveCameraFlag`）：**正在震时的触发不重开**。
 * 为什么必须这样（用户 2026-09-18 实测）：多只怪/多次施法时，每次命中都调一次本函数 ⇒
 * 若每次都把 `factor` 重置回满幅，震动会被**持续续命**（实测 24 次命中首尾相接 ⇒ 相机在 ±17 上
 * 一直抽搐 = "屏幕震动直接疯了"）。忽略后续触发后，一次震动照常衰减收尾，之后新触发再起一次。
 *
 * （原版那条 `EffectWaveCamera` 是"后来的覆盖 `factor`、且**不重置** `WaveCameraTimeCount`"，
 *  覆盖同样会导致续命；故这里按用户要求取"不重开"。）
 */
export function waveCamera(factorIn: number, delayIn = 0): void {
  if (!enabled) return;
  if (!factorIn) return;
  if (flag) return;               // 已在震：不重开（见上）
  flag = true;
  factor = factorIn;
  delay = delayIn;
  count = 0;
}

/**
 * **每帧调一次**（只能在相机那里调一次 —— 它会推进状态），返回**本帧要叠加到观察距离上的量**。
 *
 * 与原版一致：只有"跨过 delay 的那一帧"返回非 0，其余帧返回 0（`ViewDist += factor` 只在该帧做）。
 */
export function updateWaveCamera(): number {
  if (!flag || !enabled) { flag = false; return 0; }
  count++;
  let out = 0;
  if (count > delay) {
    count = 0;
    // 原版是 C 的 `static_cast<int>`（向零截断）后取负 —— 这里用 `| 0` 等价
    factor = delay > 1 && factor < 40 ? -((factor / 10) * 9 | 0) : -((factor / 10) * 8 | 0);
    out = factor;
  }
  if (Math.abs(factor) < 1) { flag = false; count = 0; }
  return out;
}

/** 全局开关（画面设置里改；关掉时**正在震的那次也立刻停**） */
export function setWaveCameraEnabled(on: boolean): void {
  enabled = on;
  if (!on) { flag = false; count = 0; }
}

export function isWaveCameraEnabled(): boolean {
  return enabled;
}

/** 诊断（实验室/日志用） */
export function waveCameraState(): { enabled: boolean; active: boolean; factor: number; delay: number; count: number } {
  return { enabled, active: flag, factor, delay, count };
}
