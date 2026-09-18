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
 * **真实 `THREE.PointLight` 的盏数**（恒定，与池容量 `DYN_LIGHT_MAX` 是两件事）。
 * 理由见 `createDynLightPool` 注释：three 把灯数编进 shader 源码，且展开后**灭灯也照跑计算**
 * ⇒ 灯数既不能变、也不能多。8 = 够覆盖"角色/怪物周围最近的几盏"；更远的光仍照在地面上（数据面注入）。
 */
const DYN_LIGHT_LIVE = 8;

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

/**
 * 给**顶点着色器**吃的动态光数据（自写注入用，见台账 §18）。
 *
 * 布局（每盏 2 个 vec4，共 160 个 —— WebGL2 顶点保底 256）：
 *   `posRange[i*4+0..2]` = 世界坐标 · `+3` = **R（世界单位）** = `max(64, Power>>1)`
 *   `colAlpha[i*4+0..2]` = 已按 `Power/255` 缩放的颜色 · `+3` = 同缩放的 alpha
 * 并且**压紧**在前 `count` 个槽里 —— 着色器只能"常量上界 for + 按 count break"
 * （GLSL ES 1.0 的 uniform 数组下标必须是常量索引表达式），散的槽位会让它没法定界。
 */
export interface DynLightData {
  posRange: Float32Array;
  colAlpha: Float32Array;
  count: number;
}

export interface DynLightPool extends DynLightSink {
  /** 每帧推进（衰减）—— 原版 `DynLightMain()` */
  update(dt: number): void;
  /** 着色器用的数据面（见 `DynLightData`；每帧末已压紧） */
  data(): DynLightData;
  /** 当前点亮的盏数（实验室/诊断用） */
  active(): number;
  /** 池上限（诊断用） */
  readonly max: number;
}

/**
 * 建一个动态光池。**真实 `PointLight` 只建 `DYN_LIGHT_LIVE` 盏**，全部常驻 `visible = true`；
 * 池容量仍是 `DYN_LIGHT_MAX`（那是**数据面的槽数**，与真实灯数是两件事）。
 *
 * ⚠ 真实灯数**必须恒定**：`NUM_POINT_LIGHTS` 是**编译期常量** —— three 把它文本替换进 shader
 *   源码（`three.module.js:19451`），循环还被 `#pragma unroll_loop_start` **展开成重复源码**
 *   （GLSL ES 1.0 的数组长度/循环上界必须常量表达式）。⇒ 亮着几盏就编一份 program：0..80 盏 =
 *   最多 81 份 shader，每见到一个新灯数就同步 `compileShader + linkProgram`。
 *     实测（CC 连点十几次后 `renderer.info.programs` 9 → 112，伴随 300~1600ms 的 `3D提交` 尖峰）。
 *
 * ⚠ 但**不能**靠"常驻 80 盏 + 灭灯只置 `intensity = 0`"来恒定灯数：展开后**没有分支可跳过**。
 *   `lights_fragment_begin`（`three.module.js:13896`）展开出 80 段 `getPointLightInfo + RE_Direct`，
 *   而 `RE_Direct_BlinnPhong`（`:13890`）里**没有** `directLight.visible` 判断（那个 `visible` 只用在
 *   阴影那一行）⇒ 灭灯只是把 `color` 乘 0，`normalize/length/pow/dot/BRDF` **全部照跑**。
 *   即 80 盏 = 每个 Phong 片元每帧 80 次完整光照（无战斗时原本是 0 次）。
 * ⇒ 真实灯恒定 `DYN_LIGHT_LIVE` 盏，每帧只喂**最亮的 8 盏**（见 `applyLive`）。
 *   地面**不受影响** —— 它吃 `DynLightData` 那套顶点注入（全部 80 盏）。
 */
