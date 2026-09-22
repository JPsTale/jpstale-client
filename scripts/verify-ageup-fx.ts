/**
 * 锻造特效（`EFFECT_AGING`）的回归 —— `npm run verify-ageup-fx`。
 *
 * 为什么单独一条：这个特效的每个数都是**从源码抄的**（`HoEffect.cpp:5979`），
 * 抄错一个（比如把 `pos.y += 10000` 写成 += 1000、或动态光参数顺序弄反）在画面上
 * 表现为"特效位置/亮度不对"，而**不会报错**。这里用假的 fx/dynLights 把调用形状钉死。
 */
import { AGEUP_LIFT, AGEUP_PART, runAgeUpFx, clearAgeUpFx } from '../src/render/effects/ageup-runner.js';

let failed = 0;
function check(name: string, cond: boolean, detail: string): void {
  if (cond) { console.log(`  ok   ${name}`); return; }
  console.log(`  FAIL ${name} ${detail ? '—— ' + detail : ''}`);
  failed++;
}

// ① 常量：`pos.y += 10000`(raw) ÷ FONE；`.part` 名就是 "aging"
// ⚠ 断言要写**具体数值**：第一版我写成"接近 10000/256 **或者** > 0"，那是个永远能过的假守卫
check('AGEUP_LIFT = 10000 / FONE = 39.0625', Math.abs(AGEUP_LIFT - 39.0625) < 1e-9, `实际=${AGEUP_LIFT}`);
check('part 名 = aging（资产 effect/particle/script/aging.part）', AGEUP_PART === 'aging', AGEUP_PART);

// ② 调用形状：动态光 9 个实参逐字来自 `SetDynLight(x,y,z,255,255,255,255,200,1)`；粒子在"脚下 + LIFT"
{
  const lights: number[][] = [];
  const spawned: { name: string; pos: { x: number; y: number; z: number } }[] = [];
  const fx = {
    spawn: (name: string, opts: { pos: { x: number; y: number; z: number } }) => {
      spawned.push({ name, pos: opts.pos });
      return Promise.resolve(true);
    },
  };
  const dynLights = { set: (...a: number[]) => { lights.push(a); } };
  runAgeUpFx({ fx: fx as never, dynLights, log: () => {} }, { x: 100, y: 50, z: -20 });

  check('放了 1 盏动态光', lights.length === 1, `实际=${lights.length}`);
  const L = lights[0] ?? [];
  check('动态光参数 = (x, y+LIFT, z, 255,255,255,255, 200, 1)',
    L[0] === 100 && Math.abs(L[1]! - (50 + AGEUP_LIFT)) < 1e-9 && L[2] === -20
    && L[3] === 255 && L[4] === 255 && L[5] === 255 && L[6] === 255 && L[7] === 200 && L[8] === 1,
    JSON.stringify(L));
  check('播了 1 个 aging 粒子', spawned.length === 1 && spawned[0]!.name === 'aging',
    JSON.stringify(spawned));
  check('粒子锚点 = 脚下 + LIFT（原版 pos.y += 10000）',
    Math.abs(spawned[0]!.pos.y - (50 + AGEUP_LIFT)) < 1e-9, JSON.stringify(spawned[0]!.pos));
  check('x/z 不变（只有 y 抬高）', spawned[0]!.pos.x === 100 && spawned[0]!.pos.z === -20, '');
  clearAgeUpFx();
}

// ③ 缺依赖时**不静默**：fx=null 仍放动态光、dynLights=null 仍放粒子（各自上报一次）
{
  const spawned: string[] = [];
  const fx = { spawn: (n: string) => { spawned.push(n); return Promise.resolve(true); } };
  runAgeUpFx({ fx: fx as never, dynLights: null, log: () => {} }, { x: 0, y: 0, z: 0 });
  check('没给动态光池时仍播粒子（降级可见）', spawned.length === 1, `实际=${spawned.length}`);
  clearAgeUpFx();
}

console.log(failed === 0 ? '\n锻造特效：全部通过' : `\n锻造特效：${failed} 条失败`);
process.exit(failed === 0 ? 0 : 1);
