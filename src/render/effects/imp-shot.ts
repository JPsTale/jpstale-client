/**
 * 法杖/图腾普攻的**默认弹** —— 原版代号 `MONSTER_IMP_SHOT1`。
 *
 * 为什么写成"代码里的 spec"而不是一个 `.part` 文件：**原版就没有数据文件**。
 * 这颗弹的外观只写在引擎代码里（`Legacy/Engine/Particle/HoParticle.cpp:213-246` 的 case），
 * 所以没办法像 `FireShot1.part` 那样"按名字播"；这里把那些参数逐项搬过来，
 * 并写明每个字段的换算依据（不确定的地方标"我方决定"，改动只在这一处）。
 *
 * ── 原版事实（逐条给出处；用户 2026-09-16 提"法师/祭司/萨满攻击会飞出法术火球"）
 *   · **谁放它**：`character.cpp:3639-3692` 的 `EventAttack()` 里 `wp == sinWM1` 分支；
 *     **没有元素附魔时**走 `else` → `StartEffectMonsterDest(..., MONSTER_IMP_SHOT1)`
 *     （有附魔火/冰/雷则改用 `AssaParticle_FireShot/IceShot/LightShot`，那些**有** `.part` 文件）。
 *   · **贴图**：`Effect\ImageData\Particle\Red.dds`（`HoEffect.cpp:2808`）。
 *     ⚠ `.dds` 是 ex-machina 换 DX11 时引入的扩展名（AGENTS 纠错 #1），我方 `red.tga` 是它的同类资产 ——
 *     但**实测那张图本身就是一颗红色光球**（配近白色调仍发红），用户实测得到"红色的小火球" ✗；
 *     用户描述的原版是**青白**，`ColorStart (230,250,250)` 本身就带青白 ⇒ 贴图必须是**中性白**。
 *     故改用 `effect/imagedata/particle/flare.tga`（白色径向光斑，实测确认）——
 *     **这是相对 exm 参数表的一处有意偏离**，理由：① 我方 red.tga 与原版 Red.dds 不同物；
 *     ② 用户以原版观感为准（"青白的大火球"）。
 *   · **粒子参数**（`HoParticle.cpp:221-246`）：起色 (230,250,250) 近白、`AlphaStart 200`、
 *     `SizeStart 4.0` → `SizeEnd 0.5`、`ColorEnd (0,0,0)`、`AlphaEnd 0`、`Speed 100`、
 *     `Theta 180`、`Life 0.005`、`Gravity 0`、`ParticlesPerSec = EngineFps * 10`、`Age 0.9`。
 *   · **寿命的实际值**：`HoParticle.cpp:481` 会把 `LifeTime` 夹到 `HoClamp(MIN_LIFETIME,
 *     MAX_LIFETIME)`，而两者是 `0.1f / 10.0f`（`HoParticle.h:11,20`）⇒ 那个 `0.005` **实际就是 0.1 秒**。
 *   · **命中**（`HoEffect.cpp:9107` → `MONSTER_IMP_HIT1`）：`Power1.ini` + `MonsterImp1.ini`
 *     两张公告牌 + 三个物理粒子（`HoEffect.cpp:8646-8677`）；两个 INI 都在我方资产里 ✓。
 *
 * ── 单位换算（**这是唯一需要判断的地方，写清楚免得后人踩**）
 *   原版 `HoParticle` 的速度是**每帧**量（`Location += Velocity * TimeCount`，`TimeCount` 是帧数，
 *   `HoParticle.cpp:35-37`），而我们的粒子运行时是按 `.part` 脚本校准的**每秒**制
 *   （`pos += vel * dt`）⇒ 直接把 `Speed 100` 搬过来会快一个数量级。故：
 *     · 寿命沿用原版的**秒**（0.1，见上，与两套系统一致）；
 *     · 发射率把"每帧 10 个"换算成每秒（取 200/秒 ≈ 30fps 下 300/秒 的同量级）；
 *     · 扩散速度取与 `.part` 弹同量级的小值（`SPREAD_SPEED`）—— **我方决定**，一处可调。
 *   `Theta 180` 在 `HoParticle` 里是喷散角，我们的 `PartEmitter` 没有对应字段 ⇒ 用
 *   `initialVelocity` 的三轴随机表达同样的"四散"（省略角度，视觉等价）。
 */
