/**
 * 确定性哈希原语（**零依赖**：core 层不 import 任何东西，见 ARCHITECTURE.md 第 3 节）。
 *
 * 为什么单独成一个模块：它有两个互不相干的用途 —— `char/anim-match.ts` 的 `seededPick`
 * （从候选里确定性取一条动画变体）与 `render/monster-visibility.ts` 的每秒轮换
 * （按 (怪 id, 时间片) 排序取前 N）。放在任何一边都会让另一边拖上一堆无关依赖
 * （anim-match 会拉进 MB 级的数据表），放这里两边都只 import 一个纯函数。
 */
export function mix32(seed: number): number {
  let t = ((seed >>> 0) + 0x6D2B79F5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}
