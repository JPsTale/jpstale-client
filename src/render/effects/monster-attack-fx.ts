/**
 * 怪物攻击的**事件帧编排** —— 游戏（WorldView）与怪物实验室（efria-studio）共用的唯一实现。
 *
 * 原版在 `EventAttack` 的 `switch (dwCharSoundCode)` 里，**同一个事件帧**既播音效也起特效
 * （`character.cpp:2715+`）。两件事同源 ⇒ 必须落在同一处，否则"实验室里看到的"与
 * "游戏里跑的"会各演化一份（AGENTS #15：同一判定在仓库里出现第二份就是 bug 的种子）。
 *
 * 这里的边界刻意选成**不含**"事件帧怎么算出来的"—— 那是动画状态机的职责
 * （`MotionInfo.eventFrame`，见 char/anim-state-machine）。本模块只回答
 * "事件帧到了，这一刻该发生什么"。
 */

import { reportFallback } from '../../char/fallback-log.js';
import { getMoveLocation, radToPtAngle } from '../../core/geom.js';
// 只 import 类型：本模块刻意**不依赖 three**（游戏与实验室各自把池传进来）
import type { DynLightSink } from './dyn-light.js';

/** 攻击特效定义。 */
export interface MonsterAttackFxDef {
  /**
   * 资产名。给**数组**表示原版有多个候选（它用 `rand()` 从中挑一个）。
   *
   * ⚠ 我们**不在库里随机**：取哪个由调用方的 `ctx.variant` 决定（AGENTS #12 ——
   * 表现层随机会让"看到的是否为真"无法复现；将来要随机也应由服务端下发索引）。
   */
  asset: string | string[];
  /** 原版 `StartBillRectPrimitive` 的宽高（两轴同值时为方框） */
  size?: number;
  /**
   * 落点偏移 —— **原样照抄原版 `GetMoveLocation(x, y, z, angX, angY, angZ)` 的参数**
   * （`smLib3d/smgeosub.cpp:151`），由 `core/geom.getMoveLocation` 算出实际偏移。
   *
   * ⚠ 为什么存"参数"而不是"翻译好的结果"：我当初把 `pX + GeoResult_X` 直接翻译成
   * `forward: 54`，就漏掉了"它取决于上一行的 `GetMoveLocation` 调用"这件事，
   * 于是粒子落在怪物身上而不是身前（用户实测发现）。**存参数、原样搬运**，
   * 就不需要我理解语义 —— 而 `getMoveLocation` 是纯函数，可以单测钉死。
   *
   * `angY` 不在这里：它是**怪物的朝向**（原版 `Angle.y`，运行时给），见 `ctx.facing`。
   */
  move?: { x: number; y: number; z: number; angX?: number; angZ?: number };
  /**
   * 高度偏移（world 单位）。
   *
   * 原版有两种写法，都见过（`character.cpp` 的怪物 switch）：
   *   · `pY + 48 * fONE`        → 固定值（HULK）
   *   · `pY + GeoResult_Y`      → 用偏移结果的 y（DMACHINE：`GetMoveLocation(0, 30*fONE, 10*fONE, …)`）
   * 用 `'geoY'` 表示后者。
   */
  height: number | 'geoY';
  /**
   * **飞出物**：这个特效不是原地播，而是从怪物飞向目标（原版 `AssaParticle_*Shot` 那类，
   * 类里持有 `Posi` 并在 `Main()` 每帧沿方向推进）。
   *
   * 这里只给**速度**（世界单位/秒）。飞行的驱动由调用方做 —— 本模块不依赖 three，
   * 而"推进一个载体节点 + 让粒子跟随它"要用 `effects.spawn(name, { attach })`
   * 那个现成能力（`EffectManager.SpawnOpts.attach`）。
   *
   * 依据：`AssaParticle.cpp:7474` `Main()` 每帧 `step = 5*fONE + 100`（≈5.39 世界单位/帧），
   * 按 60fps 约 **323/秒**。
   */
  fly?: { speed: number };
  /**
   * 同一个 case 里原版还会起一盏**动态光**（`SetDynLight`）—— 有就一起起，别落下。
   * 参数原样照抄源码（0-255 颜色 / power / 每帧衰减 decPower）。
   */
  dynLight?: { r: number; g: number; b: number; a: number; power: number; decPower: number };
  /** 取证出处（源码文件:行号）。**每条必填**：填错不会报错，只会静默播成别人的特效 */
  note: string;
}

