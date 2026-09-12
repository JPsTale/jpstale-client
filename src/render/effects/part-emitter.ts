/**
 * `.part` 粒子发射器运行时。
 *
 * 渲染不走 Points（点精灵只能朝向相机且必须正方形），而是**每个 emitter 一个动态四边形网格**：
 * 按粒子的 TYPE 在 JS 里算四个角，宽高分别取 `size` / `sizeExt`。
 *
 * 四种面的几何取自 NewSourcePT-2023 `HoBaram/HoNewParticle.cpp:3128-3174` 的派发：
 *   TYPE_ONE   → AddFace2DBillBoard  朝向相机的广告牌
 *   TYPE_TWO   → AddFace2dPlane      水平 XZ 平面（顶点 (x±w, y, z±h)）—— 我方 183/376 属此类
 *   TYPE_THREE → AddFaceThree        竖直条带（(0,±h,0) 再按角度旋转）→ 柱状朝相机
 *   TYPE_FOUR  → AddFaceTrace        拖尾（本版按 ONE 近似，拖尾待补）
 *
 * 已知精简（同文件头说明）：
 *  - TYPE_FOUR 的拖尾未实现，暂按广告牌渲染
 *  - 多关键帧 `fade so at N` 未实现，只做 initial → final 的线性插值
 *  - `loops`/`delay` 只支持单轮（重复发射按 loops 次连发）
 */
import * as THREE from 'three';
import { roll, type PartEmitter, type PartSystem, type Rgba, type Vec3 } from '../../core/effect/part-script.js';
import type { PartBlend } from '../../core/effect/part-script.js';
import type { LoadedPart } from './part-assets.js';

/** 原版角度单位：360° = ANGEL_360 */
const DEG = Math.PI / 180;

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

function rgbaOf(c: Rgba): [number, number, number, number] {
  return [roll(c.r) / 255, roll(c.g) / 255, roll(c.b) / 255, roll(c.a) / 255];
}

function vecOf(v: Vec3): [number, number, number] {
  return [roll(v.x), roll(v.y), roll(v.z)];
}

/* ─────────── 混合（同 INI 特效的因子表，见 effect-manager.ts） ─────────── */

function applyPartBlend(mat: THREE.ShaderMaterial, b: PartBlend): void {
  switch (b) {
    case 'lamp':
      mat.blending = THREE.AdditiveBlending;
      mat.blendSrc = THREE.SrcAlphaFactor; mat.blendDst = THREE.OneFactor;
      mat.blendSrcAlpha = THREE.SrcAlphaFactor; mat.blendDstAlpha = THREE.OneFactor;
      break;
    case 'alpha':
      mat.blending = THREE.NormalBlending;
      break;
    case 'color':
      mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation;
      mat.blendSrc = THREE.SrcColorFactor; mat.blendDst = THREE.OneMinusSrcColorFactor;
      mat.blendSrcAlpha = THREE.SrcAlphaFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      break;
    case 'shadow':
      mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation;
      mat.blendSrc = THREE.ZeroFactor; mat.blendDst = THREE.SrcColorFactor;
      mat.blendSrcAlpha = THREE.ZeroFactor; mat.blendDstAlpha = THREE.SrcAlphaFactor;
      break;
    case 'invshadow':
      mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation;
      mat.blendSrc = THREE.ZeroFactor; mat.blendDst = THREE.OneMinusSrcColorFactor;
      mat.blendSrcAlpha = THREE.ZeroFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      break;
  }
}

const VERT = /* glsl */`
attribute vec4 aColor;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vColor = aColor;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uUseMap;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vec4 tex = mix(vec4(1.0), texture2D(uMap, vUv), uUseMap);
  vec4 c = vec4(tex.rgb * vColor.rgb, tex.a * vColor.a);
  if (c.a < 0.003) discard;
  gl_FragColor = c;
}`;

