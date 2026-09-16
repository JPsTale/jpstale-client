/**
 * 药水粒子的**运动参数** —— 原版 `EFFECT_POTION1/2/3`（`HoEffect.cpp:7114-7242`，三段代码完全相同，
 * 只有贴图不同）。用户 2026-09-16 实测："原版的粒子会动，现在的粒子不会动"。
 *
 * ── 原版到底怎么动的（逐条给出处，这就是"调查清楚"的结论）
 *
 *  ① **不是一张会飘的动画，是 30 个各自独立的物理广告牌**：
 *     `for (index = 0; index < 30; index++)` 新建 `HoPrimitiveBillboard`，
 *     `StartPath(currentPos = 效果点, "Potion{1,2,3}.ini", ANI_LOOP)` —— 每个都在播那 4 帧动画。
 *
 *  ② **每颗的初速**（`HoEffect.cpp:7126-7135`）：
 *     `ang = rand() % ANGLE_360`（4096/圈）
 *     `velocity = ( cos(ang)·70, 70, sin(ang)·70 )`  ← 水平四散 + 固定上抛
 *     `SetGravity( -(rand()%3 + 3) )`                ← −3..−5，只作用在 y
 *     `SetLive( rand()%20 + 55 )`                    ← 55..74 **帧**
 *
 *  ③ **每帧怎么走**（`HoPrimitiveBillboard::Main()` `HoEffect.cpp:680-725`）：
 *     `Physics->Main()` → `Velocity.y += Gravity; Live--;`
 *     `DirectionVelocity = Physics->GetVector()`
 *     `LocalX += DirectionVelocity.x`（y/z 同）—— **直接加，没有 dt**
 *     寿命归零 → 物理体置 FALSE → 该牌切成 `ANI_ONE` 停在末帧淡出，物理体释放。
 *
 *  ④ **自转**（`SetDestAngle({0, ANGLE_360/3 + 500, 0})`，`HoPhysicsParticle::SetDestAngle`）：
 *     `LocalAngleStep = destAngle / Live` ⇒ **整条寿命恰好转过 1365+500 = 1865 角度单位**
 *     = 1865/4096×360 ≈ **164°**（与寿命长短无关，长得慢、短得快）。
 *
 *  ⑤ 另有一张 `StartBillRectPrimitive(..., 120, 120, "Light1.ini")` 的闪光公告牌（不动的）。
 *
 * ── 单位换算（唯一需要判断的地方，改观感只改这一段）
 *   原版位置/速度用的是**原始单位**（`fONE = 256` ⇒ ÷256 得世界单位），且是**每帧**量；
 *   我们的运行时是**每秒**制（`pos += v·dt`）⇒ `×70`（`MainEffect` 按 `1.f/70.f` 步进，
 *   `HoEffect.cpp:11541`）。三项：
 *     速度  70 raw/帧  → 70/256×70 = **19.14 世界单位/秒**
 *     重力  −4 raw/帧² → −4/256×70² = **−76.6 世界单位/秒²**
 *     寿命  55..74 帧  → **0.79..1.06 秒**
 *   （`SetSize(8,8)` 那 8 是**世界单位**——`Face2d.width = (int)SizeWidth << FLOATNS`
 *    已经替我们做了 raw 换算，别跟着再除一次。）
 *
 *   ⚠ 一处化简：原版自转是"整条寿命转 164°"（速率随寿命变），这里用**固定角速度**
 *   （164° ÷ 平均寿命 0.93s ≈ 176°/s）。差异只在"活得久的转得多一点"，肉眼不可辨。
 */

/** 水平/垂直初速（世界单位/秒）= 70 raw/帧 ÷256 ×70 */
export const POTION_BURST_SPEED = (70 / 256) * 70;

/** 重力（世界单位/秒²）= −4 raw/帧² ÷256 ×70²（原版 −3..−5，取中值） */
export const POTION_BURST_GRAVITY = (-4 / 256) * 70 * 70;

/** 寿命（秒）= (55..74 帧) ÷ 70 */
export const POTION_BURST_LIFE = { min: 55 / 70, max: 74 / 70 };

/** 自转（度/秒）≈ 164° ÷ 0.93s（见文件头"一处化简"） */
export const POTION_BURST_SPIN = 164 / 0.93;

/** 颗粒数（原版硬编码 30） */
export const POTION_BURST_COUNT = 30;

/**
 * 单颗粒子的尺寸（世界单位）—— 原版 `SetSize(8, 8)`（`HoEffect.cpp:7144`）。
 *
 * ⚠ **必须显式给**：`potion1.ini` 没有 Size 段，我们的运行时否则会落到兜底 `DEFAULT_SIZE = 32`
 * ⇒ 粒子大 4 倍，而位移（下落 ~15 单位）不到自身直径的一半，看着就像"没动"
 * （用户 2026-09-16 实测"直到消失也还在头顶"）。
 */
export const POTION_PARTICLE_SIZE = 8;

/**
 * `Light1.ini` 闪光的尺寸（世界单位）—— 原版 `StartBillRectPrimitive(..., 120, 120, ...)`。
 * 同样因为 `light1.ini` 没有 Size 段，必须显式给。
 */
export const POTION_LIGHT_SIZE = 120;

/** 装成 `EffectManager.spawn` 的 `burst` 参数 */
export const POTION_BURST = {
  count: POTION_BURST_COUNT,
  speed: POTION_BURST_SPEED,
  speedY: POTION_BURST_SPEED,
  gravity: POTION_BURST_GRAVITY,
  life: POTION_BURST_LIFE,
  spin: POTION_BURST_SPIN,
};
