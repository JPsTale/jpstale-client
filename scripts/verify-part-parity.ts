/**
 * **`.part` 转换层等价性基线 / 对照**（这是"改运行时不许静默重做"的闸门）。
 *
 * 用法：
 *   npx tsx scripts/verify-part-parity.ts --capture   > src/render/effects/part-frames.baseline.json
 *   npx tsx scripts/verify-part-parity.ts             # 与基线逐帧比对，退出码非 0 = 有超容差差异
 *
 * 为什么要它：2026-09-18 我把运行时换成时间轴时**没有对照已稳定运行的实现**，连栽两次
 * （粒子跑到世界原点、陨石拖尾塌成光球）——用户指出这正是"重头再来"的代价。
 * 这个脚本用**同一套驱动**把某个实现的逐帧行为打出来：先用旧实现抓基线并入库，
 * 之后任何改动都要通过"与基线逐帧吻合（或差异被显式登记）"这一关。
 *
 * 驱动方式（模拟 quarks 的每帧流程）：
 *   形状 initialize → 各 behavior initialize → 每帧(1/70s)：behavior.update →
 *   position += velocity·dt·speedModifier → age += dt
 * ⚠ 随机数**种子化**：两侧必须掷同样的随机（否则比对无意义）。
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { parsePart } from '../src/core/effect/part-script.js';
import { convertPart, setBillboardCamera } from '../src/render/effects/part-to-quarks.js';

/** 固定假相机：`PtCameraFacingSpin` 等行为要用它算基底（否则它们早退 ⇒ 朝向采不到） */
const fakeCam = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
fakeCam.position.set(0, 10, -20);
fakeCam.lookAt(0, 0, 0);
fakeCam.updateMatrixWorld(true);
setBillboardCamera(fakeCam);

const BASELINE = path.resolve('src/render/effects/part-frames.baseline.json');
const CAPTURE = process.argv.includes('--capture');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

/**
 * **已登记的差异**（"改动必须显式登记"这一条的落地）：与基线不一致、但**有据可依**的条目。
 * key = `资产#发射器下标`；`why` 必须写清依据（源码行 / 用户判定），否则不许进这张表。
 */
const ALLOW_DIFF: Array<{ key: string; emitter: string; why: string }> = [];
const DT = 1 / 70;
const FRAMES = 70;
const SAMPLE_EVERY = 14;