/** 一个 emitter 的粒子实例 */
interface EmitterInstance {
  emitter: PartEmitter;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  geom: THREE.BufferGeometry;
  /** 生成原点（系统位置 + `.part` 的 position） */
  origin: [number, number, number];
  /** 尺寸倍率 */
  scale: number;
  /** 每个粒子的状态 */
  n: number;
  alive: Uint8Array;
  age: Float32Array;
  life: Float32Array;
  pos: Float32Array;      // n*3
  vel: Float32Array;      // n*3
  size0: Float32Array; size1: Float32Array;      // 初始宽/高
  fsize0: Float32Array; fsize1: Float32Array;    // 末态宽/高
  col0: Float32Array; col1: Float32Array;        // n*4 初始/末态颜色
  angle0: Float32Array; fangle: Float32Array;    // 旋转（弧度）
  /** 发射进度 */
  spawned: number;
  emitAcc: number;
  delayLeft: number;
  loopsLeft: number;
  done: boolean;
}

export interface PartRuntime {
  /** 播放一个 `.part` 系统 */
  spawn(part: LoadedPart, pos: { x: number; y: number; z: number }, scale: number): void;
  update(dt: number, camera: THREE.Camera): void;
  clear(): void;
  stats(): { emitters: number; particles: number };
}

