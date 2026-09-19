/**
 * B4 写者工厂（行 [21]）—— `ROTATION_WRITER_BY_TYPE` 的实现入口：
 * 按 ParticleType 返回**唯一**的 rotation 写者（§G1：每类型一个写者，并存即违规）。
 * TYPE_FOUR ⇒ **null**（行 [21]/[19]：Trail 不承载横截面朝向 = 无 rotation 写者；
 * LocalAngle 的读出与字面渲染器助手在 orient-four.ts 的 PtOrientFour 上，不经本工厂）。
 * TYPE_FIVE ⇒ null（行 [22]：其两个行为由转换层直接挂，不走本工厂）。
 */
import type { PtFaceType } from './plugin-api.js';
import { type OrientOpts } from './orient-shared.js';
import { PtOrientOne } from './orient-one.js';
import { PtOrientTwo } from './orient-two.js';
import { PtOrientThree } from './orient-three.js';

export type PtOrientBehavior = PtOrientOne | PtOrientTwo | PtOrientThree;

export function rotationWriterFor(type: PtFaceType, opts: OrientOpts): PtOrientBehavior | null {
  switch (type) {
    case 'TYPE_ONE': return new PtOrientOne(opts);
    case 'TYPE_TWO': return new PtOrientTwo(opts);
    case 'TYPE_THREE': return new PtOrientThree(opts);
    case 'TYPE_FOUR': return null;
    case 'TYPE_FIVE': return null;
  }
}
