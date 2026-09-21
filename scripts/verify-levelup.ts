/**
 * **升级特效（原版 `EFFECT_LEVELUP1`）的结构闸门** —— 钉住"组成/数量/位置/时间/运动"五件事。
 *
 * 为什么要有它：这一记特效**不是一个资产**，而是四组东西按帧序号拼起来的（见
 * `render/effects/levelup-runner.ts` 顶部逐字源码）。此前我方实现只"把四枚 INI 各放一遍、
 * 都摆在身体中部" ⇒ 数量（原版 20/5/5/5）、环半径（82.03~117.19）、±y 偏移（−3.9 / +11.7）、
 * 起始帧（25/30/35/40/45 与 0/5/10/15/20）、以及代码驱动的运动全都不对。
 *
 * 本脚本**不加载任何资产**（不需要渲染器/网络）：用**桩 spawner** 记录 `runLevelUpFx` 的调用参数，
 * 并用纯函数断言几何与位移规律；飞行用 `updateLevelUpFx` 逐 tick 推进来量到达时刻。
 *
 * 用法：`npm run verify-levelup`
 */
import * as THREE from 'three';
import {
  runLevelUpFx, updateLevelUpFx, clearLevelUpFx, levelUpFxCounts,
  levelUpRingSpawns, levelUpBandOffsetPx,
  LEVELUP_LIFT, PATH_COUNT, PATH_RADIUS_BASE, PATH_RADIUS_STEP, PATH_Y_SPREAD, PATH_DEST_DROP,
  PATH_SPEED_PER_TICK, PATH_SPEED_PER_SEC, PATH_STOP_DIST, PATH_SIZE_X, PATH_SIZE_Y, PATH_INI,
  FLASH_COUNT, FLASH_START_FRAME, FLASH_FRAME_STEP, FLASH_JITTER_RAW, FLASH_INI,
  BAND_COUNT, BAND_FRAME_STEP, BAND_Y_RAW, BAND_SIZE_X, BAND_SIZE_Y, BAND_OFFSET_PX0,
  BAND_LIFE_TICKS, BAND_INI_LEFT, BAND_INI_RIGHT,
} from '../src/render/effects/levelup-runner.js';
import { FONE, PT_ANGLE_FULL } from '../src/core/geom.js';
import { EFFECT_HZ } from '../src/render/effects/ini-to-quarks.js';

let fails = 0;
const ok = (label: string, cond: boolean): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

console.log('[校验 1] 常量 = 源码 ÷ FONE（raw → 世界单位）');
ok(`LEVELUP_LIFT = 32（playsub.cpp:1310 的 pY + 32*fONE）`, LEVELUP_LIFT === 32);
ok(`环半径基 = 21000/256 = ${PATH_RADIUS_BASE.toFixed(2)}`, near(PATH_RADIUS_BASE, 21000 / FONE));
ok(`环半径步 = 1000/256 = ${PATH_RADIUS_STEP.toFixed(3)}（rand()%10 档）`,
  near(PATH_RADIUS_STEP, 1000 / FONE));
ok(`y 抬高上限 = 10000/256 = ${PATH_Y_SPREAD.toFixed(2)}`, near(PATH_Y_SPREAD, 10000 / FONE));
ok(`落点下移 = 1000/256 = ${PATH_DEST_DROP.toFixed(3)}`, near(PATH_DEST_DROP, 1000 / FONE));
ok(`飞行速度 = 800/256 每 tick = ${PATH_SPEED_PER_TICK} ⇒ ${PATH_SPEED_PER_SEC}/s`,
  near(PATH_SPEED_PER_TICK, 800 / FONE) && near(PATH_SPEED_PER_SEC, (800 / FONE) * EFFECT_HZ));
ok('到达判定 = 同一常量 800/256（源码 `if (length < Speed)`）', near(PATH_STOP_DIST, PATH_SPEED_PER_TICK));
ok('粒子尺寸 7×23（`StartPathTri` 写死）', PATH_SIZE_X === 7 && PATH_SIZE_Y === 23);
ok('光带净抬高 = (-1000+4000)/256 = 11.72', near(BAND_Y_RAW / FONE, 3000 / FONE));
ok('光带尺寸 40×10', BAND_SIZE_X === 40 && BAND_SIZE_Y === 10);