export function createPartRuntime(scene: THREE.Scene): PartRuntime {
  const root = new THREE.Group();
  root.name = 'parts';
  scene.add(root);

  const live: EmitterInstance[] = [];
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();

  function buildEmitter(
    em: PartEmitter, tex: THREE.DataTexture | null,
    origin: [number, number, number], scale: number,
  ): EmitterInstance {
    const n = Math.max(1, Math.min(2048, Math.round(em.numParticles)));
    const geom = new THREE.BufferGeometry();
    const verts = new Float32Array(n * 4 * 3);
    const uvs = new Float32Array(n * 4 * 2);
    const cols = new Float32Array(n * 4 * 4);
    const idx = new Uint16Array(n * 6);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      uvs.set([0, 0, 1, 0, 0, 1, 1, 1], o * 2);
      idx.set([o, o + 1, o + 2, o + 2, o + 1, o + 3], i * 6);
    }
    geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setAttribute('aColor', new THREE.BufferAttribute(cols, 4));
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    geom.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uUseMap: { value: tex ? 1 : 0 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    });
    applyPartBlend(mat, em.blend);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = false;   // 顶点每帧在 CPU 改动，包围盒不可靠
    root.add(mesh);

    // 系统级 position + 生成位置偏移（原版：粒子位置 = 生成原点 + emitRadius 滚动）
    return {
      emitter: em, mesh, mat, geom, origin, scale, n,
      alive: new Uint8Array(n),
      age: new Float32Array(n), life: new Float32Array(n),
      pos: new Float32Array(n * 3), vel: new Float32Array(n * 3),
      size0: new Float32Array(n), size1: new Float32Array(n),
      fsize0: new Float32Array(n), fsize1: new Float32Array(n),
      col0: new Float32Array(n * 4), col1: new Float32Array(n * 4),
      angle0: new Float32Array(n), fangle: new Float32Array(n),
      spawned: 0, emitAcc: 0, delayLeft: Math.max(0, em.delay),
      loopsLeft: Math.max(1, Math.round(em.loops)), done: false,
    };
  }

  /** 生成一个粒子（复刻 CreateNewParticle：区间滚动一次） */
  function birth(ei: EmitterInstance): void {
    const i = ei.spawned++;
    if (i >= ei.n) return;
    const em = ei.emitter;
    const origin = ei.origin;
    ei.alive[i] = 1;
    ei.age[i] = 0;
    ei.life[i] = Math.max(0.02, roll(em.lifetime));

    const emit = vecOf(em.emitRadius);
    ei.pos[i * 3] = origin[0]! + emit[0];
    ei.pos[i * 3 + 1] = origin[1]! + emit[1];
    ei.pos[i * 3 + 2] = origin[2]! + emit[2];

    const v = vecOf(em.initialVelocity);
    ei.vel[i * 3] = v[0]; ei.vel[i * 3 + 1] = v[1]; ei.vel[i * 3 + 2] = v[2];

    const s0 = em.initialSize ? roll(em.initialSize) : 10;
    const s1 = em.initialSizeExt ? roll(em.initialSizeExt) : s0;
    ei.size0[i] = s0; ei.size1[i] = s1;
    ei.fsize0[i] = em.finalSize ? roll(em.finalSize) : s0;
    ei.fsize1[i] = em.finalSizeExt ? roll(em.finalSizeExt) : (em.finalSize ? ei.fsize0[i]! : s1);

    const c0 = em.initialColor ? rgbaOf(em.initialColor) : [1, 1, 1, 1];
    const c1 = em.finalColor ? rgbaOf(em.finalColor) : [c0[0], c0[1], c0[2], 0];
    ei.col0.set(c0 as number[], i * 4);
    ei.col1.set(c1 as number[], i * 4);

    const a0 = em.initialPartAngle?.y !== undefined ? roll(em.initialPartAngle.y) * DEG : 0;
    const a1 = em.finalPartAngle?.y !== undefined ? roll(em.finalPartAngle.y) * DEG : a0;
    ei.angle0[i] = a0; ei.fangle[i] = a1;
  }

  function spawn(part: LoadedPart, pos: { x: number; y: number; z: number }, scale: number): void {
    const sysPos = part.system.position ? vecOf(part.system.position) : [0, 0, 0];
    const origin: [number, number, number] = [
      pos.x + sysPos[0]! * scale,
      pos.y + sysPos[1]! * scale,
      pos.z + sysPos[2]! * scale,
    ];
    for (let k = 0; k < part.system.emitters.length; k++) {
      const em = part.system.emitters[k]!;
      live.push(buildEmitter(em, part.textures[k] ?? null, origin, scale));
    }
  }

  function update(dt: number, camera: THREE.Camera): void {
    // 相机右/上轴（用于广告牌与柱状朝向）
    camera.matrixWorld.extractBasis(camRight, camUp, tmpA);

    for (let e = live.length - 1; e >= 0; e--) {
      const ei = live[e]!;
      const em = ei.emitter;
      const scale = ei.scale;

      // 发射：emitRate 个/秒，累计到 numParticles 上限；delay 后开始；loops 轮
      if (!ei.done) {
        if (ei.delayLeft > 0) ei.delayLeft -= dt;
        else if (ei.spawned < ei.n) {
          ei.emitAcc += em.emitRate * dt;
          while (ei.emitAcc >= 1 && ei.spawned < ei.n) { ei.emitAcc -= 1; birth(ei); }
        } else if (ei.loopsLeft > 1) { ei.loopsLeft--; ei.spawned = 0; ei.delayLeft = Math.max(0, em.delay); }
        else ei.done = true;
      }

      const posAttr = ei.geom.getAttribute('position') as THREE.BufferAttribute;
      const colAttr = ei.geom.getAttribute('aColor') as THREE.BufferAttribute;
      const P = posAttr.array as Float32Array;
      const C = colAttr.array as Float32Array;
      const g = vecOf(em.gravity);
      let anyAlive = false;

      for (let i = 0; i < ei.spawned; i++) {
        if (!ei.alive[i]) continue;
        ei.age[i]! += dt;
        const t = ei.age[i]! / ei.life[i]!;
        if (t >= 1) {
          ei.alive[i] = 0;
          // 收起：退化为零面积
          const o = i * 4 * 3;
          for (let v = 0; v < 4; v++) { P[o + v * 3] = 0; P[o + v * 3 + 1] = 0; P[o + v * 3 + 2] = 0; }
          continue;
        }
        anyAlive = true;

        // 运动：v += g*dt；p += v*dt
        ei.vel[i * 3] += g[0] * dt;
        ei.vel[i * 3 + 1] += g[1] * dt;
        ei.vel[i * 3 + 2] += g[2] * dt;
        ei.pos[i * 3] += ei.vel[i * 3]! * dt;
        ei.pos[i * 3 + 1] += ei.vel[i * 3 + 1]! * dt;
        ei.pos[i * 3 + 2] += ei.vel[i * 3 + 2]! * dt;

        const w = lerp(ei.size0[i]!, ei.fsize0[i]!, t) * 0.5 * scale;
        const h = lerp(ei.size1[i]!, ei.fsize1[i]!, t) * 0.5 * scale;
        const ang = lerp(ei.angle0[i]!, ei.fangle[i]!, t);
        const px = ei.pos[i * 3]!, py = ei.pos[i * 3 + 1]!, pz = ei.pos[i * 3 + 2]!;

        // 角的四个顶点：按 TYPE 决定朝向
        //   ONE   → 朝向相机的广告牌
        //   TWO   → 水平 XZ 平面（顶点 (x±w, y, z±h)）
        //   THREE → 竖直条带（绕相机 Y 轴朝向，再滚 ang）
        //   FOUR  → 暂按 ONE 近似（拖尾待补）
        const mode = em.particleType;
        const o = i * 4 * 3;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        if (mode === 2) {
          // 水平面：两条边沿世界 X / Z，按 ang 在 XZ 内旋转
          const ex = w * ca, ez = w * sa;
          const fx = -h * sa, fz = h * ca;
          P[o] = px - ex - fx; P[o + 1] = py; P[o + 2] = pz - ez - fz;
          P[o + 3] = px + ex - fx; P[o + 4] = py; P[o + 5] = pz + ez - fz;
          P[o + 6] = px - ex + fx; P[o + 7] = py; P[o + 8] = pz - ez + fz;
          P[o + 9] = px + ex + fx; P[o + 10] = py; P[o + 11] = pz + ez + fz;
        } else if (mode === 3) {
          // 竖直条带：宽度沿相机右轴，高度沿世界 Y（柱状）
          const rx = camRight.x, rz = camRight.z;
          const rl = Math.hypot(rx, rz) || 1;
          const ux = rx / rl, uz = rz / rl;
          const ex = ux * w * ca, ez = uz * w * ca;
          P[o] = px - ex; P[o + 1] = py - h; P[o + 2] = pz - ez;
          P[o + 3] = px + ex; P[o + 4] = py - h; P[o + 5] = pz + ez;
          P[o + 6] = px - ex; P[o + 7] = py + h; P[o + 8] = pz - ez;
          P[o + 9] = px + ex; P[o + 10] = py + h; P[o + 11] = pz + ez;
          void sa;
        } else {
          // 朝向相机：右轴/上轴 + 自转
          tmpA.copy(camRight).multiplyScalar(ca).addScaledVector(camUp, sa);
          tmpB.copy(camRight).multiplyScalar(-sa).addScaledVector(camUp, ca);
          P[o] = px - tmpA.x * w - tmpB.x * h; P[o + 1] = py - tmpA.y * w - tmpB.y * h; P[o + 2] = pz - tmpA.z * w - tmpB.z * h;
          P[o + 3] = px + tmpA.x * w - tmpB.x * h; P[o + 4] = py + tmpA.y * w - tmpB.y * h; P[o + 5] = pz + tmpA.z * w - tmpB.z * h;
          P[o + 6] = px - tmpA.x * w + tmpB.x * h; P[o + 7] = py - tmpA.y * w + tmpB.y * h; P[o + 8] = pz - tmpA.z * w + tmpB.z * h;
          P[o + 9] = px + tmpA.x * w + tmpB.x * h; P[o + 10] = py + tmpA.y * w + tmpB.y * h; P[o + 11] = pz + tmpA.z * w + tmpB.z * h;
        }

        // 颜色/透明度插值
        const c0 = (i * 4), c1 = (i * 4);
        const a = lerp(ei.col0[c0 + 3]!, ei.col1[c1 + 3]!, t);
        const r = lerp(ei.col0[c0]!, ei.col1[c1]!, t);
        const gg = lerp(ei.col0[c0 + 1]!, ei.col1[c1 + 1]!, t);
        const bb = lerp(ei.col0[c0 + 2]!, ei.col1[c1 + 2]!, t);
        for (let v = 0; v < 4; v++) {
          const q = (i * 4 + v) * 4;
          C[q] = r; C[q + 1] = gg; C[q + 2] = bb; C[q + 3] = a;
        }
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      ei.geom.setDrawRange(0, ei.spawned * 6);

      // 全部粒子消亡且发射完毕 → 回收
      if (ei.done && !anyAlive) {
        root.remove(ei.mesh);
        ei.geom.dispose();
        ei.mat.dispose();
        live.splice(e, 1);
      }
    }
  }

  function clear(): void {
    for (const ei of live) {
      root.remove(ei.mesh);
      ei.geom.dispose();
      ei.mat.dispose();
    }
    live.length = 0;
  }

  return {
    spawn,
    update,
    clear,
    stats: () => ({
      emitters: live.length,
      particles: live.reduce((s, ei) => s + ei.spawned, 0),
    }),
  };
}

export type { PartSystem };
