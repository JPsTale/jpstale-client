/**
 * B3 数值/向量出生生成器的 IR 适配器（值时间层行 [5] 的 native 路径）——
 * 把 IR 的 `Num`/`Vec3`（pt-value 的 tagged 形状）转成 quarks 的原生出生生成器：
 *
 *   · 数值：定值 → `ConstantValue`；区间 → `IntervalValue`（startGen 出生掷一次，行 [5]）
 *   · 向量：`Vector3Function(IntervalValue×3)` —— 三轴各自区间出生掷
 *     （Vector3Function.startGen 转发三轴，行 [5] 目标侧已核）
 *
 * 挂点：startLife / startSize / startSpeed 等 quarks 出生字段（§G1——出生写者仍是 quarks）。
 * 注意：这是 `part-to-quarks.ts` 里 `numGen` 的正式化版本（铁律 5：.part 与 Lua 共用同一批，
 * 新代码一律从这里取，不再各自手写）。
 */
import { ConstantValue, IntervalValue, Vector3Function } from 'quarks.core';
import type { Num, Vec3 } from '../../core/effect/pt-value.js';

export type BirthNum = ConstantValue | IntervalValue;

export function numBirthGen(n: Num | null | undefined, fallback = 0): BirthNum {
  if (!n) return new ConstantValue(fallback);
  return n.k === 'n' ? new ConstantValue(n.v) : new IntervalValue(n.a, n.b);
}

export function vector3BirthGen(v: Vec3 | null | undefined, fallback = 0): Vector3Function {
  const zero: Num = { k: 'n', v: fallback };
  const x = v?.x ?? zero; const y = v?.y ?? zero; const z = v?.z ?? zero;
  return new Vector3Function(numBirthGen(x), numBirthGen(y), numBirthGen(z));
}
