/**
 * **伤害数字打击感纯逻辑验证** —— dmg-fx.ts 不含 DOM/three，脚本直接 import 即可。
 *
 * 验四件事：
 *   1. 弹跳曲线：起点=峰值 S、终点恰好 1、全程过 1 之下的 overshoot、单调性按"先降后升"
 *      （u=0.5 处恰好是 1，所以**不能用中点分两段**，用最小索引切分 —— 设计 §5）；
 *   2. 方向：攻击者在左 → 向右漂（dx>0）、在右 → 左、在下 → 上，重合 → null，模长 1；
 *   3. 漂移缓动 easeOutCubic 端点与单调性；
 *   4. 弹落弧线 popArc：先弹到 upPeak、末段加速落到 -dropDepth，两段各自单调；
 *   5. 配置：get/set/reset 往返，set 只动指定项。
 *
 * 用法：`npx tsx scripts/verify-dmgfx.ts`
 */
let fail = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) fail++;
};

const { bounceScale, easeIn, easeOutCubic, popArc, dirFromTo, dmgFxGet, dmgFxSet, dmgFxReset } = await import('../src/render/dmg-fx.js');

console.log('\n① 弹跳曲线 bounceScale');
{
  const S = 1.8, bm = 140;
  ok(bounceScale(0, 0, S, bm) === S, `el=0 → 峰值 ${S}`);
  ok(bounceScale(140 + 0, 0, S, bm) === 1, 'el=bounceMs → 恰好 1（无精度尾巴）');
  ok(bounceScale(1000, 0, S, bm) === 1, 'el 超过 bounceMs 后恒为 1');
  ok(bounceScale(-50, 0, S, bm) === S, 'el<0 截断到峰值 S（不猜）');
  const samples: number[] = [];
  for (let i = 0; i <= 50; i++) samples.push(bounceScale(i * 2.8, 0, S, bm));   // u 0..1, step 0.02
  ok(samples.every(Number.isFinite), '无 NaN');
  let minIdx = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i] < samples[minIdx]) minIdx = i;
  ok(minIdx > 0 && minIdx < samples.length - 1, `存在低于起点(含<1)的谷底（idx=${minIdx}）`);
  ok(samples[minIdx] < 1, 'overshoot：谷底低于 1');
  ok(samples[0] === S && samples[samples.length - 1] === 1, '两端正确：首=S 尾=1');
  const before = samples.slice(0, minIdx + 1), after = samples.slice(minIdx);
  ok(before.every((v, i) => i === 0 || before[i - 1] >= v), '谷前单调不增');
  ok(after.every((v, i) => i === 0 || after[i - 1] <= v), '谷后单调不减');
}
console.log('\n② 方向 dirFromTo');
{
  const aL = dirFromTo(100, 100, 200, 100)!;
  ok(aL && aL.x > 0, '攻击者在左 → 向右漂（dx>0）');
  ok(Math.abs(aL.y) < 1e-9, '水平对齐 → 无垂直分量');
  ok(Math.abs(Math.hypot(aL.x, aL.y) - 1) < 1e-9, '模长 = 1');
  ok(dirFromTo(200, 100, 100, 100)!.x < 0, '攻击者在右 → 向左漂');
  ok(dirFromTo(100, 200, 100, 100)!.y < 0, '攻击者在下方 → 向上漂');
  ok(dirFromTo(100, 100, 100, 100) === null, '双端重合 → null（保持垂直上飘）');
}
console.log('\n③ 漂移缓动 easeOutCubic');
{
  ok(easeOutCubic(0) === 0 && easeOutCubic(1) === 1, '端点 0/1');
  ok(Math.abs(easeOutCubic(0.5) - 0.875) < 1e-12, '0.5 → 0.875');
  let mono = true;
  for (let i = 1; i <= 200; i++) {
    const p = easeOutCubic(i / 200), q = easeOutCubic((i - 1) / 200);
    if (p < q) mono = false;
  }
  ok(mono, '单调不减');
}
console.log('\n④ 弹落弧线 popArc');
{
  const up = 46, down = 22;
  ok(popArc(0, up, down) === 0, 'u=0 → 起点（零偏移）');
  ok(popArc(1, up, down) === -down, 'u=1 → 落到起点下方 dropDepth');
  const samples: number[] = [];
  for (let i = 0; i <= 100; i++) samples.push(popArc(i / 100, up, down));
  ok(samples.every(Number.isFinite), '全程无 NaN');
  ok(samples[35] === up, '边界连续（u=riseA 处已达 upPeak）');
  ok(samples.every((v) => v <= up + 1e-9), '不超过弹起高度');
  const a = samples.slice(0, 36), b = samples.slice(35);   // 上升/下落两段各自单调（35 处重合）
  ok(a.every((v, i) => i === 0 || a[i - 1] <= v), '上升段单调（easeOut：0 → upPeak）');
  ok(b.every((v, i) => i === 0 || b[i - 1] >= v), '下落段单调（加速，含跨过 0 后继续向下）');
  ok(b.some((v) => v < 0), '下落段确实越过了头顶（y 偏移变负）');
  ok(easeIn(0) === 0 && easeIn(1) === 1 && easeIn(0.5) === 0.25, 'easeIn 端点/0.5');
}
console.log('\n⑤ 配置 get/set/reset');
{
  const before = dmgFxGet();
  dmgFxSet({ scaleCrit: 9.9 });
  const afterSet = dmgFxGet();
  ok(afterSet.scaleCrit === 9.9, 'set 生效');
  ok(afterSet.scaleNormal === before.scaleNormal, 'set 只动指定项');
  dmgFxReset();
  const afterReset = dmgFxGet();
  ok(afterReset.scaleCrit === before.scaleCrit && JSON.stringify(afterReset) === JSON.stringify(before), 'reset 还原默认');
}

console.log(fail ? `\n✗ ${fail} 项失败` : '\n✓ 全部通过');
process.exit(fail ? 1 : 0);