/**
 * MultiSpark 的**载体与依赖装配** —— 从怪物实验室抽出，实验室与游戏共用一份。
 *
 * 为什么单独成文件：`multi-spark.ts` 只算"怎么动"（纯函数、不碰 three），而"载体节点 + 场景 +
 * 三个回调怎么接"是**调用方的事**。实验室先写了这段，游戏要用同一份，否则就是第二份实现
 * （AGENTS #15；本项目的镜像双持、骨骼名判定都栽在这里）。
 *
 * 原版：`sinEffect_MultiSpark(pChar, desChar, Num)`（`sinSkillEffect.cpp:808`）——
 * **玩家与怪物共用同一个函数**，只有 `Num` 不同（玩家 7 / 怪物 5）。
 */

import * as THREE from 'three';
import {
  createMultiSpark, multiSparkSystem, multiSparkTrailSystem, multiSparkLightSystems,
  multiSparkBombSystem, MULTI_SPARK_BOMB, MULTI_SPARK_HIT_DYN_LIGHT, MULTI_SPARK_HIT,
  type MultiSparkHandle, type Vec3,
} from './multi-spark.js';
import type { PartSystem } from '../../core/effect/part-script.js';

/** 只取用到的那部分契约（结构化类型，不绑具体实现） */
export interface SystemSpawner {
  spawnSystem(system: PartSystem, opts: {
    pos: { x: number; y: number; z: number };
    attach?: THREE.Object3D | null;
    rigidFollow?: boolean;
    velocity?: { x: number; y: number; z: number };
  }): Promise<unknown> | null;
}

export interface DynLightSink {
  set(x: number, y: number, z: number, r: number, g: number, b: number, a: number, power: number, decPower: number): void;
}

export interface MultiSparkRunnerCtx {
  effects: SystemSpawner | null;
  /** 命中那盏淡青光（原版 `SetDynLight(...,179,255,229,...)`）—— 没有就跳过（实验室/游戏都传了） */
  dynLights?: DynLightSink | null;
  /** 载体节点要进场景：quarks 用 `emitter.matrixWorld` 定位粒子（不入场景则矩阵不推进） */
  scene: THREE.Scene;
  log?: (msg: string) => void;
}

const v3 = (p: { x: number; y: number; z: number }): Vec3 => ({ x: p.x, y: p.y, z: p.z });

/**
 * 放一次 MultiSpark：`num` 颗主火花（各挂一个载体）+ 每帧拖尾 + 命中三件套。
 * @param num 原版：**玩家 7**（`sinSkillEffect.cpp:139`）、**怪物 5**（`character.cpp`）
 */
export function runMultiSpark(
  ctx: MultiSparkRunnerCtx,
  caster: { x: number; y: number; z: number },
  /** `null` = 没有目标（原版传 `nullptr` 的情形，见 `createMultiSpark` 的说明） */
  target: { x: number; y: number; z: number } | null,
  num: number,
): MultiSparkHandle | null {
  if (!ctx.effects) {
    ctx.log?.('  ✗ MultiSpark：没有 effects（未接渲染器）');
    return null;
  }
  const nodes: THREE.Object3D[] = [];
  return createMultiSpark(v3(caster), target ? v3(target) : null, num, {
    moveMain: (i, pos) => {
      let node = nodes[i];
      if (!node) {
        node = new THREE.Object3D();
        nodes[i] = node;
        ctx.scene.add(node);
        // 一颗主火花 = 一个载体；`rigidFollow` ⇒ 粒子吃载体位移（看起来在飞）
        void ctx.effects!.spawnSystem(multiSparkSystem(), { pos, attach: node, rigidFollow: true });
      }
      node.position.set(pos.x, pos.y, pos.z);
    },
    // 拖尾：位置/尺寸/寿命都由 `multi-spark.ts` 按原版公式算好，这里只 spawn
    spawnTrail: (pos, size) => {
      void ctx.effects!.spawnSystem(multiSparkTrailSystem(size), { pos });
    },
    onHit: (pos) => {
      // `sinEffect_SkillHit`（`sinSkillEffect.cpp:1618-1624`）
      const d = MULTI_SPARK_HIT_DYN_LIGHT;
      ctx.dynLights?.set(pos.x, pos.y, pos.z, d.r, d.g, d.b, d.a, d.power, d.decPower);
      for (const sys of multiSparkLightSystems()) void ctx.effects!.spawnSystem(sys, { pos });
      // BombParticle：每颗方向/寿命/初速都不同（`sinPublicEffect.cpp:118-127`）
      const B = MULTI_SPARK_BOMB;
      for (let b = 0; b < B.num; b++) {
        const rad = (((Math.random() * B.angleStepRandom) * b + B.num) % 4096) / 4096 * Math.PI * 2;
        const life = B.lifeMinFrames + Math.floor(Math.random() * (B.lifeMaxFrames - B.lifeMinFrames + 1));
        const rise = B.riseMinPerFrame + Math.random() * (B.riseMaxPerFrame - B.riseMinPerFrame);
        // 逐帧量 → 每秒量（原版逐帧，这里 60fps）
        void ctx.effects!.spawnSystem(multiSparkBombSystem(life), {
          pos,
          velocity: {
            x: Math.cos(rad) * B.radialSpeedPerFrame * 60,
            y: rise * 60,
            z: -Math.sin(rad) * B.radialSpeedPerFrame * 60,
          },
        });
      }
      ctx.log?.(`    ✦ MultiSpark 命中 → 动态光 + Light5 ×5 + BombParticle ×${B.num}`
        + `；⚠ 未表达：WideLine ×${MULTI_SPARK_HIT.wideLineMissing.count}（刚体细长网格）`);
    },
    onEnd: () => {
      // 原版 `Time >= Max_Time` 释放实例；**不摘载体**（一摘，上面的粒子会瞬间消失）
      ctx.log?.('    ✦ MultiSpark 45 帧走完（第 30 帧改瞄、第 44 帧命中）');
    },
  });
}
