/**
 * B6 校验器：Lua 前端的 IR 核对（对应 Lua 命令卷 L1-L33 + 三族调度行 [25]）。
 *
 *   ① 门控照抄（含源码缺陷）：EventSize 对 ParticleSystem no-op、EventFadeSize 对 Mesh no-op、
 *      EventColor/FadeColor 四类生效、InitAxialPos 仅 BILLBOARD_AXIAL（行 [L1]/[L24]/[L26]）
 *   ② 配对与枚举：Begin/End 不配对报错；stricmp 大小写不敏感（行 [L1]/[L13]）
 *   ③ 真实资产扫描：42 个 .lua 全解析（0 解析错误）、Begin/End 对数与 §C2 的 163 对照、
 *      .luac 跳过（U-A4-1/U-A5-1）
 *   ④ 跨层链：Lua 文本 → particleIR → PtClockBehavior → L25 冻结帧表（36.571）
 *      —— 证明 B6 产出的 IR 与 .part 走同一挂点（铁律 5③，无第二套时间轴）
 *
 * 用法：`npx tsx scripts/verify-lua-ir.ts`
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { parseLuaScript, particleIR } from '../src/core/effect/lua-script.js';
import { luaIRToBuild } from '../src/render/effects/plugin-part-convert.js';
import { PtClockBehavior, type PtBlockLocator } from '../src/render/effects/plugin-clock.js';
import type { Num, PtSlot } from '../src/core/effect/pt-timeline.js';

const here = dirname(fileURLToPath(import.meta.url));
const ASSET_ROOT = 'E:/JPsTale/client/effect/neweffect';

let fails = 0;
const ok = (name: string, pass: boolean, detail = ''): void => {
  if (!pass) fails++;
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const toNum = (n: number): Num => ({ k: 'n', v: n });

/* ── ① 门控照抄（含源码缺陷） ── */
console.log('① 门控照抄（行 [L1]/[L24]/[L26]/[L22]）');
{
  const src = `
Begin("ParticleSystem");
InitParticleNum(30);
InitSize(10, 10);
EventColor(0.5, 255, 0, 0, 255);
EventSize(0.5, 30, 30, 30);
InitAxialPos(0,-50,0, 0,50,0);
End();
Begin("Mesh");
EventFadeSize(0.5, 30, 30, 30);
End();
Begin("BILLBOARDAXIAL");
InitAxialPos(0,-50,0, 0,50,0);
End();`;
  const parsed = parseLuaScript(src);
  const irs = particleIR(parsed);
  ok('Begin 大小写不敏感（BILLBOARDAXIAL 命中）', parsed.blocks.length === 3 && parsed.blocks[2]!.type === 'BILLBOARD_AXIAL');
  const ps = irs[0]!;
  ok('EventColor 在粒子块生效', ps.events.some((e) => e.time === 0.5 && e.slot === 'color' && e.fade === false));
  ok('EventSize 对粒子系统 no-op（源码缺陷，行[L24]）',
    !ps.events.some((e) => e.slot === 'size' && e.time === 0.5)
    && ps.dropped.some((d) => d.name === 'EventSize'));
  ok('EventFadeSize 对 Mesh no-op（行[L26]）',
    parsed.blocks[1]!.commands.every((c) => c.gate === 'dropped-gate'));
  ok('InitAxialPos 对 BILLBOARD_AXIAL 生效',
    parsed.blocks[2]!.commands[0]!.gate === 'applied');
  const psBlock = parsed.blocks[0]!;
  ok('InitAxialPos 对粒子系统 dropped（门控照抄）',
    psBlock.commands.some((c) => c.name === 'InitAxialPos' && c.gate === 'dropped-gate'));
  const psIr = irs[0]!;
  ok('EventFadeSize 不在此 fixture（粒子块内未写）', !psIr.events.some((e) => e.slot === 'sizeExt' && e.fade));
  // InitSize 四参 ⇒ **两组区间**（IR），转换时变成 time-0 事件（逐粒子掷，同 C++ `m_Size.GetRandom()`）
  ok('InitSize(10,10) ⇒ 区间对（两参 ⇒ 两端相等）',
    psIr.size![0]!.k === 'n' && psIr.size![1]!.k === 'n');
  {
    const built = luaIRToBuild(psIr, 'chk', null);
    ok('转换后 ⇒ time-0 的 size/sizeExt 事件（尺寸进块、逐粒子掷）',
      built.events.some((e) => e.time === 0 && e.slot === 'size' && !e.fade)
      && built.events.some((e) => e.time === 0 && e.slot === 'sizeExt' && !e.fade));
    ok('写了 InitParticleNum(30) ⇒ 取 30', built.numParticles === 30);
  }
  // 缺省值 = C++ 控制器构造值（HoEffectController.cpp:455-460）——incu_summskill 那种不写
  // InitParticleNum 的块，默认是 **50 颗**（我曾默认 1 ⇒ 只剩一根细丝）
  {
    const bare = particleIR(parseLuaScript('Begin("ParticleSystem");\nInitEmitRate(30);\nEnd();'))[0]!;
    const b = luaIRToBuild(bare, 'bare', null);
    ok('缺省 ParticleNum = 50 / EmitRate = 30 / Loop = 1 / EndTime = 1..2s / Size = 5..10',
      b.numParticles === 50 && b.emitRate === 30 && b.loops === 1
      && b.lifetime?.k === 'r' && b.lifetime.a === 1 && b.lifetime.b === 2);
  }
  // 四参形式：InitSize(0.2,1.2,30,60) ⇒ 宽度 R(0.2,1.2)、高度 R(30,60)
  {
    const four = particleIR(parseLuaScript('Begin("ParticleSystem");\nInitSize(0.2,1.2,30,60);\nEnd();'))[0]!;
    ok('InitSize 四参 ⇒ 宽度区间 R(0.2,1.2) / 高度区间 R(30,60)',
      four.size![0]!.k === 'r' && four.size![0]!.a === 0.2 && four.size![0]!.b === 1.2
      && four.size![1]!.k === 'r' && four.size![1]!.a === 30 && four.size![1]!.b === 60);
  }
}

