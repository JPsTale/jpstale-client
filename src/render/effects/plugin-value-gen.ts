/**
 * B2 值生成器插件（值时间层行 [2]/[5] 的读出侧）—— 依据冻结文档：
 *
 *   · 行 [2]【映射】：`PtValueGen implements FunctionValueGenerator`——genValue **忽略 quarks
 *     传入的 t**（age/life 与原版事件钟是两个时间基），只读 memory 块里的当前值返回；
 *   · 行 [5]：颜色出生掷 quarks 原生不覆盖（RandomColor 是逐帧重掷）⇒ 颜色读出侧也走块；
 *   · 行 [20]：size 的写者 = PtSizeBehavior（后续卡），本生成器是它和渲染侧的读出口。
 *
 * 挂点（行 [2]）：数值轨 → SizeOverLife.size 等 `FunctionValueGenerator` 槽位；
 * 颜色轨 → ColorOverLife.color（`FunctionColorGenerator`，读出后与 startColor 相乘——
 * startColor 恒白当乘法单位元，行 [L4]）。块未就绪（spawn 早于行为 initialize）时回退
 * 构造时的 fallback——不静默，回退值即"无事件时的 C++ 默认"（[S13]）。
 */
import type { FunctionColorGenerator, FunctionJSON, FunctionValueGenerator, GeneratorMemory, Vector4 } from 'quarks.core';
import type { PtGroup } from '../../core/effect/pt-timeline.js';
import { blockOf, type PtBlockLocator } from './plugin-clock.js';

/** sRGB（8bit 美术色）→ 线性——裁定 B 的顶点色解码（贴图由 colorSpace 标记承担同一件事） */
export function srgbToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 数值轨读出：genValue 忽略 t、只读块（行 [2]） */
export class PtValueGen implements FunctionValueGenerator {
  type = 'function' as const;
  constructor(
    private readonly locator: PtBlockLocator,
    private readonly group: PtGroup,
    private readonly comp: number,
    private readonly fallback = 0,
  ) {}

  startGen(_memory: GeneratorMemory): void { /* 初值由 PtClockBehavior 的 ActualTime==0 事件写入（行 [1]）——只掷一次 */ }

  genValue(memory: GeneratorMemory, _t?: number): number {
    const b = blockOf(memory, this.locator);
    return b ? b.val[this.group]![this.comp]! : this.fallback;
  }

  toJSON(): FunctionJSON { return { type: 'PtValueGen', group: this.group, comp: this.comp } as unknown as FunctionJSON; }
  clone(): PtValueGen { return new PtValueGen(this.locator, this.group, this.comp, this.fallback); }
}

/** 颜色轨读出（0..255 块值 → 0..1 写给 ColorOverLife；startColor 恒白，行 [L4]） */
export class PtColorGen implements FunctionColorGenerator {
  type = 'function' as const;
  constructor(
    private readonly locator: PtBlockLocator,
    private readonly fallback: [number, number, number, number] = [255, 255, 255, 255],
  ) {}

  startGen(_memory: GeneratorMemory): void { /* 初值由 ActualTime==0 的 color 事件写入 */ }

  genColor(memory: GeneratorMemory, color: Vector4, _t?: number): Vector4 {
    const b = blockOf(memory, this.locator);
    const c = b ? b.val.color : this.fallback;
    // 裁定 B：块内 0..255 是 **sRGB 美术色**——顶点属性没有自动解码，必须在这里
    // 解码到线性（输出端会编码回来）⇒ 8bit 值一来一回 ≈ 美术原样；alpha 永远线性直用
    color.x = srgbToLinear(c[0]!); color.y = srgbToLinear(c[1]!);
    color.z = srgbToLinear(c[2]!); color.w = c[3]! / 255;
    return color;
  }

  toJSON(): FunctionJSON { return { type: 'PtColorGen' } as unknown as FunctionJSON; }
  clone(): PtColorGen { return new PtColorGen(this.locator, this.fallback); }
}