console.log('\n[校验 2] 向心粒子的几何（20 颗、环半径、y 递增剖面、角度步长 204）');
{
  const base = { x: 0, y: 0, z: 0 };
  // `rand()` 取满 10 档（0..9），覆盖半径的上下界
  let i = 0;
  const seq = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const ring = levelUpRingSpawns(base, () => seq[i++ % seq.length]!);
  ok(`颗数 = ${PATH_COUNT}`, ring.length === PATH_COUNT);
  const radii = ring.map((s) => Math.hypot(s.cur.x - base.x, s.cur.z - base.z));
  ok(`半径 ∈ [${Math.min(...radii).toFixed(2)}, ${Math.max(...radii).toFixed(2)}]`
    + ` = [21000, 30000]/256 = [82.03, 117.19]`,
    near(Math.min(...radii), 21000 / FONE, 1e-6) && near(Math.max(...radii), 30000 / FONE, 1e-6));
  const ys = ring.map((s) => s.cur.y);
  // ⚠ 下界**不是 0**：y 抬高 = `GetCos[ang % ANGLE_90]`，而 ang 是 204 的整数倍 ⇒
  //   `ang % 1024` 取不到正好 90°（256）那个点 ⇒ 最小抬高是"最接近 90°"那一档的余弦（≈0.24 单位）。
  //   原版就是这个剖面；这里只钉住"上界 = 39.06、下界 ∈ [0,1]、且**非零**（确实是剖面而非常量）"。
  ok(`y 抬高 ∈ [${Math.min(...ys).toFixed(2)}, ${Math.max(...ys).toFixed(2)}]（上界 = 10000/256，下界近 0）`,
    near(Math.max(...ys), PATH_Y_SPREAD, 1e-6) && Math.min(...ys) >= 0 && Math.min(...ys) < 1);
  ok('落点全 = 基点（向心收拢）',
    ring.every((s) => near(s.dest.x, base.x) && near(s.dest.y, base.y) && near(s.dest.z, base.z)));
  // 角度步长：第 1 与第 0 颗的方位角差 = 204/4096 圈
  const a0 = Math.atan2(ring[0]!.cur.z - base.z, ring[0]!.cur.x - base.x);
  const a1 = Math.atan2(ring[1]!.cur.z - base.z, ring[1]!.cur.x - base.x);
  const step = (a1 - a0 + Math.PI * 2) % (Math.PI * 2);
  ok(`相邻方位角步长 = ${((step / (Math.PI * 2)) * PT_ANGLE_FULL).toFixed(1)} 单位`
    + `（源码整数除法 ANGLE_360/20 = 204）`,
    near((step / (Math.PI * 2)) * PT_ANGLE_FULL, 204, 1e-3));
}

console.log('\n[校验 3] 光带的屏幕位移律（`HoEtcPrimitiveBillboardMove::Main`）');
{
  ok('tick 0..3 = 原点偏移 ±230px', levelUpBandOffsetPx(0, -1).x === -BAND_OFFSET_PX0
    && levelUpBandOffsetPx(3, -1).x === -BAND_OFFSET_PX0 && levelUpBandOffsetPx(0, 1).x === BAND_OFFSET_PX0);
  ok('tick 4 收到 ±195（Step 35）', Math.abs(levelUpBandOffsetPx(4, -1).x) === 195);
  ok('tick 8 收到 ±163（Step 32）', Math.abs(levelUpBandOffsetPx(8, -1).x) === 163);
  let stop = -1;
  for (let t = 0; t <= 200; t++) if (stop < 0 && levelUpBandOffsetPx(t, -1).x === 0) stop = t;
  ok(`收到 0 的时刻 = 第 ${stop} tick（原版 Step 35→4 的斜坡算得 56 ≈ 0.8s）`, stop === 56);
  ok('停下后 45 tick 内不上漂', levelUpBandOffsetPx(stop + 45, -1).y === 0);
  ok(`停下后第 ${stop + 46} tick 开始上漂（-2px/tick）`, levelUpBandOffsetPx(stop + 46, -1).y === -2);
  ok('左右符号相反', levelUpBandOffsetPx(4, -1).x === -levelUpBandOffsetPx(4, 1).x);
}

