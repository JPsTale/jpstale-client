/**
 * B3 颜色生成器（值时间层行 [5] 的 plugin 部分）—— 依据冻结文档：
 *
 *   · 行 [5]：颜色**出生掷** quarks 原生不覆盖（`RandomColor.genColor` 每次调用重掷 ⇒ 挂在
 *     ColorOverLife 下就是逐帧变色）⇒ 自实现 `FunctionColorGenerator`，照 `IntervalValue`
 *     的内存协议（startGen 掷一次、genColor 只读）；
 *   · **出生掷只发生一次**：startGen 解析四通道区间并存下结果，genColor 永不再掷
 *     （r[B1-7] 期实测的同类错误：急切求值会逐帧消费 rand）；
 *   · 行 [L4]：读出 0..255 → 0..1，startColor 恒白当乘法单位元（ColorOverLife 会相乘）；
 *   · 单通道（redcolor 等）：.part 侧是**事件**（走行 [2] 的块写入，块是四分量），初值单通道
 *     由装配层并进 RGBA 初值——不设独立生成器（L32 差异栏已登记该决定）。
 */
import type { FunctionColorGenerator, FunctionJSON, GeneratorMemory, Vector4 } from 'quarks.core';
import type { Rgba } from '../../core/effect/pt-value.js';
import { roll } from '../../core/effect/pt-timeline.js';
import type { Rand } from '../../core/effect/pt-timeline.js';

/** sRGB（8bit 美术色）→ 线性（裁定 B 顶点色解码；与 plugin-value-gen 同式） */
function srgbToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** IR 的 RGBA（各分量定值或区间，0..255） */
export type RgbaNum = Rgba;

export class PtColorBirthGen implements FunctionColorGenerator {
  type = 'function' as const;
  private slot = -1;
  /** 出生时解析好的四通道（0..255）——genColor 只读它，永不再掷 */
  private born: [number, number, number, number] | null = null;

  constructor(
    private readonly a: RgbaNum,
    private readonly b: RgbaNum,
    private readonly rand: Rand = Math.random,
  ) {}

  /** 行 [5]：出生掷一次（IntervalValue 内存协议——槽下标对同轨所有粒子一致） */
  startGen(memory: GeneratorMemory): void {
    this.slot = memory.length;
    memory.push(this.rand());
    this.born = [
      roll(this.a.r, this.rand), roll(this.a.g, this.rand),
      roll(this.a.b, this.rand), roll(this.a.a, this.rand),
    ];
  }

  genColor(memory: GeneratorMemory, color: Vector4, _t?: number): Vector4 {
    // born 为 null = startGen 未被调（接线 bug）——回退区间中点并保持确定性，不掷
    const mid = (n: Rgba['r']): number => (n.k === 'n' ? n.v : (n.a + n.b) / 2);
    const c = this.born ?? [mid(this.a.r), mid(this.a.g), mid(this.a.b), mid(this.a.a)];
    // 裁定 B：8bit sRGB 美术色 → 解码到线性（输出端编码回来）；alpha 线性直用
    color.set(srgbToLinear(c[0]!), srgbToLinear(c[1]!), srgbToLinear(c[2]!), c[3]! / 255);
    void memory; void this.slot;
    return color;
  }

  toJSON(): FunctionJSON { return { type: 'PtColorBirthGen' } as unknown as FunctionJSON; }
  clone(): PtColorBirthGen { return new PtColorBirthGen(this.a, this.b, this.rand); }
}
