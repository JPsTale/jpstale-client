/**
 * **神圣弹（Holy Bolt）回归**（`npm run verify-holy-bolt`）——
 * 用户 2026-09-28 "HolyBolt 这个技能还需要我再说一遍吗？"：横扫 `Svr_Damge.cpp` 祭司全部 case 后
 * 确认**伤害公式早已正确**（面板掷 ×(1+HolyBolt_Damage[p])%、禁暴击，`:3132-3136`），真正缺的是
 * **表现**（原版事件帧的 MONSTER_MEPHIT_SHOT2 飞出球，`character.cpp:13946-13957`，此前
 * `skill-fx.json` 的 event.fx 为空 ⇒ 施法只见动画+音效、没有球飞向目标）+ 服务端
 * AttackResult 漏带 skill_id。本脚本用**真模块**跑帧循环钉（每条都能红）：
 *
 *   A. **飞行与到站**：起点（前方24/上方24）→ 目标 +20，速度 1300 raw/帧（70fps 心跳）；
 *      50 单位距离 ≈ 10 tick 到站（± 武装余量 4）。
 *   B. **爆裂部件**：到站后 10 条光痕 + 4 颗火花进入场景（延迟 ≤4 帧后全部可见）。
 *   C. **清理**：全部播完后实例清零、场景 0 对象（AGENTS #111：固定池，帧内不 new/dispose）。
 *   D. **连发不累积**：3 发并发同样清干净。
 *   E. **数据链**：`skill-fx.json` 的 Holy Bolt 行 event.fx = ["code:holybolt"]、event.sfx 保留
 *      `holybolt 1.wav`；`CODE_SKILL_FX` 注册表有 `holybolt`。
 *   F. **资产在位**：Blue.tga / LineParticle1.tga / Particle1..3.tga（缺了运行时会显式上报不放）。
 */
import { installDomStub } from './dom-stub.js';

installDomStub();
let fails = 0;
const ok = (label: string, cond: boolean): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};

const THREE = (await import('three')).default ?? (await import('three'));
const { runHolyBolt, configureHolyBolt, updateHolyBoltRunners, clearHolyBolt, holyBoltStats,
  SHOT_START_FWD_WU, SHOT_START_UP_WU, TRACKER_SPEED_RAW } =
  await import('../src/render/effects/holy-bolt.js');
const { CODE_SKILL_FX } = await import('../src/render/effects/skill-fx-runner.js');
const { FONE, getMoveLocation, radToPtAngle } = await import('../src/core/geom.js');
const { readFileSync, existsSync } = await import('node:fs');
const { resolve } = await import('node:path');

// 贴图：假纹理即可（headless 无渲染，只用对象模型）
const dummyTex = (): THREE.Texture => new THREE.Texture();
configureHolyBolt({
  textures: {
    ball: dummyTex(),
    streak: dummyTex(),
    puffs: [dummyTex(), dummyTex(), dummyTex()],
  },
  camera: new THREE.PerspectiveCamera(60, 1.6, 0.1, 2000),
});

console.log('A/B/C. 真模块跑帧循环（70fps 心跳，速度 1300 raw/帧）');
{
  const scene = new THREE.Scene();
  const caster = { x: 100, y: 20, z: -30 };
  const yaw = 0.7;                       // 任意朝向
  const targetBody = { x: 130, y: 20 + 24, z: 10 };   // 身上点（脚底+24，调用方约定）
  const countObjects = (): number => {
    let n = 0;
    scene.traverse(() => { n++; });
    return n;   // 含 scene 本身
  };
  const base = countObjects();           // ⚠ 起手**前**量（一发球 = 根 + 30 个部件，别算进基准）
  runHolyBolt({ scene, log: () => {} }, caster, yaw, targetBody);

  // 起点复算（与实现同一公式：GetMoveLocation(0, 24, 24, 0, yaw, 0)）
  const mv = getMoveLocation(0, SHOT_START_UP_WU, SHOT_START_FWD_WU, 0, radToPtAngle(yaw), 0);
  const start = { x: caster.x + mv.x, y: caster.y + mv.y, z: caster.z + mv.z };
  const dist = Math.hypot(targetBody.x - start.x, targetBody.y - start.y, targetBody.z - start.z);
  const expectedTicks = dist / (TRACKER_SPEED_RAW / FONE);

  let arrivedAt = -1;
  let maxExtra = 0;
  const FPS = 70;
  const totalFrames = 200;   // 覆盖飞行(≈10) + 光痕(≈83+4) + 火花(≤14) + 余量
  for (let f = 1; f <= totalFrames; f++) {
    updateHolyBoltRunners(1 / FPS);
    const st = holyBoltStats();
    maxExtra = Math.max(maxExtra, countObjects() - base);
    if (arrivedAt < 0 && st.arrived) arrivedAt = f;
    if (st.live === 0) break;
  }
  ok(`A. 距离 ${dist.toFixed(1)} ⇒ ≈${expectedTicks.toFixed(1)} tick 到站（实测第 ${arrivedAt} tick）`,
    arrivedAt > 0 && arrivedAt >= Math.floor(expectedTicks) - 2 && arrivedAt <= Math.ceil(expectedTicks) + 4);

  const st = holyBoltStats();
  ok(`C. ${totalFrames} tick 后实例全部清零（残留 ${st.live}）`, st.live === 0);
  ok(`C. 清理后场景对象数复原（基准 ${base}，残留 ${countObjects()}）`, countObjects() === base);
  // 一发球的对象数 = 根(1) + 球池16 + 光痕10 + 火花4 = 31
  ok(`B/C. 峰值 = 一发的部件数（31；实测峰值 +${maxExtra}）`, maxExtra === 31);

  // D. 连发三发
  for (let i = 0; i < 3; i++) runHolyBolt({ scene }, caster, yaw, targetBody);
  for (let f = 0; f < totalFrames; f++) updateHolyBoltRunners(1 / FPS);
  ok('D. 连放 3 发后同样全部清干净', holyBoltStats().live === 0 && countObjects() === base);

  clearHolyBolt();
}

console.log('E. 数据链（overrides → skill-fx.json → 注册表）');
{
  const fx = JSON.parse(readFileSync(resolve('src/game/data/skill-fx.json'), 'utf-8')) as {
    rows: { name: string; event: { fx: string[]; sfx: string[] } }[];
  };
  const row = fx.rows.find((r) => r.name === 'Holy Bolt');
  ok('E1. skill-fx.json 的 Holy Bolt 行 event.fx = ["code:holybolt"]',
    !!row && row.event.fx.length === 1 && row.event.fx[0] === 'code:holybolt');
  ok('E2. event.sfx 保留 holybolt 1.wav（音效与特效并存，互不挤掉）',
    !!row && row.event.sfx.some((s) => s.includes('holybolt 1.wav')));
  ok('E3. CODE_SKILL_FX 注册表有 holybolt', typeof CODE_SKILL_FX['holybolt'] === 'function');
}

console.log('F. 资产在位（缺了运行时会显式上报不放，不静默）');
{
  const root = 'E:/JPsTale/client/effect/imagedata';
  const files = [
    `${root}/particle/blue.tga`,
    `${root}/monstermephit/lineparticle1.tga`,
    `${root}/monstermephit/particle1.tga`,
    `${root}/monstermephit/particle2.tga`,
    `${root}/monstermephit/particle3.tga`,
  ];
  for (const f of files) ok(`F. ${f.replace(root + '/', '')} 在位`, existsSync(f));
}

console.log(fails === 0 ? '\n全部通过 ✓' : `\n${fails} 条失败 ✗`);
process.exit(fails === 0 ? 0 : 1);