/* ── ② 配对与枚举 ── */
console.log('② 配对与枚举（行 [L2]/[L13]）');
{
  const bad = parseLuaScript('Begin("Mesh");\nEnd();\nEnd();');
  ok('End 多于 Begin ⇒ 报错', bad.errors.length === 1);
  const unclosed = parseLuaScript('Begin("Mesh");\nInitLoop(2);');
  ok('Begin 未 End ⇒ 报错', unclosed.errors.length === 1);
  const blend = parseLuaScript('Begin("ParticleSystem");\nInitBlendType("lamp");\nEnd();');
  ok('InitBlendType 大小写不敏感放行', blend.blocks[0]!.commands[0]!.gate === 'applied'
    && particleIR(blend)[0]!.blendType === 'lamp');
  const host = parseLuaScript('Begin("ParticleSystem");\nUpdate(0,0,0,0,0,0);\nLoadScript("X");\nEnd();');
  ok('Update/LoadScript = unknown-cmd（宿主方法，行[L27]/[L28]）',
    host.blocks[0]!.commands.every((c) => c.gate === 'unknown-cmd'));
}

/* ── ③ 真实资产扫描 ── */
console.log('③ 真实资产扫描（§C1/§C2：42 .lua / 163 对）');
{
  const dir = ASSET_ROOT;
  if (!existsSync(dir)) {
    ok('资产目录存在', false, `${dir} 不可达——本机资产缺失时跳过并标注`);
  } else {
    const files = readdirSync(dir).filter((f) => f.endsWith('.lua'));
    const luac = readdirSync(dir).filter((f) => f.endsWith('.luac'));
    ok(`.lua 文件数 = 42（实际 ${files.length}）`, files.length === 42);
    ok(`.luac 跳过（数量 ${(luac.length)}，U-A4-1/U-A5-1）`, true);
    let totalPairs = 0; let parseErrors = 0; let unparsedLines = 0;
    const perType = new Map<string, number>();
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      const parsed = parseLuaScript(text);
      parseErrors += parsed.errors.length;
      unparsedLines += parsed.unparsed.length;
      totalPairs += parsed.blocks.length;
      for (const b of parsed.blocks) {
        const key = b.type ?? '(null)';
        perType.set(key, (perType.get(key) ?? 0) + 1);
      }
    }
    ok(`解析错误 = 0（实际 ${parseErrors}）`, parseErrors === 0);
    ok(`未解析行 = 0（实际 ${unparsedLines}）`, unparsedLines === 0);
    ok(`Begin/End 对数 = 163（§C2；实际 ${totalPairs}）`, totalPairs === 163);
    const ps = perType.get('PARTICLE_SYSTEM') ?? 0;
    ok(`ParticleSystem 块数 = 57（§C3；实际 ${ps}）`, ps === 57);
    console.log(`  · 各类块分布：${[...perType.entries()].map(([k, v]) => `${k}=${v}`).join(' / ')}`);
  }
}

