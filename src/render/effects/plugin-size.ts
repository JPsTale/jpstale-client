/**
 * B3 尺寸行为（渲染与混合行 [20] 的实现）—— 依据冻结文档：
 *
 *   · 行 [20]：宽高两维独立；**`SizeExt == 0` 才回落 `Size`**（cpp:3115-3123 的 `!= 0` 判据，
 *     显式写 0 也回落）；TYPE_FOUR 的 SizeExt 是拖尾历史点数（行 [19]），不走本行为；
 *   · **替代 `SizeOverLife`**（同一字段只能一个写者，§G1/§F.2 硬结论）——
 *     SizeOverLife 是乘法（倍率轨道），装不下绝对值终点与 ==0 回落（行 [20] 反例：80≠40）；
 *   · 值来自行 [2] 的块（PtClockBehavior 写、本行为读——不抢字段）。
 */
import type { Behavior, IParticleSystem, Particle } from 'quarks.core';
import type { PtBlockLocator } from './plugin-clock.js';
import { blockOf } from './plugin-clock.js';

export class PtSizeBehavior implements Behavior {
  type = 'PtSize';
  constructor(
    private readonly locator: PtBlockLocator,
    /** 回退值：块未就绪（spawn 早于行为 initialize）时的 C++ 默认（[S13]：Size=1、SizeExt=0） */
    private readonly fallbackSize = 1,
  ) {}

  initialize(_particle: Particle, _ps: IParticleSystem): void { /* 块由 PtClockBehavior 建并写 */ }

  update(particle: Particle, _delta: number): void {
    const block = blockOf(particle.memory, this.locator);
    const size = block ? block.val.size[0]! : this.fallbackSize;
    const sizeExt = block ? block.val.sizeExt[0]! : 0;
    const height = sizeExt !== 0 ? sizeExt : size;      // cpp:3121-3123 的 `!= 0` 判据
    particle.size.x = size;
    particle.size.y = height;
    particle.size.z = 1;
  }

  frameUpdate(_delta: number): void { /* 逐粒子在 update 里做 */ }
  toJSON(): unknown { return { type: this.type }; }
  clone(): Behavior { return new PtSizeBehavior(this.locator, this.fallbackSize); }
  reset(): void { /* 状态在块里 */ }
}