import type { Num, PartSystem, Vec3 } from '../../core/effect/part-script.js';

/** 定值 */
const n = (v: number): Num => ({ k: 'n', v });
/** 区间随机（原版 Random(a,b)） */
const rng = (a: number, b: number): Num => ({ k: 'r', a, b });
const vec = (x: Num, y: Num, z: Num): Vec3 => ({ x, y, z });

/**
 * 粒子单颗尺寸（世界单位）—— **我方定**（原版 `SizeStart 4.0 → SizeEnd 0.5`）。
 * 原值搬过来只有 4 单位（角色高约 45）⇒ 用户实测"小"；这里 ×4 得到"大火球"的量级，
 * 观感不对改这两个数即可（发射率/寿命同理）。
 */
const SIZE_START = 16;
const SIZE_END = 2;

/** 我方取的名字（原版没有名字，只有 case 常量） */
export const IMP_SHOT_NAME = 'ImpShot1';

/** 命中特效：原版 `MONSTER_IMP_HIT1` 用的两张 INI（都按名字走 `EffectManager.spawn`） */
export const IMP_SHOT_HIT_FX = ['MonsterImp1', 'Power1'] as const;

/**
 * 扩散速度（世界单位/秒）——**我方决定**，见文件头"单位换算"第 3 条。
 * 观感要求：让那颗弹看起来是"一团发光的小球 + 一点尾巴"，而不是一条长线。
 */
export const SPREAD_SPEED = 12;

/** 持续时间（秒）= `numParticles / emitRate`，对齐原版 `Age = 0.9` */
const DURATION_SEC = 0.9;
const EMIT_RATE = 200;

/** 造一份 `MONSTER_IMP_SHOT1` 的 spec（每次调用返回新对象，便于调用方按需微调） */
export function impShotSystem(): PartSystem {
  return {
    name: IMP_SHOT_NAME,
    version: 1,
    position: null,
    emitters: [{
      name: 'ImpShot',
      blend: 'lamp',                  // 原版 SMMAT_BLEND_LAMP（HoEffect.cpp:2808）
      particleType: 1,                // TYPE_ONE = 朝向相机的公告牌
      numParticles: Math.round(EMIT_RATE * DURATION_SEC),
      emitRate: EMIT_RATE,
      loops: 1,
      delay: 0,
      lifetime: n(0.1),               // HoParticle 的 Life 0.005 被 HoClamp 到 0.1s
      emitRadius: vec(n(0), n(0), n(0)),
      initialVelocity: vec(rng(-SPREAD_SPEED, SPREAD_SPEED), rng(-SPREAD_SPEED, SPREAD_SPEED), rng(-SPREAD_SPEED, SPREAD_SPEED)),
      gravity: vec(n(0), n(0), n(0)), // 原版 GravityStart/End = 0
      texture: 'effect\\imagedata\\particle\\flare.tga',
      initialSize: n(SIZE_START),     // 原版 SizeStart 4.0（我方 ×4，见 SIZE_START 说明）
      initialSizeExt: null,
      initialColor: { r: n(230), g: n(250), b: n(250), a: n(200) },
      initialPartAngle: null,
      initialLocalAngle: null,
      finalColor: { r: n(0), g: n(0), b: n(0), a: n(0) },
      finalSize: n(SIZE_END),         // 原版 SizeEnd 0.5（同比例缩小）
      finalSizeExt: null,
      finalPartAngle: null,
      finalLocalAngle: null,
      finalVelocity: null,
      keyframes: {},                  // 代码内 spec：无 `fade so at` 中间帧
    }],
  };
}