console.log('\n[校验 4] 组装：桩 spawner 记录调用（数量 / 名字 / 尺寸 / 起始帧 / 循环）');
{
  interface Call { name: string; opts: Record<string, unknown>; stoppable: boolean }
  const calls: Call[] = [];
  const fx = {
    spawn: async (name: string, opts: Record<string, unknown>) => { calls.push({ name, opts, stoppable: false }); return true; },
    spawnStoppable: async (name: string, opts: Record<string, unknown>) => {
      calls.push({ name, opts, stoppable: true });
      return { stop: () => { /* 桩 */ } };
    },
  };
  const scene = new THREE.Scene();
  const lights: number[][] = [];
  clearLevelUpFx();
  runLevelUpFx({
    fx: fx as never,
    scene,
    dynLights: { set: (...a: number[]) => { lights.push(a); } },
    camera: null,                    // 无相机 ⇒ 光带不做屏幕位移（会上报一次）
    viewport: () => ({ width: 1000, height: 800 }),
    log: () => {},
  }, { x: 100, y: 200, z: 300 });

  const paths = calls.filter((c) => c.name === PATH_INI);
  const flashes = calls.filter((c) => c.name === FLASH_INI);
  ok(`① 动态光 1 记 = SetDynLight(150,150,150,255,200,1)`,
    lights.length === 1 && lights[0]!.slice(3).join(',') === '150,150,150,255,200,1');
  ok(`② ${PATH_INI} × ${paths.length}（= ${PATH_COUNT}）`, paths.length === PATH_COUNT);
  ok('② 每颗都 loop=true（原版 ANI_LOOP —— 不循环则 43ms 的帧飞一半就没了）',
    paths.every((c) => c.opts.loop === true));
  ok('② 尺寸 7×23（sizeY 单独给）', paths.every((c) => c.opts.size === 7 && c.opts.sizeY === 23));
  ok('② 挂载体 + rigidFollow（整团搬运）',
    paths.every((c) => !!c.opts.attach && c.opts.rigidFollow === true));
  ok(`③ ${FLASH_INI} × ${flashes.length}（= ${FLASH_COUNT}）`, flashes.length === FLASH_COUNT);
  // 闪光的 y 用的是**`y -= 1000` 之后**的基点（源码在 `y += 4000` 之前）—— 别写成锚点
  ok(`③ 闪光基点 y = 脚下 + 32 - 3.906 = ${(200 + LEVELUP_LIFT - PATH_DEST_DROP).toFixed(2)}`,
    flashes.every((c) => {
      const y = (c.opts.pos as { y: number }).y;
      return y >= 200 + LEVELUP_LIFT - PATH_DEST_DROP && y <= 200 + LEVELUP_LIFT - PATH_DEST_DROP + FLASH_JITTER_RAW / FONE;
    }));
  ok(`③ 起始帧 = 25/30/35/40/45（delaySec = 帧/70）`,
    flashes.map((c) => Math.round((c.opts.delaySec as number) * EFFECT_HZ)).join(',')
      === [25, 30, 35, 40, 45].join(','));
  const t0 = levelUpFxCounts();
  ok(`④ 载体已建：向心 ${t0.paths}（= ${PATH_COUNT}）、光带 ${t0.bands}（= 2×${BAND_COUNT}）`,
    t0.paths === PATH_COUNT && t0.bands === 2 * BAND_COUNT);
  ok('④ 此刻**还没**生光带的系统（原版 `AddObject(obj, index*5)` = 到帧才出现）',
    calls.filter((c) => c.name === BAND_INI_LEFT || c.name === BAND_INI_RIGHT).length === 0);
  // 推进 1 tick ⇒ 第 0 帧那对应出现
  updateLevelUpFx(1 / EFFECT_HZ);
  const left = calls.filter((c) => c.name === BAND_INI_LEFT);
  const right = calls.filter((c) => c.name === BAND_INI_RIGHT);
  ok(`④ 第 0 帧那对已生（左 ${left.length} + 右 ${right.length}）`, left.length === 1 && right.length === 1);
  ok('④ 尺寸 40×10', [...left, ...right].every((c) => c.opts.size === 40 && c.opts.sizeY === 10));
  ok('④ 挂载体 + rigidFollow（位移由我们每帧按像素换算后给载体）',
    [...left, ...right].every((c) => !!c.opts.attach && c.opts.rigidFollow === true));
  ok(`④ 载体基准 y = 脚下(200) + 32 + 11.72 = ${(200 + LEVELUP_LIFT + BAND_Y_RAW / FONE).toFixed(2)}`,
    near((left[0]!.opts.attach as THREE.Object3D).position.y, 200 + LEVELUP_LIFT + BAND_Y_RAW / FONE, 1e-6));
  ok(`④ 光带寿命 = ${BAND_LIFE_TICKS} tick（levelup1left/right.ini 的 Delay 40+40+80）`,
    BAND_LIFE_TICKS === 160);

  console.log('\n[校验 4b] 第二次升级（全局 tick 已经非零）—— 起始帧必须相对本次');
  {
    // 先放一次并推到全清（tick 因此涨到几百）
    calls.length = 0;
    runLevelUpFx({ fx: fx as never, scene, dynLights: null, camera: null,
      viewport: () => ({ width: 1000, height: 800 }), log: () => {} }, { x: 0, y: 0, z: 0 });
    let t = 0;
    while (t < 400 && (levelUpFxCounts().paths > 0 || levelUpFxCounts().bands > 0)) {
      updateLevelUpFx(1 / EFFECT_HZ); t++;
    }
    const tickBefore = levelUpFxCounts().tick;
    ok(`第一次特效已全部退役（tick 已涨到 ${tickBefore.toFixed(0)}）`,
      levelUpFxCounts().paths === 0 && levelUpFxCounts().bands === 0 && tickBefore > 100);
    // 第二次：只有第 0 帧那对该在这 1 tick 内生，其余 9 条要等到各自的帧
    calls.length = 0;
    runLevelUpFx({ fx: fx as never, scene, dynLights: null, camera: null,
      viewport: () => ({ width: 1000, height: 800 }), log: () => {} }, { x: 0, y: 0, z: 0 });
    updateLevelUpFx(1 / EFFECT_HZ);
    const l2 = calls.filter((c) => c.name === BAND_INI_LEFT).length;
    const r2 = calls.filter((c) => c.name === BAND_INI_RIGHT).length;
    ok(`第二次只生第 0 帧那对（左 ${l2} + 右 ${r2}）—— 起始帧若用全局绝对值，这里会是 5+5`,
      l2 === 1 && r2 === 1);
    ok('第二次的 10 条载体都还在（没有被"立刻退役"）', levelUpFxCounts().bands === 2 * BAND_COUNT);
    for (let k = 0; k < 20; k++) updateLevelUpFx(1 / EFFECT_HZ);
    ok('第 20 tick 时五对都已生（左 5 + 右 5）',
      calls.filter((c) => c.name === BAND_INI_LEFT).length === BAND_COUNT
      && calls.filter((c) => c.name === BAND_INI_RIGHT).length === BAND_COUNT);
    clearLevelUpFx();
  }

  console.log('\n[校验 5] 推进：直线匀速（每 tick 3.125）、到达时刻 ∈ 环半径/速度');
  {
    // 自己起一次（校验 4/4b 的那批已被 clear 掉）
    runLevelUpFx({ fx: fx as never, scene, dynLights: null, camera: null,
      viewport: () => ({ width: 1000, height: 800 }), log: () => {} }, { x: 100, y: 200, z: 300 });
    const carriers = scene.children.filter((o) => o.name === 'levelup-path');
    const start = carriers.map((c) => c.position.clone());
    const base = new THREE.Vector3(100, 200 + LEVELUP_LIFT - PATH_DEST_DROP, 300);
    // 先走 1 tick：位移必须**恰好**是 3.125，且方向 = 起点→落点（直线，无侧向）
    updateLevelUpFx(1 / EFFECT_HZ);
    const after1 = carriers.map((c) => c.position.clone());
    const stepLens = after1.map((p, i) => p.distanceTo(start[i]!));
    ok(`第 1 tick 位移 = ${stepLens[0]!.toFixed(4)}（应 ${PATH_SPEED_PER_TICK}）`,
      stepLens.every((d) => near(d, PATH_SPEED_PER_TICK, 1e-6)));
    const dirToDest = base.clone().sub(start[0]!).normalize();
    const dirMoved = after1[0]!.clone().sub(start[0]!).normalize();
    ok('位移沿"起点→落点"直线（无侧向分量）', near(dirMoved.dot(dirToDest), 1, 1e-6));

    // 推到全部退役（退役 = 到达 + 4 tick）
    let ticks = 1;
    while (ticks < 120 && levelUpFxCounts().paths > 0) { updateLevelUpFx(1 / EFFECT_HZ); ticks++; }
    const arrive = ticks - 4;
    ok(`到达时刻 ≈ 第 ${arrive} tick ⇒ ${(arrive / EFFECT_HZ).toFixed(2)}s`
      + `（环半径 82.03~117.19 ÷ 3.125 = 26.3~37.5）`, arrive >= 26 && arrive <= 38);
    ok('到达后载体全部摘除（paths = 0）', levelUpFxCounts().paths === 0);
    // 光带：到 160 tick 寿命后应全部摘除
    while (ticks < 400 && levelUpFxCounts().bands > 0) { updateLevelUpFx(1 / EFFECT_HZ); ticks++; }
    ok('光带在第 160 tick（寿命）后全部退役', levelUpFxCounts().bands === 0);
  }
  clearLevelUpFx();
}

console.log(fails === 0 ? '\n✅ 全部通过' : `\n✗ ${fails} 条不符`);
process.exit(fails === 0 ? 0 : 1);