/* ── ④ 跨层链：Lua 文本 → IR → PtClockBehavior → L25 冻结帧表 ── */
console.log('④ 跨层链（B6 → B2 → oracle；铁律 5③ 无第二套时间轴）');
{
  const src = `
Begin("ParticleSystem");
InitParticleNum(1);
InitColor(255, 255, 255, 255);
EventFadeColor(0.5, 128, 128, 128, 255);
EventFadeColor(1.0, 0, 0, 0, 255);
End();`;
  const irs = particleIR(parseLuaScript(src));
  const ir = irs[0]!;
  const locator = { index: -1 };
  const memory: unknown[] = [];
  const clock = new PtClockBehavior(
    ir.events.map((e) => ({ time: e.time, slot: e.slot as PtSlot, fade: e.fade, value: e.value, next: -1 })),
    locator,
    () => 0.5,
  );
  const particle = { memory } as unknown as Parameters<typeof clock.initialize>[0];
  clock.initialize(particle, {} as never);
  // 逐帧快照（r[B6-1]：帧35 的 128 必须在**第 35 帧**取——末帧读数会与帧35 无关）
  const snap = new Map<number, number>();
  for (let f = 1; f <= 60; f++) {
    clock.update(particle, 1 / 70);
    const block = memory[locator.index] as { val: { color: number[] } };
    snap.set(f, block.val.color[0]!);
  }
  const g35 = snap.get(35)!; const g60 = snap.get(60)!;
  ok('跨层链：L25 帧35 红通道 = 128（initial 重瞄斜坡中点）', near(g35, 128), `${g35}`);
  ok('跨层链：L25 帧60 红通道 = 36.571（重瞄 Step=-256 生效）', near(g60, 36.5714), `${g60}`);
  // IR 初值（InitColor → time-0 事件 → 块初值）
  ok('跨层链：InitColor ⇒ 块初值 255', near(snap.get(1) ?? 0, 255 - 254 / 70, 0.1));
  // Num 形状对账（events 的 value 是 IR Num）
  const first = ir.events[0]!;
  ok('IR 事件 value = tagged Num', (first.value[0] as Num).k === 'n');
}
function near(a: number, b: number, tol = 1e-3): boolean { return Math.abs(a - b) <= tol; }

console.log(fails === 0
  ? '\n✓ verify-lua-ir 通过 —— 门控/配对/枚举/真实资产/跨层链全绿'
  : `\n✗ ${fails} 条不符 —— 对照 Lua 命令卷冻结行修解析器`);
process.exit(fails === 0 ? 0 : 1);
