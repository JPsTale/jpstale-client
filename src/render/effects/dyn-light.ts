/**
 * 动态光（原版 `SetDynLight` / `scDYNLIGHT`）—— 游戏与实验室**共用的唯一实现**。
 *
 * 原版实现（`NewSourcePT-2023/SrcGame/src/Particle.cpp:351-420`）：
 *   · **固定池** `scDYNLIGHT scDynLight[scLIGHT_MAX]`，`#define scLIGHT_MAX 80`；
 *     `SetDynLight` 找一个空槽，**池满则返回 FALSE**（不是覆盖旧的）。
 *   · `Main()` —— 每帧 `Power -= DecPower`，归零即 `Flag = 0` 灭掉
 *     ⇒ 生命期 = `power / decPower` **帧**（不是秒）。
 *   · `Apply()` → `lpRender->AddDynamicLight(pX,pY,pZ, r,g,b,a, Range)`，其中
 *     `Range = (Power>>1)*fONE` 且**下限 64 世界单位**；`r/g/b/a` 都**先按 Power 缩放**：
 *     `r = (Power*R) >> FLOATNS` —— `FLOATNS` 是 8 位定点（255 表示 1.0），
 *     故 `A=255` 时 `a == Power`，颜色则按 `Power/255` 整体变暗。
 *
 * ⚠ **尚未读到的东西（不是"照抄"，是"推断"）**：`smRENDER3D::AddDynamicLight` 的衰减
 *   公式没读 ⇒ 下面 two 处是**待与游戏内比对**的标定值：
 *     ① `DYN_LIGHT_INTENSITY_SCALE`（原版强度 → three 物理强度的换算）
 *     ② `decay`（原版未必是 three 默认的平方反比）
 *   看图对不上时先改这两个，别去改衰减逻辑本身。
 *
 * 为什么要有它：原版 **156 处**调用 `SetDynLight`（技能/特效/怪物攻击成对出现），
 * 而我们此前一处都没有 —— 没有它，`Gas1` 的爆炸、`HulkHit` 的命中都不会照亮地面。
 */

import * as THREE from 'three';
import { reportFallback } from '../../char/fallback-log.js';

/** 池上限 —— 跟原版 `#define scLIGHT_MAX 80` 对齐（满了照原版行为丢弃并上报） */
export const DYN_LIGHT_MAX = 80;

/**
 * 原版强度 → three 物理光强的标定常数。
 * ⚠ **推断值**（`AddDynamicLight` 未读）：原版 `A=255` 时 `a == Power`，
 * 而 three（r155+）用坎德拉 + 平方反比，同样的数看不出效果，故乘一个标定系数。
 *
 * 实测（2026-09-17，实验室环境光 ambient 0.55 + 平行光 1.1）：4000 时 HULK 的
 * `power=100` 绿光在 48 单位高度下照度仅约 0.68（占基础照明三成）→ 几乎看不出，
 * 故提到 12000。**这个数只影响"亮多少"，不影响衰减行为**；与原版比对时先动这里。
 */
const DYN_LIGHT_INTENSITY_SCALE = 12000;

export interface DynLightSink {
  /**
   * 起一盏动态光（对应原版 `SetDynLight`）。
   * @param r,g,b,a 原版 0-255 的颜色；内部按 `Power/255` 整体缩放（同原版 `Apply`）
   * @param power   初始强度；每帧减 `decPower`，归零即灭
   * @param decPower 每帧衰减量（**帧**为单位，内部按 60fps 归一化）
   * @returns 池满时为 false（调用方应知晓；池里已有光不会被顶掉，同原版）
   */
  set(x: number, y: number, z: number, r: number, g: number, b: number, a: number,
      power: number, decPower: number): boolean;
}

export interface DynLightPool extends DynLightSink {
  /** 每帧推进（衰减）—— 原版 `DynLightMain()` */
  update(dt: number): void;
  /** 当前点亮的盏数（实验室/诊断用） */
  active(): number;
  /** 池上限（诊断用） */
  readonly max: number;
}

/**
 * 建一个动态光池。**预创建** `DYN_LIGHT_MAX` 盏灯（three 里增删光源会触发材质重编译，
 * 预建 + 开关 `visible` 才是稳的做法）。
 */
export function createDynLightPool(scene: THREE.Scene): DynLightPool {
  const lights: THREE.PointLight[] = [];
  for (let i = 0; i < DYN_LIGHT_MAX; i++) {
    // decay=2 是 three 默认（平方反比）；原版公式未读，见文件头 ⚠
    const l = new THREE.PointLight(0xffffff, 0, 64, 2);
    l.visible = false;
    l.name = `dyn-light-${i}`;
    scene.add(l);
    lights.push(l);
  }
  /** 每个槽的当前 Power（0 = 空槽）；`base` 存原始颜色，供每帧按 Power 重算 */
  const power = new Float64Array(DYN_LIGHT_MAX);
  const dec = new Float64Array(DYN_LIGHT_MAX);
  const base = new Float64Array(DYN_LIGHT_MAX * 4);

  /** 按当前 Power 重算颜色/强度/半径（原版 `Apply()` 每帧都这么做） */
  function apply(i: number): void {
    const l = lights[i]!;
    const p = power[i]!;
    if (p <= 0) {
      l.visible = false;
      l.intensity = 0;
      return;
    }
    const k = p / 255;
    l.color.setRGB((base[i * 4]! * k) / 255, (base[i * 4 + 1]! * k) / 255, (base[i * 4 + 2]! * k) / 255);
    l.intensity = ((p * base[i * 4 + 3]!) / 255 / 255) * DYN_LIGHT_INTENSITY_SCALE;
    // Range = (Power>>1)*fONE，下限 64（世界单位）
    l.distance = Math.max(64, p >> 1);
    l.visible = true;
  }

  return {
    max: DYN_LIGHT_MAX,

    set(x, y, z, r, g, b, a, p, decPower) {
      let slot = -1;
      for (let i = 0; i < DYN_LIGHT_MAX; i++) {
        if (power[i]! <= 0) { slot = i; break; }
      }
      if (slot < 0) {
        // 原版池满也是丢弃（返回 FALSE）。**但不静默**：消失的光必须能解释
        reportFallback('fx', `动态光池已满（${DYN_LIGHT_MAX} 盏，原版 scLIGHT_MAX）→ 这一盏被丢弃`);
        return false;
      }
      const l = lights[slot]!;
      base[slot * 4] = r; base[slot * 4 + 1] = g; base[slot * 4 + 2] = b; base[slot * 4 + 3] = a;
      power[slot] = p;
      dec[slot] = decPower;
      l.position.set(x, y, z);
      apply(slot);
      return true;
    },

    update(dt) {
      // 原版是**每帧** `Power -= DecPower`；我们帧率不固定 ⇒ 按 60fps 归一化
      //（否则高帧率下光消失得比原版快，低帧率下更慢）
      const steps = dt * 60;
      for (let i = 0; i < DYN_LIGHT_MAX; i++) {
        if (power[i]! <= 0) continue;
        power[i]! -= dec[i]! * steps;
        if (power[i]! <= 0) power[i] = 0;
        apply(i);
      }
    },

    active() {
      let n = 0;
      for (let i = 0; i < DYN_LIGHT_MAX; i++) if (power[i]! > 0) n++;
      return n;
    },
  };
}
