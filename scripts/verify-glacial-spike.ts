/**
 * **Glacial Spike 接线与几何验证** —— 不依赖浏览器，直接跑纯逻辑部分。
 *
 * 验三件事：
 *   1. 派表接线：`MONSTER_ATTACK_FX[0x1960].skillByKeyCode.Z` 指向带 `code` 的那条，
 *      且 `CODE_SKILL_FX.glacialspike` 已注册（实验室与游戏都靠这一条）；
 *   2. 几何：5 个粒子系统与网格/蓝光的落点（按施法者朝向旋转后），
 *      以及"越远越大"是否成立（40 → 50 → 60）；
 *   3. 网格资产与文字贴图能被解析到（路径真实存在）。
 *
 * 用法：`npx tsx scripts/verify-glacial-spike.ts`
 */
import fs from 'node:fs';
import path from 'node:path';

const ASSET = process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client';
let fail = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) fail++;
};

const { MONSTER_ATTACK_FX, resolveMonsterFx, isSkillSet } = await import('../src/render/effects/monster-attack-fx.js');
const { CODE_SKILL_FX } = await import('../src/render/effects/skill-fx-runner.js');

console.log('① 派表接线');
const entry = MONSTER_ATTACK_FX[0x1960];
ok(!!entry && isSkillSet(entry), 'D_PR(0x1960) 是多技能怪（skillByKeyCode）');
const z = isSkillSet(entry!) ? entry.skillByKeyCode.Z : undefined;
ok(!!z, "skillByKeyCode['Z'] 已登记");
ok(z?.code === 'glacialspike', `'Z' 的 code = ${z?.code}（应为 glacialspike）`);
const resolved = resolveMonsterFx(0x1960, 'Z'.charCodeAt(0));
ok(resolved?.code === 'glacialspike', 'resolveMonsterFx(0x1960, "Z") 解到同一条');
ok(typeof CODE_SKILL_FX.glacialspike === 'function', 'CODE_SKILL_FX.glacialspike 已注册');
for (const k of ['O', 'H', 'Z']) {
  const d = isSkillSet(entry!) ? entry.skillByKeyCode[k] : undefined;
  ok(!!d, `D_PR 的 '${k}' 有登记（${d?.code ?? d?.asset ?? '—'}）`);
}

console.log('\n② 几何（施法者朝向 = 0 与 = 90°，验证"前方"随朝向旋转）');
for (const deg of [0, 90]) {
  const spawned: Array<{ x: number; y: number; z: number }> = [];
  let light: number[] | null = null;
  const { runGlacialSpike } = await import('../src/render/effects/glacial-spike.js');
  runGlacialSpike(
    {
      effects: { spawnSystem: (_s: unknown, o: { pos: { x: number; y: number; z: number } }) => { spawned.push(o.pos); return null; } },
      scene: { add: () => { /* node 里没有 fetch ⇒ 网格会走"加载失败"分支（已上报） */ } },
      dynLights: { set: (...a: number[]) => { light = a; return true; } },
      log: () => { /* 静音：下面自己打表 */ },
    } as never,
    { x: 0, y: 0, z: 0 },
    (deg * Math.PI) / 180,
  );
  // 落点 = Parent(前方 20) + 各自的前方档 {0,40,0,50,100} ⇒ 前方分量应为 {20,60,20,70,120}
  // 前方 = three 的 rotation.y 约定（`getMoveLocation(0,0,d,0,angY,0)` 化简后 = `d·sin/d·cos`，
  // 与 three 的局部 +z 一致 ⇒ 0° 走 +z、90° 走 +x）
  const fwd = spawned.map((p) => (deg === 0 ? p.z : p.x));
  const side = spawned.map((p) => (deg === 0 ? p.x : p.z));
  console.log(`    朝向 ${deg}°：前方分量 = ${fwd.map((v) => v.toFixed(0)).join(', ')}`
    + `　侧向分量 = ${side.map((v) => v.toFixed(0)).join(', ')}`);
  ok(spawned.length === 5, `朝向 ${deg}°：起了 ${spawned.length} 个粒子系统（应 5）`);
  ok(fwd.slice().sort((a, b) => a - b).join(',') === '20,20,60,70,120',
    `朝向 ${deg}°：前方档 = 20/60/20/70/120（Parent 20 + 0/40/0/50/100）`);
  ok(side.every((v) => Math.abs(v) < 1), `朝向 ${deg}°：无侧偏（原始 Lua 各系统的 x 都是 0）`);
  ok(!!light && (light as number[])[5] === 100 && (light as number[])[7] === 700,
    `蓝光 = ${light ? (light as number[]).slice(3).join(',') : '未设'}（应含 b=100 / power=700）`);
}

console.log('\n①b 网格与"越远越大"（按尺寸排）+ 名字唯一性');
{
  const sizes: number[] = [];
  const names: string[] = [];
  const { runGlacialSpike } = await import('../src/render/effects/glacial-spike.js');
  runGlacialSpike(
    {
      effects: { spawnSystem: (s: { name: string; emitters: Array<{ initialSize?: { v: number } }> }) => {
        names.push(s.name);
        sizes.push(s.emitters[0]?.initialSize?.v ?? 0); return null; } },
      scene: { add: () => {} }, dynLights: null, log: () => {},
    } as never,
    { x: 0, y: 0, z: 0 }, 0,
  );
  const big = sizes.filter((s) => s >= 40);
  ok(big.join(',') === '40,50,60', `大冰块尺寸 = ${big.join(',')}（应 40,50,60 ⇒ 越远越大）`);
  // ⚠ **名字必须逐条唯一**：`quarks-runtime.spawnSystem` 用 `system.name` 作 systemCache 的键 ——
  //    同名时只有第一条被建出来、其余命中缓存拿到同一份 spec
  //    （用户实测："三个冰块同时出现、而且在同一位置"就是它）。
  ok(new Set(names).size === names.length,
    `5 条 spec 名字互不相同（实际：${names.join(', ')}）`);
}

console.log('\n③ 资产');
for (const p of ['effect/neweffect/res/object/pt_4-1-25.smd', 'effect/neweffect/res/texturehit/ice_001.bmp']) {
  ok(fs.existsSync(path.join(ASSET, p)), `${p} 存在`);
}

console.log(`\n${fail === 0 ? '全部通过' : `✗ ${fail} 项未通过`}`);
process.exit(fail === 0 ? 0 : 1);