/**
 * 派发表：键 = 服务端下发的 `monster_effect_id`（= 原版 `dwCharSoundCode` / `EMonsterEffectID`）。
 *
 * ⚠ **只放核验过的条目**，每条注明出处。表里没有 = 未核验，**不猜**：
 * 特效填错不会报错，只会静默播成别人的特效，事后极难发现（AGENTS #12 的精神）。
 *
 * ⚠ 但"表里没有"**不等于降级**：绝大多数纯物理攻击的怪本来就没有攻击特效
 * （原版 `switch` 里相当多的 case 只播音效）。所以要区分的是"核验过 = 无特效"
 * 与"还没核验"，实验室界面把这两种显示成不同状态，不去污染降级清单。
 */
export const MONSTER_ATTACK_FX: Record<number, MonsterAttackFxDef> = {
  // 0x10B0 = snCHAR_SOUND_MUSHROOM（蘑菇精）：向周围释放粉色的有毒孢子气体
  //   `NewSourcePT-2023/SrcGame/src/character.cpp:4277` `case snCHAR_SOUND_MUSHROOM:`
  //      → `StartEffect(pX, pY + (24 * fONE), pZ, EFFECT_GAS1);`（调用在 :4279）
  //   `NewSourcePT-2023/SrcGame/src/HoBaram/HoEffect.cpp:7997` `case EFFECT_GAS1:`
  //      → `StartBillRectPrimitive(x, y, z, 120, 120, "Gas1.ini");`（调用在 :7999-8000）
  //   ⚠ 曾误写为 `character.cpp:2719 / HoEffect.cpp:7262` —— 后者其实是 `"Return1.ini"`
  //     的 `StartDestPath`，与 Gas1 无关。行号是唯一能复核的凭据，写错比不写更危险。
  0x10B0: { asset: 'Gas1', size: 120, height: 24, note: 'character.cpp:4279 / HoEffect.cpp:7999-8000' },

  // 0x12B0 = snCHAR_SOUND_HULK：命中特效，原版从**三个候选**里 `rand()%3` 挑一个
  //   `character.cpp:4459-4466` `case snCHAR_SOUND_HULK:`
  //      → `GetMoveLocation(0, 0, 54 * fONE, 0, Angle.y, 0);`（:4463）⇒ **前向 54 单位**
  //      → `StartEffectMonster(pX + GeoResult_X, pY + 48 * fONE, pZ + GeoResult_Z, MONSTER_HULK_HIT1);`（:4464）
  //   `HoEffect.cpp:11721-11732` `case MONSTER_HULK_HIT1:`
  //      → `SetDynLight(pos, …)` + `int i = rand() % 3;` → `g_NewParticleMgr.Start("HulkHit1"|"HulkHit2"|"HulkHit3", pos)`
  //   ⚠ 同一常量还被 OMICRON/STRIDER/IGOLATION/DARKPHALANX/BLOODYKNIGHT/CHIMERA/HELLHOUND/
  //     KINGSPIDER/S_METALGOLEM 复用，但那些 case 的**前向/高度偏移各不相同**（实测 22 / 42 / 48）
  //     ⇒ 它们 effectId 不同，要**各自登记**，不能共用这一条。
  0x12B0: {
    asset: ['HulkHit1', 'HulkHit2', 'HulkHit3'],
    // `character.cpp:4463` `GetMoveLocation(0, 0, 54 * fONE, 0, Angle.y, 0);` —— 原样搬参数
    //（54 = 身前，绕 Y 用怪物朝向；不是"落在身上"）
    move: { x: 0, y: 0, z: 54 },
    height: 48,           // `:4464` `pY + 48 * fONE`（固定值，非 GeoResult_Y）
    // `HoEffect.cpp:11723`（case 的第一行）：`SetDynLight(pos.x, pos.y, pos.z, 100, 255, 100, 255, 100, 1)`
    //   → 绿色（r=100,g=255,b=100）、a=255、power=100、每帧衰减 1 ⇒ 生命期 100 帧 ≈ 1.67s
    //   → `Range = max(64, 100>>1) = 64`（世界单位，见 dyn-light.ts）
    dynLight: { r: 100, g: 255, b: 100, a: 255, power: 100, decPower: 1 },
    note: 'character.cpp:4463-4464 / HoEffect.cpp:11721-11732（rand()%3 + SetDynLight）',
  },

  // 0x1580 = snCHAR_SOUND_RUNICGUARDIAN：走的是 `AssaParticle_*` **别名函数**，不是 `StartEffect`
  //   常量表（这类入口在首版索引里被**整族漏掉**，见 output/monster-attack-index.md）
  //   `character.cpp:4603-4608` `case snCHAR_SOUND_RUNICGUARDIAN:`
  //      → `AssaParticle_MonsterRunicGuardianShot(this, chrAttackTarget);`
  //   `hoAssaParticleEffect.cpp:5525-5541`：起点 = 怪物 `pY + 30*fONE`、终点 = 目标 `pY + 24*fONE`
  //      → `new AssaRunicGuardianShot; shot->Start(&curPos, &desPos);`
  //   `AssaParticle.cpp:7443` `Start()` → `g_NewParticleMgr.Start("IronMonsterRunicGuardianShot1", Posi)`
  //     资产 = `effect/particle/script/ironmonsterrunicguardianshot1.part`
  //   `AssaParticle.cpp:7474` `Main()` → 每帧沿 `ShootingAngle` 前进 `5*fONE + 100`（**朝目标飞**）
  //   ⚠ 原版这是**飞出物**。这里先按**原地粒子**登记（先把粒子本身做出来），
  //     飞行轨迹留作下一步。
  0x1580: {
    asset: 'IronMonsterRunicGuardianShot1',
    height: 30,
    // 原版是**飞出物**：`AssaParticle.cpp:7474` `Main()` 每帧 `step = 5*fONE + 100`
    //   （≈5.39 世界单位/帧）⇒ 60fps 下约 323/秒。终点 = 目标 `pY + 24*fONE`。
    fly: { speed: 323 },
    note: 'character.cpp:4606 / hoAssaParticleEffect.cpp:5530-5539 / AssaParticle.cpp:7443,7474',
  },
};

