import { FONE } from '../../core/geom.js';
import { reportFallback } from '../../char/fallback-log.js';
import type { EffectManager } from './effect-manager.js';

/**
 * **锻造成功的特效**（原版 `EFFECT_AGING` = 5001）。
 *
 * 依据（ex-machina `HoEffect.cpp:5979` 的 `case EFFECT_AGING`，逐行对应）：
 * <pre>
 *   SetDynLight(x, y, z, 255, 255, 255, 255, 200, 1);   // 白色动态光
 *   pos.y += 10000;                                      // ★ 向上抬（raw ⇒ ÷FONE 才是世界单位）
 *   g_NewParticleMgr.Start("aging", pos);                // `.part` 脚本 aging
 * </pre>
 * 资产：`effect/particle/script/aging.part`（同目录还有 `agingbody.part` / `agingbody4.part`，
 * 是**它内部引用**的子件，不用单独播）。
 *
 * 触发点：原版是**服务端广播的用户命令** `smCOMMNAD_USER_AGINGUP`（`netplay.cpp:7290-7298`）
 * —— 附近的人都播这记特效 + `esPlaySound(7, GetDistVolume(...), 1600)`（编号 7 与**升级**是同一记音）。
 * 所以本文件的 `runAgeUpFx` 由 `main.ts` 的 `ageUpBroadcast` 分支调用，**自己与旁观者都播**。
 *
 * ⚠ 与升级特效（`levelup-runner.ts`）不同，这里**没有逐帧状态**：一记 `.part` 系统 + 一盏会自己衰减的
 * 动态光，播完即止 ⇒ 不需要 `update()`，只需要在换图/退出时由调用方 `clearAgeUpFx()` 断掉引用。
 * （升级那套要逐帧推，是因为它的粒子是**我们自己**按路径算的；这里是原版脚本自己算。）
 */
export interface AgeUpDeps {
  /** 特效管理器（`.part`/INI 都经它派发）；缺了只放动态光并上报 */
  fx: EffectManager | null;
  /** 动态光池（原版 `SetDynLight`）；没接就跳过并上报 */
  dynLights?: { set(x: number, y: number, z: number, r: number, g: number, b: number,
                    a: number, power: number, decPower: number): void | boolean } | null;
  /** 诊断（实验室日志面板） */
  log?: (msg: string) => void;
}

/** 原版 `pos.y += 10000`（raw）→ 世界单位 */
export const AGEUP_LIFT = 10000 / FONE;
/** `.part` 脚本名（`effect/particle/script/aging.part`） */
export const AGEUP_PART = 'aging';

let deps: AgeUpDeps | null = null;

export function runAgeUpFx(d: AgeUpDeps, feet: { x: number; y: number; z: number }): void {
  deps = d;
  const pos = { x: feet.x, y: feet.y + AGEUP_LIFT, z: feet.z };
  d.log?.(`  ⚒ 锻造特效：锚点 = 脚下 +${AGEUP_LIFT.toFixed(1)}（原版 pos.y += 10000）`
    + ` @ (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)})`);

  // ① 白色动态光（power 200 / dec 1）—— 参数逐字来自源码
  if (d.dynLights) {
    d.dynLights.set(pos.x, pos.y, pos.z, 255, 255, 255, 255, 200, 1);
  } else {
    reportFallback('fx', '锻造特效的 SetDynLight(255,255,255,255,200,1) 没放：调用方没给动态光池');
  }

  // ② `.part` 脚本 "aging"（原版 `g_NewParticleMgr.Start("aging", pos)`）
  if (d.fx) {
    void d.fx.spawn(AGEUP_PART, { pos });
  } else {
    reportFallback('fx', '锻造特效的 aging 粒子没放：调用方没给特效管理器（fx）');
  }
}

/** 换图/退出世界时断掉引用（`.part` 系统由特效管理器自己 `clear()`）。 */
export function clearAgeUpFx(): void {
  deps = null;
}

/** 诊断：最近一次是否拿到了依赖（验证脚本用） */
export function ageUpFxReady(): boolean {
  return !!deps?.fx;
}