export function createDynLightPool(scene: THREE.Scene): DynLightPool {
  const lights: THREE.PointLight[] = [];
  for (let i = 0; i < DYN_LIGHT_LIVE; i++) {
    // decay=2 是 three 默认（平方反比）；原版公式未读，见文件头 ⚠
    const l = new THREE.PointLight(0xffffff, 0, 64, 2);
    l.visible = true;
    l.name = `dyn-light-${i}`;
    scene.add(l);
    lights.push(l);
  }
  /** 每个槽的当前 Power（0 = 空槽）；`base` 存原始颜色、`pos` 存世界坐标，供每帧按 Power 重算 */
  const power = new Float64Array(DYN_LIGHT_MAX);
  const dec = new Float64Array(DYN_LIGHT_MAX);
  const base = new Float64Array(DYN_LIGHT_MAX * 4);
  // ⚠ 位置**必须自己按槽存**：真实灯只有 DYN_LIGHT_LIVE 盏，槽↔灯不再一一对应（见 `applyLive`）
  const pos = new Float64Array(DYN_LIGHT_MAX * 3);
  /** `applyLive` 选出的"最亮的前 N 槽"（预分配，热路径零分配） */
  const top = new Int32Array(DYN_LIGHT_LIVE);

  /** 着色器数据面（每帧末压紧；见 `DynLightData`） */
  const posRange = new Float32Array(DYN_LIGHT_MAX * 4);
  const colAlpha = new Float32Array(DYN_LIGHT_MAX * 4);
  let dataCount = 0;

  /** Range = (Power>>1)*fONE，下限 64（世界单位）—— 与原版 `Apply()` 一致（**唯一定义**，`applyLive` 与 `packData` 共用） */
  function rangeOf(p: number): number { return Math.max(64, p >> 1); }

  /**
   * 把**最亮的 `DYN_LIGHT_LIVE` 盏**写进真实 `PointLight`（只有角色/怪物=Phong 吃这份）。
   * 灯数恒定不变（见 `createDynLightPool` 注释：一变就重编 shader），灭的只置 `intensity = 0`
   * —— **不碰 `visible`**（`visible=false` 会让灯从 three 列表消失 = 灯数变化）。
   *
   * 代价（有意偏离原版）：角色/怪物只被**最近的 8 盏**照亮，更远的光只在地面上有表现。
   * 地面走 `DynLightData`（全部 80 盏），不受此限。
   */
  function applyLive(): void {
    for (let k = 0; k < DYN_LIGHT_LIVE; k++) top[k] = -1;
    // 取 top-N：插入排序，O(80×8)，热路径零分配
    for (let i = 0; i < DYN_LIGHT_MAX; i++) {
      const p = power[i]!;
      if (p <= 0) continue;
      for (let k = 0; k < DYN_LIGHT_LIVE; k++) {
        const t = top[k]!;
        if (t < 0 || p > power[t]!) {
          for (let j = DYN_LIGHT_LIVE - 1; j > k; j--) top[j] = top[j - 1]!;
          top[k] = i;
          break;
        }
      }
    }
    for (let k = 0; k < DYN_LIGHT_LIVE; k++) {
      const l = lights[k]!;
      const i = top[k]!;
      if (i < 0) { l.intensity = 0; continue; }   // 熄灭 —— 不关 visible（灯数必须恒定）
      const p = power[i]!;
      const kf = p / 255;
      l.position.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
      l.color.setRGB((base[i * 4]! * kf) / 255, (base[i * 4 + 1]! * kf) / 255, (base[i * 4 + 2]! * kf) / 255);
      l.intensity = ((p * base[i * 4 + 3]!) / 255 / 255) * DYN_LIGHT_INTENSITY_SCALE;
      l.distance = rangeOf(p);
    }
  }

  /** 每帧末把**点亮的光**压紧写进数据面（着色器靠 `count` 定界，见 `DynLightData`） */
  function packData(): void {
    let n = 0;
    for (let i = 0; i < DYN_LIGHT_MAX; i++) {
      const p = power[i]!;
      if (p <= 0) continue;
      const o = n * 4;
      posRange[o] = pos[i * 3]!; posRange[o + 1] = pos[i * 3 + 1]!; posRange[o + 2] = pos[i * 3 + 2]!;
      posRange[o + 3] = rangeOf(p);                       // R（世界单位）
      const k = p / 255;
      colAlpha[o] = (base[i * 4]! * k) / 255;
      colAlpha[o + 1] = (base[i * 4 + 1]! * k) / 255;
      colAlpha[o + 2] = (base[i * 4 + 2]! * k) / 255;
      colAlpha[o + 3] = (((p * base[i * 4 + 3]!) / 255) / 255) / 255;
      n++;
    }
    // 尾部清零：`R = 0` 即哨兵（着色器里盒式判据 `d.x < R` 对 R=0 恒不成立）
    // ⇒ 着色器**不需要 count uniform**，也就省掉"每帧写标量"的那次 JS（数组是共享引用，three 每次绘制自动上传）
    for (let i = n; i < DYN_LIGHT_MAX; i++) {
      posRange[i * 4] = 0; posRange[i * 4 + 1] = 0; posRange[i * 4 + 2] = 0; posRange[i * 4 + 3] = 0;
      colAlpha[i * 4] = 0; colAlpha[i * 4 + 1] = 0; colAlpha[i * 4 + 2] = 0; colAlpha[i * 4 + 3] = 0;
    }
    dataCount = n;
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
      base[slot * 4] = r; base[slot * 4 + 1] = g; base[slot * 4 + 2] = b; base[slot * 4 + 3] = a;
      pos[slot * 3] = x; pos[slot * 3 + 1] = y; pos[slot * 3 + 2] = z;
      power[slot] = p;
      dec[slot] = decPower;
      applyLive();
      packData();
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
      }
      applyLive();
      packData();
    },

    data() {
      return { posRange, colAlpha, count: dataCount };
    },

    active() {
      let n = 0;
      for (let i = 0; i < DYN_LIGHT_MAX; i++) if (power[i]! > 0) n++;
      return n;
    },
  };
}