/** 种子化随机（mulberry32）—— 两侧同种子 ⇒ 可比 */
function seedRandom(seed: number): void {
  let a = seed >>> 0;
  Math.random = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FakeP {
  position: THREE.Vector3; velocity: THREE.Vector3; size: THREE.Vector3;
  color: THREE.Vector4; rotation: unknown; life: number; age: number;
  memory: number[]; startSize: THREE.Vector3; startColor: THREE.Vector4;
  speedModifier: number; died: boolean;
}

function fake(mesh: boolean): FakeP {
  return {
    position: new THREE.Vector3(), velocity: new THREE.Vector3(), size: new THREE.Vector3(1, 1, 1),
    color: new THREE.Vector4(1, 1, 1, 1), rotation: mesh ? new THREE.Quaternion() : 0,
    life: 1, age: 0, memory: [], startSize: new THREE.Vector3(1, 1, 1),
    startColor: new THREE.Vector4(1, 1, 1, 1), speedModifier: 1, died: false,
  };
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** 抓一个资产的逐帧轨迹 */
function captureAsset(name: string): unknown {
  seedRandom(0x9e3779b9);                       // 每个资产固定种子
  const file = path.join('E:/JPsTale/client/effect/particle/script', `${name}.part`);
  if (!fs.existsSync(file)) return null;
  const conv = convertPart(parsePart(fs.readFileSync(file, 'utf8')), []);
  return conv.map((c, ei) => {
    try {
    const ps = c.system as unknown as {
      behaviors: Array<{ initialize?: (p: unknown, s?: unknown) => void; update?: (p: unknown, d: number) => void }>;
      shape?: { initialize?: (p: unknown) => void };
      startSize?: { genValue: (m: unknown, v?: unknown, t?: number) => THREE.Vector3 };
      startLife?: { genValue: (m: unknown) => number };
      rendererSettings?: { renderMode?: number };
    };
    const mesh = (ps.rendererSettings?.renderMode ?? 0) === 2;
    const p = fake(mesh);
    try { ps.startSize?.genValue(p.memory, p.startSize); } catch { /* 旧实现签名可能不同 */ }
    try { p.life = ps.startLife?.genValue(p.memory) ?? 1; } catch { p.life = 1; }
    p.startSize.copy(p.size);
    ps.shape?.initialize?.(p);
    for (const b of ps.behaviors) b.initialize?.(p, ps);
    const samples: number[][] = [];
    for (let f = 0; f <= FRAMES; f++) {
      if (f % SAMPLE_EVERY === 0) {
        // ⚠ **朝向也要采**（2026-09-18 教训：`localAngle` 收窄那条改动只影响 rotation，
        //   旧采样只有 size/color/position ⇒ 闸门看不见它 ⇒ 等于没闸门）
        const rot = p.rotation as { x?: number; y?: number; z?: number; w?: number } | number;
        const rotSample = typeof rot === 'number'
          ? [r3(rot)]
          : (rot && typeof rot.x === 'number'
            ? [r3(rot.x), r3(rot.y!), r3(rot.z!), r3(rot.w!)]
            : [0]);
        samples.push([
          f,
          r3(p.size.x), r3(p.size.y),
          r3(p.color.x), r3(p.color.y), r3(p.color.z), r3(p.color.w),
          r3(p.position.x), r3(p.position.y), r3(p.position.z),
          ...rotSample,
        ]);
      }
      for (const b of ps.behaviors) b.update?.(p, DT);
      p.position.addScaledVector(p.velocity, DT * p.speedModifier);
      p.age += DT;
    }
    return { emitter: c.emitterName, samples };
    } catch (e) {
      // **不许静默**：某个发射器在驱动时报错也记进基线/比对结果（否则"崩了"看起来像"没差异"）
      return { emitter: c.emitterName + `#THROW`, samples: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], err: String(e), ei };
    }
  });
}

function allAssets(): string[] {
  const out: string[] = [];
  for (const d of ['effect/particle/script', 'game/scripts/particles']) {
    const dir = path.join('E:/JPsTale/client', d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.part')) out.push(f.replace(/\.part$/, ''));
  }
  return out.sort();
}

const assets = ONLY ? [ONLY] : allAssets();
if (CAPTURE) {
  const out: Record<string, unknown> = {
    note: '旧实现（2026-09-18 回退后的 part-to-quarks）的逐帧行为基线：驱动方式见 scripts/verify-part-parity.ts。'
      + '随机已种子化；改动运行时后必须与本文件逐帧吻合，或把差异显式登记进 ALLOW_DIFF。',
    frames: FRAMES, sampleEvery: SAMPLE_EVERY, dt: r3(DT),
    assets: {},
  };
  const acc = out.assets as Record<string, unknown>;
  for (const a of assets) acc[a] = captureAsset(a);
  // ⚠ 直接写文件，**不能走 stdout** —— quarks 在 import 时会往 stdout 打启动横幅，会污染 JSON
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 0));
  console.error(`抓取完成：${assets.length} 个资产 → ${BASELINE}`);
} else {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as { assets: Record<string, unknown> };
  const bad: string[] = [];
  const throwLog: string[] = [];
  const allowed: string[] = [];
  let checked = 0;
  /** 逐**发射器**比对（比资产级细：一个资产里只有个别发射器该变时，别把整个资产放过） */
  for (const a of assets) {
    const want = base.assets[a] as Array<{ emitter?: string; err?: string; samples?: number[][] }> | null;
    if (want === undefined || want === null) continue;
    const got = captureAsset(a) as Array<{ emitter?: string; err?: string; samples?: number[][] }> | null;
    if (!Array.isArray(got)) { checked++; bad.push(a); continue; }
    for (let i = 0; i < Math.max(want.length, got.length); i++) {
      const w = want[i], g = got[i];
      if (g?.err) throwLog.push(`${a} / ${g.emitter}: ${g.err.split(String.fromCharCode(10))[0]}`);
      if (JSON.stringify(w) === JSON.stringify(g)) continue;
      const key = `${a}#${i}`;
      const hit = ALLOW_DIFF.find((d) => d.key === key && d.emitter === (g?.emitter ?? w?.emitter));
      if (hit) allowed.push(`${key} ${hit.emitter} —— ${hit.why}`);
      else { checked++; bad.push(`${a}#${i} ${g?.emitter ?? w?.emitter ?? '?'}`); }
    }
  }
  if (allowed.length) {
    console.log(`已登记放行的差异 ${allowed.length} 条：`);
    for (const t of allowed.slice(0, 6)) console.log('   ' + t);
    if (allowed.length > 6) console.log(`   … 另 ${allowed.length - 6} 条`);
  }
  if (throwLog.length) {
    console.log(`⚠ 新实现在驱动时抛错 ${throwLog.length} 处（前 5）：`);
    for (const t of throwLog.slice(0, 5)) console.log('   ' + t);
  }
  console.log(`比对 ${assets.length} 个资产（基线 ${Object.keys(base.assets).length} 个）：`
    + `${checked === 0 ? '✓ 全部逐帧吻合（或按登记放行）' : `✗ ${bad.length} 处不一致：${bad.slice(0, 12).join('、')}`}`
    + `${allowed.length ? `；登记放行 ${allowed.length} 处` : ''}`);
  process.exit(bad.length === 0 ? 0 : 1);
}