/** 特效管理器的最小契约 —— 结构化类型，避免与本模块耦合到具体实现类。 */
export interface FxSpawner {
  spawn(asset: string, opts: { pos: { x: number; y: number; z: number }; size?: number }): Promise<boolean>;
}

/**
 * 走**箭矢射击系统**的怪 —— 与 `MONSTER_ATTACK_FX` **分开登记**。
 *
 * 原版这 3 个 case 里**没有粒子特效调用**，而是设 `ShootingFlag = TRUE` 并把
 * `dwActionItemCode` 硬写成 `sinWS1`（弓）来复用玩家那套射击系统：
 *
 * ```
 * ShootingPosi = (pX, pY + N*fONE, pZ);                    // N 每只怪不同（28 / 38）
 * GetRadian3D(起点, 目标->pY + 24*fONE);   ShootingFlag = TRUE;   dwActionItemCode = sinWS1;
 * ```
 *
 * 我们复用 `projectile.ts` 的箭链路。**不需要登记起点高度**：原版那个 `pY + N*fONE`
 * 是在近似"出手高度"，而我们走 `mount = null` 时会自然落到**手骨**（`Bip weapon01`）
 * —— 与"空手施法"同一条路径，比硬编码高度更准。
 *
 * key = 服务端下发的 `monster_effect_id`。
 */
export const MONSTER_RANGED: Record<number, { note: string }> = {
  0x11C0: { note: 'SKELETONRANGE character.cpp:4379-4390（sinWS1；起点 pY+28）' },
  0x1890: { note: 'DARKGUARD    character.cpp:4855-4866（sinWS1；起点 pY+38）' },
  0x1910: { note: 'REVIVED_ARCHER character.cpp:5094-5105（sinWS1；起点 pY+38）' },
};

/**
 * 怪物射击用的武器码 —— 原版在怪物的 case 里**硬写** `dwActionItemCode = sinWS1`（弓），
 * 因为怪物没有武器数据（`character.cpp:4390 / 4866 / 5105`）。
 * `ws101` = Short Bow（`itemDefs.ts` 的 `code: 17170688`），用它复用玩家那套箭链路。
 */
export const MONSTER_BOW_IDCODE = 17170688;

/** 音效播放器的最小契约（`audio/sfx.ts` 的 `playSoundByName`）。 */
export interface SfxPlayer {
  playSoundByName(
    modelKey: string, motion: string,
    pos: { x: number; y: number; z: number },
    effectId: number,
  ): void;
}

export interface MonsterAttackEventCtx {
  /** 模型 key —— 音效目录按它解析（`sfx.ts`） */
  modelKey: string;
  /** 服务端下发的 `monster_effect_id` */
  effectId: number;
  /** 怪物**世界坐标**（`root.position`）；特效按上面的 height / forward 偏移 */
  pos: { x: number; y: number; z: number };
  /**
   * 怪物**朝向**（弧度，绕 Y）—— 供 `forward` 前向偏移使用。
   * 与 `ctx.pos` 一样由调用方给（`root.rotation.y`）；不传则前向偏移按"未提供"跳过。
   */
  facing?: number;
  /**
   * 多候选时取第几个（**调用方决定**，缺省 0）。
   *
   * 原版这里是 `rand() % 3` —— 我们把它提到调用方：实验室用它做"3 选 1"的下拉，
   * 将来若要有服务端权威的随机，换成下发索引即可（字段与链路不动，同动画变体）。
   */
  variant?: number;
  effects: FxSpawner | null;
  sfx: SfxPlayer | null;
  /** 动态光池（原版 `SetDynLight`）。没传则跳过 —— 游戏与实验室传的是同一份实现 */
  dynLights?: DynLightSink | null;
  /**
   * 这只怪的攻击是**射击**时（见 `MONSTER_RANGED`），由调用方负责发射。
   *
   * 用回调而不是在本模块里发射：本模块刻意**不依赖 three**（发射要碰 Vector3/模型），
   * 且"从哪出手、打向谁"是调用方的场景知识（游戏里是 AOI 里的目标，实验室里是假人）。
   */
  fireRanged?: () => void;
}

/**
 * 多候选时按 `variant` 取一个资产名。
 *
 * **唯一实现**：实验室的日志显示与实际播放必须走同一份判断，否则"日志说播的是 A、
 * 画面里是 B"这种分叉会同时污染两边（AGENTS #15）。
 */
export function pickMonsterFxAsset(def: MonsterAttackFxDef, variant = 0): string {
  const list = Array.isArray(def.asset) ? def.asset : [def.asset];
  return list[Math.abs(variant) % list.length]!;
}

/**
 * 攻击事件帧到达 → 播挥击音 + 起攻击特效。
 *
 * 原版同帧两件事（`character.cpp:2687` 拍事件帧、`2715+` 起特效），故这里不拆。
 *
 * @returns 本怪**有**核验特效时返回启动结果的 Promise（`false` = 声明了却起不来）；
 *   本怪没有核验条目时返回 `null`（正常，不是失败 —— 多数纯物理怪原版就只有音效）。
 *
 *   ⚠ 起不来一律走 `reportFallback`，**绝不静默**：写成 `void spawn(...)` 会把
 *   "素材解析失败/没渲染出来"伪装成"特效正常播放"，于是"看不到粒子"到底是没数据、
 *   还是没渲染，永远查不出来（AGENTS #12）。实验室与游戏共用这条上报路径。
 */
export function fireMonsterAttackEvent(ctx: MonsterAttackEventCtx): Promise<boolean> | null {
  ctx.sfx?.playSoundByName(ctx.modelKey, 'CHRMOTION_STATE_ATTACK', ctx.pos, ctx.effectId);
  // 射击怪：原版在这个事件帧设 `ShootingFlag`（而不是起粒子）⇒ 交给调用方发射，本函数不返回特效句柄
  if (MONSTER_RANGED[ctx.effectId]) {
    ctx.fireRanged?.();
    return null;
  }
  const def = MONSTER_ATTACK_FX[ctx.effectId];
  if (!def || !ctx.effects) return null;
  // 落点 = 怪物原点 + 原版 `GetMoveLocation(...)` 算出的偏移。
  // **照抄参数、由等价函数算**（`core/geom.getMoveLocation`）—— 不做语义翻译：
  // 当初把 `GeoResult_*` 翻译成"前方 N 单位"，就漏掉了它来自上一行调用，于是粒子落在身上。
  let off = { x: 0, y: 0, z: 0 };
  if (def.move) {
    const m = def.move;
    // 绕 Y 的角 = 怪物朝向（原版 `Angle.y`）；调用方给的是弧度，这里换成 PT 制式
    off = getMoveLocation(m.x, m.y, m.z, m.angX ?? 0, radToPtAngle(ctx.facing ?? 0), m.angZ ?? 0);
  }
  const at = {
    x: ctx.pos.x + off.x,
    // `height` 为 'geoY' 时用偏移结果的 y（原版 `pY + GeoResult_Y` 那种写法）
    y: ctx.pos.y + (def.height === 'geoY' ? off.y : def.height),
    z: ctx.pos.z + off.z,
  };
  // 原版在同一个 case 里**先 SetDynLight 再起粒子**（`HoEffect.cpp:11723` 是 case 的第一行），
  // 两件事同源 ⇒ 这里也一起做，且用**同一个落点**。
  if (def.dynLight) {
    const d = def.dynLight;
    ctx.dynLights?.set(at.x, at.y, at.z, d.r, d.g, d.b, d.a, d.power, d.decPower);
  }
  const name = pickMonsterFxAsset(def, ctx.variant);
  const label = `${name}（effectId=0x${ctx.effectId.toString(16).toUpperCase()}，出处 ${def.note}）`;
  return Promise.resolve(ctx.effects.spawn(name, {
    pos: at,
    size: def.size,
  }))
    .then((ok) => {
      if (!ok) reportFallback('fx', `怪物攻击特效 ${label} 起不来（effects.spawn 返回 false）`);
      return ok;
    })
    .catch((e: unknown) => {
      reportFallback('fx', `怪物攻击特效 ${label} 抛错：${String(e)}`);
      return false;
    });
}
