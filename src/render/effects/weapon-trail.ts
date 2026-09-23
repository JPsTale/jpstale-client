/**
 * **武器曳光 / 挥击残影** —— 原版 `cAssaMotionBlur`
 * （`AssaParticle.cpp:2490 Start` / `:2365 Main` / `:2401 Draw`）。
 *
 * ## 它是什么
 *
 * 不是粒子，也**不是"记录历史位置"**，而是**把同一段动画回溯到过去若干帧、重新求值骨骼**，
 * 把两段骨在那些历史帧的位置连成一条带子（`Draw():2427-2445`，逐字）：
 *
 * ```c
 * int mLevel = 32;      // 32 段
 * int mFrames = 30;     // 每段回溯 30 帧
 * for (cnt = 0; cnt < mLevel; cnt++) {
 *     pframe = pChar->frame - (cnt * mFrames);
 *     if (pframe < pChar->MotionInfo->StartFrame) pframe = pChar->MotionInfo->StartFrame;  // 钳到起手帧
 *     vcnt = cnt << 1;
 *     AnimObjectTree(SearchObj1, pframe, angle.x, angle.y, angle.z);
 *     lpVertex[vcnt] = pChar->pX + mWorld->_41 ...;   // 骨1 在那一历史帧的位置
 *     vcnt++;
 *     AnimObjectTree(SearchObj2, pframe, angle.x, angle.y, angle.z);
 *     lpVertex[vcnt] = pChar->pX + mWorld->_41 ...;   // 骨2
 * }
 * ```
 *
 * 于是带子的每一段 = 一个"过去姿势"的快照；`mFrames=30` ⇒ 相邻段相差 30 帧，
 * 32 段覆盖"起手 → 现在"的整条轨迹（钳到 `StartFrame`，不早于起手）。
 * 姿势没变的那一段**不画**（`Draw():2466` 的 `if (vp1 != vp3 || vp2 != vp4)`）——
 * 所以收招停住时带子会自然收短。
 *
 * ## 参数（`Start():2490`）
 *
 * · `meshName1` / `meshName2` = **两根骨名**（原版 `AnimPattern->GetObjectFromName`，精确匹配）
 * · `liveTime` = 存活帧数（`LiveTime`）；`Alpha` 从 0 起随时间淡出
 * · 贴图 `m_DoomG-01.bmp`、`SMMAT_BLEND_LAMP`（加法混合）、UV 沿 V 按 `1/32` 分片
 *
 * ## 染色（玩家侧）
 *
 * 两条来源，合成规则与数值出处见 `trailTintOf` / `SKILL_TRAIL_TINTS`：
 * · **技能色**（`SetSkillMotionBlurColor` 的 6 个 case，登记在我方技能下标上）；
 * · **武器色**（锻造/合成物 `ColorBlink != 0` ⇒ 其**色表行色**参与染色）——
 *   普攻**一定**叠；技能里只有 Chain Lance 叠（其余 5 个源码 `return TRUE` = 独占）。
 *
 * ## 挂在哪（调用点）
 *
 * · **怪物**：`character.cpp:14081` `AssaMotionBlur(this, "Bip01 R Hand", "bip01 wea", 80)`（D_PA）
 *   另有三处别的怪：`:14031`（`Bip01 R Hand`/`bip01 weapon`）、`:14051`、`:14054`、`:14057`
 * · **玩家近战普攻**走的是**另一套**：`smCHAR::DrawMotionBlur`（`character.cpp:10121`，条件里
 *   带 `ATTACK || SKILL`）+ `DrawMotionBlurTool`（`:10147`，用**武器网格顶点**复制残影，
 *   `PatTool` 非空才画、盾除外）—— **本文件只做前一套**，玩家那套另做。
 *
 * ## 尚未取证的一处（**不要猜，也别当已实现**）
 *
 * 有 12 个调用点在 `Start(...)` 之后还写了 **`motionBlur->Color.R/G/B/A = 200/100/200/100`**
 * （Kelvezu 9 条 + DeathKnight + DevilBird + Chimera，`hoAssaParticleEffect.cpp:1254/1530/1879/4990…5079`），
 * 但**它们如何进入渲染没查清**：
 * · `cAssaMotionBlur::Draw`（`AssaParticle.cpp:2401`）**不读 `Color`**，只 `smRender.Color_A = Alpha`；
 * · 管理器 `DrawAssaEffect`（`AssaEffect.cpp:66-104`）只逐个调 `->Draw(pPosi,pAngle)`，也没套 Color；
 * · 而基类 `cASSAEFFECT::Draw`（`AssaEffect.h:441-465`）**是有**"存旧色→套 `Color`→画→还原"这套的。
 * ⇒ 结论只能到"**这 12 处写了颜色，但本机缺 `smRender` 实现，无法判定它是否生效、以及 `A=100` 是怎么用的**"。
 *   **我方现在一律按白色 + 寿命运衰减**；若日后拿到 `smRender` 源码，先定这一条再决定要不要给带子上色。
 *   （`Alpha` 同理：`Start():2499` 置 0 之后全仓只有 IronFist 的 `SetAlpha(-180)` 写过一处。）
 *
 * ## 设计（AGENTS #15：一份实现，两边共用）
 *
 * "把骨摆到某个历史帧并取世界位置"这步**由调用方以回调传入**（`sample(boneName, frame)`）——
 * 渲染层不持有骨架/求值逻辑（那些是 `char-stage` / `WorldView` 的既有能力 `evalSkeleton`），
 * 于是实验室与游戏共用这一份带子实现，不会各写一遍。
 */
import * as THREE from 'three';
import { reportFallback } from '../../char/fallback-log.js';
import { decodeTextureAsync } from '../../core/texture.js';
// 阶段/种类/KeyCode 的**同一套模型**（AGENTS #15：`monster-attack-fx.ts` 是唯一出处，
// 别在这里再造一份 —— 两张表对"0 还是空串""普攻还是技能"的理解必须一致）
import { keyOf, type FxPhase, type MotionKind } from './monster-attack-fx.js';
// 武器色表行的类型（锻造/合成发光那张表；`BlinkRow` 是 `{r,g,b,a,texMixCode,texScroll}`，
// 曳光只用 r/g/b）—— **只引类型**，不在这一层依赖它的运行时
import type { BlinkRow } from '../../game/agingBlink.js';

/** `Draw():2410-2411` 的两个常量（不是我方调的） */
export const TRAIL_LEVEL = 32;   // 段数 `mLevel`
export const TRAIL_FRAMES = 30;  // 每段回溯帧数 `mFrames`

/**
 * **玩家侧残影染色** —— 原版 `smCHAR::SetSkillMotionBlurColor`
 * （`character.cpp:10119-10163`）。逐字正文与取整口径见任务书
 * `docs/handoff/2026-09-21-枪兵一转三技能特效-任务书.md` §附A 与 §0.1。
 * **键 = 我方技能下标**（§0.1-4，不写源码 `snCHAR_SOUND_*` 码名）。
 *
 * 值 = `clamp(255 + 增量, 0, 255) / 255`（乘性基色、无贴图 ⇒ 基准白 255）；逐字节比对 ⇒ 精确到三位小数。
 * `claims` = 源码对应 case 是否 `return TRUE`：TRUE = **不再叠** `ColorBlink`、FALSE = 叠。
 *   我方没有 `ColorBlink` ⇒ 差异当前不可观察，但照抄源码取值，**禁止把 FALSE 改成 TRUE**（§0.1-2）。
 */
export interface TrailTint {
  /** [0,1] 乘性 RGB（源码 `cDefColor.r/g/b` 归一化） */
  r: number;
  g: number;
  b: number;
  /** 源码该 case 以 `return TRUE` 结尾 ⇒ 不再叠 `ColorBlink`（我方无此机制，仅照抄） */
  claims: boolean;
}

/**
 * 源码 `SetSkillMotionBlurColor` 的 case 表（玩家侧）—— **全 6 个 case 都在**。
 * 未登记 ⇒ `null` = 不带技能色（白色带子）。
 *
 * ⚠ 与 `DrawMotionBlurTool` 的配合（exm `character.cpp:7993-8000`；NSP 同名函数逐字相同）：
 *   `cnt = SetSkillMotionBlurColor(AttackSkil)`，随后 `if (!cnt && ChrTool->ColorBlink) 叠武器色`。
 *   ⇒ `claims = true`（源码该 case `return TRUE`）时**只有技能色**；`claims = false`（加了色后
 *   `break` 落到 `return FALSE`）时**技能色 + 武器色（色表色 `>> 1`）都叠**。普攻（`AttackSkil == 0`）
 *   不进这个 switch ⇒ 一律叠武器色。
 */
export const SKILL_TRAIL_TINTS: ReadonlyMap<number, TrailTint> = new Map<number, TrailTint>([
  // ── 枪兵(Pikeman) ──
  // Critical Hit：`SKILL_PLAY_CRITICAL_HIT`(17) → 信息表首列（图标号）14 ⇒ 我方 `tp14 cri_hit.bmp` = 43。
  // 源码 `Color_R += 256; Color_G += -64; Color_B += 256; return TRUE`。§0.1-2。
  [43, { r: 1.0, g: 0.749, b: 1.0, claims: true }],
  // Chain Lance：`SKILL_PLAY_CHAIN_LANCE`(24) ⇒ 我方 = 52。同样的 `+256/-64/-64`，但结尾是 `break`
  // ⇒ 落到 `return FALSE` ⇒ **技能色与武器色都叠**（本表唯一 claims=false）。§0.1-2。
  [52, { r: 1.0, g: 0.749, b: 0.749, claims: false }],

  // ── 战士(Fighter) 一转/二转 —— 2026-09-23 补齐（此前标注"待下标"，现把取证链写在这里）──
  // 四条同构，取证链（每条都能复算）：
  //   ① 技能 → 播放码：`SkillSub.cpp` 里该技能处理函数内的 `AttackSkil = SKILL_PLAY_*`（行号见各条）；
  //   ② 播放码 → 常量值：`character.h:163-166`（`SKILL_PLAY_RAVING`=29 … `BRUTAL_SWING`=32）；
  //   ③ 技能 → 图标号：`Language/English/e_sinSkill_Info.h` 每行**首列就是图标号**（14/17/20/23），
  //      名字也在同一行（"Raving" / "Impact" / "Triple Impact" / "Brutal Swing"）；
  //   ④ 图标号 → 我方下标：`src/game/data/skillIndexByIcon.ts`（`tf14 raving.bmp`=23 … `tf23 b_swing.bmp`=26）。
  // 四个 case 都是 `return TRUE` ⇒ `claims = true`（不叠武器色）。
  // Raving Blow：`SkillSub.cpp:1818`；首列 14 ⇒ 下标 **23**；`+256/-64/-64`。
  [23, { r: 1.0, g: 0.749, b: 0.749, claims: true }],
  // Impact：`SkillSub.cpp:1865`；首列 17 ⇒ 下标 **24**；`+256/+256/-64`。
  [24, { r: 1.0, g: 1.0, b: 0.749, claims: true }],
  // Triple Impact：`SkillSub.cpp:2382`；首列 20 ⇒ 下标 **25**；`+256/-64/+256`。
  [25, { r: 1.0, g: 0.749, b: 1.0, claims: true }],
  // Brutal Swing：`SkillSub.cpp:2434`；首列 23 ⇒ 下标 **26**；`-64/+256/+128`（B 加到 383 ⇒ 截 255 = 1.000）。
  [26, { r: 0.749, g: 1.0, b: 1.0, claims: true }],
]);

/** T1 出入口：技能下标 → 染色值（`null`/未登记 ⇒ 不染色）。消费点只此一处（AGENTS #15）。 */
export function trailTintOfSkill(skillIndex: number | null): TrailTint | null {
  if (skillIndex == null) return null;
  return SKILL_TRAIL_TINTS.get(skillIndex) ?? null;
}

/**
 * **武器色进入曳光的强度** —— `0.5` = "从白向武器色走一半"。
 *
 * 原版是 `smRender.Color_R += sColors[SMC_R] >> 1`（色表色的**一半**）加到**当时的渲染色**上，
 * 而那个渲染色是场景/昼夜色（约 0.4~0.6 亮）——**我们这条带子没有"场景色"这一项**（`uColor` 基准恒为白），
 * 照搬会把所有通道顶到 1（白）而看不出颜色。故取"白 → 武器色走一半"作等价观感。
 *
 * ⚠ 这是**我们的映射决定**（原式不可直接搬），不是源码数值 —— 别当成"照抄"来引用。
 */
export const WEAPON_TINT_MIX = 0.5;

/**
 * 曳光的**最终**染色 = 技能色 ⊕ 武器色（原版 `DrawMotionBlurTool` 里那两段的合成）。
 *
 * 源码（exm `character.cpp:7993-8000`，NSP 同名函数逐字相同）：
 * ```c
 * if (AttackSkil) cnt = SetSkillMotionBlurColor(AttackSkil);   // 只有那 6 个 case、其中 5 个返回非 0
 * if (!cnt && ChrTool->ColorBlink) { Color_R += sColors[R] >> 1; … }   // 武器色（锻造/合成才有 ColorBlink）
 * ```
 * ⇒ 谁能叠：
 *   · 技能在表里且 `claims === true`（源码 `return TRUE`）⇒ **技能色独占**，武器色不叠；
 *   · 技能在表里但 `claims === false`（只有 Chain Lance）⇒ 技能色 **+** 武器色；
 *   · 技能**不在表里**（含普攻传 `null`）⇒ 只叠武器色 —— 注意这与"未登记=白色"**不同**：
 *     源码里未登记的技能同样落到 `return FALSE`，所以它也会被武器色染色。
 *
 * @param skillIndex 这一刀是哪个技能下标（普攻传 `null`）
 * @param weaponRow  该手的发光色表行（`blinkRowOfAppearance(外观, 'main')`）；
 *                   `null` = 未锻造/未合成（原版 `ColorBlink == 0`）⇒ 不叠武器色
 * @returns `null` = 不染色（复位白）—— 只有"既无技能色也无武器色"才是 `null`。
 *          `claims` 字段在返回值里只是把输入带出来，消费方只用 `r/g/b`。
 */
export function trailTintOf(skillIndex: number | null, weaponRow: BlinkRow | null): TrailTint | null {
  const skill = trailTintOfSkill(skillIndex);
  const row = weaponRow && skill?.claims !== true ? weaponRow : null;
  if (!skill && !row) return null;
  // 白 = 1；武器色 = 色表色/255；两者按 WEAPON_TINT_MIX 混（技能色存在时以它为基础）
  const k = WEAPON_TINT_MIX;
  const mix = (base: number, target: number): number => base + (target - base) * k;
  const r = row ? mix(skill ? skill.r : 1, row.r / 255) : skill!.r;
  const g = row ? mix(skill ? skill.g : 1, row.g / 255) : skill!.g;
  const b = row ? mix(skill ? skill.b : 1, row.b / 255) : skill!.b;
  return { r, g, b, claims: skill ? skill.claims : false };
}

/** 载入曳光贴图（原版 `AssaSearchRes("m_DoomG-01.bmp", …)`）。
 *
 * ⚠ **必须走 `core/texture.ts` 的解码器** —— PT 的 bmp/tga **文件头是加密的**
 *   （`DecryptBMP`，`Chrono` 源码 `UIImageLoader.cpp:15`：头两字节不是 `BM` 时 `bytes[2..13] -= i*i`），
 *   浏览器 `<img>` / `THREE.TextureLoader` **解不了**（实测 `img ERROR`、`InvalidStateError`）。
 *   `core/texture.ts` 已经实现了这套解密（且与 PT 源码逐字一致）—— **不要另写一份**。
 *
 * 返回的纹理是**立即可用**的 1×1 占位，真数据在异步解码完成后填进 `image` 并 `needsUpdate`
 * ⇒ 调用方不必 await（第一次挥击可能还没贴图，之后就会带上）。
 */
export function loadTrailTexture(url: string): THREE.Texture {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  void (async () => {
    try {
      const buf = await fetch(url).then((r) => r.arrayBuffer());
      const dec = await decodeTextureAsync(buf);
      if (!dec) {
        reportFallback('fx', `武器曳光贴图「${url}」解不出来（PT 加密头解密失败？）⇒ 带子将只有占位白点`);
        return;
      }
      tex.image = { data: dec.pixels, width: dec.width, height: dec.height };
      // ⚠ **必须先 `dispose()`**：这张纹理已经以 **1×1** 上传过一次；直接 `needsUpdate` 会让 three
      //   走 `texSubImage2D`（**增量更新**）⇒ 拿 64×64 的数据去更新 1×1 的纹理 ⇒
      //   `GL_INVALID_VALUE: Offset overflows texture dimensions`，纹理报废、曳光什么都不显示（用户实测）。
      //   dispose 会释放 GL 纹理 ⇒ 下次上传走 `texImage2D`（全量、按新尺寸分配）。
      tex.dispose();
      tex.needsUpdate = true;
    } catch (e) {
      reportFallback('fx', `武器曳光贴图「${url}」取不到：${String(e)}`);
    }
  })();
  return tex;
}

/**
 * 一条曳光的登记 —— 原版 `motionBlur->Start(pChar, 骨A, 骨B, liveTime)` 的四个参数，
 * **外加"在哪个函数的哪条分支里被调用"**。
 *
 * ⚠ **同一个 effectId 在不同函数里是完全不同的分支**，所以 `kind`/`timing`/`keyCode` 三者缺一不可：
 *   · Kelvezu `0x1830`：**普攻**（`BeginAttack_Monster:13927-13935`）= `KeyCode=='P'` → 翅膀 70 帧、
 *     否则**手指** 70 帧；**技能**（`BeginSkill_Monster:14010-14019`）= `KeyCode=='I'` → 翅膀 **200 帧**、
 *     否则**尾巴** 90 帧。我最初只按 effectId 登记一张表（翅膀+手指+尾巴混在一起、寿命一律取 70），
 *     于是技能 1（'I'）的翅膀带子 1.2 秒就没了 —— **用户实测报的就是这一条**。
 */
export interface WeaponTrailDef {
  /** 怪物 effect id（原版 `snCHAR_SOUND_*`，`effectsnd.h`） */
  effectId: number;
  /** 哪个函数：`'attack'` = `BeginAttack_Monster` / `EventAttack`；`'skill'` = `BeginSkill_Monster` / `EventSkill_Monster` */
  kind: MotionKind;
  /** 该分支所在阶段：`'cast'` = 起手（两个 `Begin*`）／`'event'` = 事件帧（`EventAttack`/`EventSkill_Monster`） */
  timing: FxPhase;
  /**
   * 该分支要求的 `MotionInfo->KeyCode`（**大写**）：
   *   · 精确码（多值连写，如技能大师的 `'BNY'`）⇒ 只在这个码上成立；
   *   · `''` ⇒ 源码的 **`else`** 分支，或该 case **根本不看** KeyCode。
   */
  keyCode: string;
  /** 源码写成 `if (KeyCode != X)` 的**排除**式（DeathKnight 的 `'L'`、DevilBird 的 `'B'`） */
  excludeKeyCode?: string;
  /**
   * **骨对** —— `Start(pChar, 骨A, 骨B, liveTime)` 的第 2/3/4 个参数，**按源码里的调用顺序**。
   * ⚠ **一个分支可以有多对**：Kelvezu 翅膀 4 条、手指 3 条、尾巴 2 条，IronFist 左右手各一条，
   *   DevilBird 3 条 —— 逐对**各建一条**，不是取第一对。
   */
  pairs: ReadonlyArray<{ bone1: string; bone2: string; liveTime: number; delay?: number }>;
  /** 出处（本机可点开：`character.cpp` 的分派行 + `hoAssaParticleEffect.cpp` 的创建行） */
  note: string;
}

/**
 * **原版所有 `cAssaMotionBlur` 创建点的登记表**（逐条照抄三个分派函数）。
 *
 * 覆盖范围 = 全部创建点：`character.cpp` 的 `BeginAttack_Monster`(:13901) / `BeginSkill_Monster`(:13951)
 * / `EventAttack`(:4151) / `EventSkill_Monster`(:14092) 四个函数里的每一个分支，
 * 对应 `hoAssaParticleEffect.cpp` 的 9 个具名函数 + `AssaMotionBlur()` 包装（:2659）。
 * 每个分支一条 —— 所以同为 `0x1830` 会有 4 条（普攻 'P'/else、技能 'I'/else）。
 */
export const WEAPON_TRAILS: readonly WeaponTrailDef[] = [
  // ===== 普攻起手 `smCHAR::BeginAttack_Monster()`（character.cpp:13901） =====
  { effectId: 0x1460, kind: 'attack', timing: 'cast', keyCode: '',
    pairs: [{ bone1: 'Bip-skill01', bone2: 'Bip-skill', liveTime: 50 }],
    note: 'character.cpp:13908 case snCHAR_SOUND_DARKKNIGHT → AssaParticle_DoomGuardHit1（:2636 的 Start(…,50)）；'
      + '**外层还有 `if (smCharInfo.Level >= 65)`**（低于 65 级这一招没有带子）' },
  { effectId: 0x1680, kind: 'attack', timing: 'cast', keyCode: '', excludeKeyCode: 'L',
    pairs: [{ bone1: 'Bip01gho01', bone2: 'Bip01gho02', liveTime: 70 }],
    note: 'character.cpp:13918 `if (MotionInfo->KeyCode != \'L\') ParkValentSwordShow(this, 70)`（:1235）' },
  { effectId: 0x1810, kind: 'attack', timing: 'cast', keyCode: '', excludeKeyCode: 'B',
    pairs: [
      { bone1: 'Bip01 handbone01', bone2: 'Bip01 handbone02', liveTime: 30 },
      { bone1: 'Bip01 wingbong01', bone2: 'Bip01 wingbong03', liveTime: 30 },
      { bone1: 'Bip01 wingbong02', bone2: 'Bip01 wingbong04', liveTime: 30 }],
    note: 'character.cpp:13923 `if (MotionInfo->KeyCode != \'B\') ParkDevilBirdAttackBlur(this)`（:1527）'
      + ' → ParkDevilBirdBlur(0/1/2)（:1497，每条 `Start(…,30)`）**3 条**；'
      + '技能侧 `BeginSkill:14008 → DevilBird_Skill` 只加载 `DevilBirdSkill.lua`，**没有** blur' },
  { effectId: 0x1830, kind: 'attack', timing: 'cast', keyCode: 'P',
    pairs: [
      { bone1: 'Bip01 Rwing03', bone2: 'Bip01 Rwing02', liveTime: 70 },
      { bone1: 'Bip01 Rwing02', bone2: 'Bip01 Rwing01', liveTime: 70 },
      { bone1: 'Bip01 Lwing03', bone2: 'Bip01 Lwing02', liveTime: 70 },
      { bone1: 'Bip01 Lwing02', bone2: 'Bip01 Lwing01', liveTime: 70 }],
    note: 'character.cpp:13929-13931 `if (KeyCode == \'P\') ParkKelvezuWingShow(this, 70)` → WingShow（:4983）4 条' },
  { effectId: 0x1830, kind: 'attack', timing: 'cast', keyCode: '',
    pairs: [
      { bone1: 'Bip01 Hand', bone2: 'Bip01 Fin03', liveTime: 70 },
      { bone1: 'Bip01 Hand', bone2: 'Bip01 Fin02', liveTime: 70 },
      { bone1: 'Bip01 Hand', bone2: 'Bip01 Fin01', liveTime: 70 }],
    note: 'character.cpp:13933-13935 `else ParkKelvezuFingerShow(this, 70)` → FingerShow（:4949）**3 条**；'
      + '调用顺序是 Fin03 → Fin02 → Fin01（照抄，别按编号排）' },
  { effectId: 0x1860, kind: 'attack', timing: 'cast', keyCode: '',
    pairs: [{ bone1: 'Bip01 asw', bone2: 'Bip01 asw01', liveTime: 70 }],
    note: 'character.cpp:13940 case snCHAR_SOUND_CHIMERA → ParkAssaParticle_ChimeraNormal（:1872，`nTime = 70`）' },

  // ===== 技能起手 `smCHAR::BeginSkill_Monster()`（character.cpp:13951） =====
  { effectId: 0x1460, kind: 'skill', timing: 'cast', keyCode: '',
    pairs: [{ bone1: 'Bip-skill01', bone2: 'Bip-skill', liveTime: 150 }],
    note: 'character.cpp:13969 → AssaParticle_DoomGuardHit2（:2689 的 Start(…,150)）；同样受 `Level >= 65` 限制' },
  { effectId: 0x1680, kind: 'skill', timing: 'cast', keyCode: '',
    pairs: [{ bone1: 'Bip01gho01', bone2: 'Bip01gho02', liveTime: 70 }],
    note: 'character.cpp:14004 `ParkValentSwordShow(this, 70)`（无 KeyCode 条件）' },
  { effectId: 0x1830, kind: 'skill', timing: 'cast', keyCode: 'I',
    pairs: [
      { bone1: 'Bip01 Rwing03', bone2: 'Bip01 Rwing02', liveTime: 200 },
      { bone1: 'Bip01 Rwing02', bone2: 'Bip01 Rwing01', liveTime: 200 },
      { bone1: 'Bip01 Lwing03', bone2: 'Bip01 Lwing02', liveTime: 200 },
      { bone1: 'Bip01 Lwing02', bone2: 'Bip01 Lwing01', liveTime: 200 }],
    note: 'character.cpp:14011-14013 `if (KeyCode == \'I\') ParkKelvezuWingShow(this, 200)` —— **技能 1 的翅膀是 200 帧**'
      + '（≈3.3 秒 @60fps）；用户实测"1 秒左右就没了"就是因为我把这里的寿命登记成了普攻那条的 70' },
  { effectId: 0x1830, kind: 'skill', timing: 'cast', keyCode: '',
    pairs: [
      { bone1: 'Bip01 Tale01', bone2: 'Bip01 Tale02', liveTime: 90 },
      { bone1: 'Bip01 Tale02', bone2: 'Bip01 Tale03', liveTime: 90 }],
    note: 'character.cpp:14015-14019 `else { ParkKelvezuTaleShow(this, 90); ParkKelvezuSkill2(this); }` → TaleShow（:5026）2 条'
      + '（`ParkKelvezuSkill2` 不是带子，见它的函数体）' },
  { effectId: 0x1950, kind: 'skill', timing: 'cast', keyCode: 'Z',
    pairs: [{ bone1: 'Bip01 R Hand', bone2: 'bip01 wea', liveTime: 80 }],
    note: "character.cpp:14078-14083 case snCHAR_SOUND_REVIVED_PIKEMAN：外层 `if (chrAttackTarget)`，内层 `case 'Z'`"
      + ' → AssaMotionBlur（:2659 包装 → :2662 Start(…,80)）。**普攻侧没有这个 case** ⇒ 普攻不该有带子' },
  { effectId: 0x2020, kind: 'skill', timing: 'cast', keyCode: 'BNY',
    pairs: [{ bone1: 'Bip01 R Hand', bone2: 'bip01 weapon', liveTime: 80 }],
    note: "character.cpp:14039-14042 case snCHAR_SOUND_NPC_SKILLMASTER 的 KeyCode 内层 switch：'B'/'N'/'Y' 三条走同一句"
      + "（'A'/'M' 空、'L' 走 SkillLancelotChargingStrike）" },
  { effectId: 0x5100, kind: 'skill', timing: 'cast', keyCode: '',
    pairs: [{ bone1: 'Bip01_w', bone2: 'Bip01 Effect', liveTime: 80 }],
    note: 'character.cpp:14051 case snCHAR_SOUND_CASTLE_SOLDER_A（无 KeyCode 条件）' },
  { effectId: 0x5110, kind: 'skill', timing: 'cast', keyCode: '',
    pairs: [{ bone1: 'Bip01 waraxe', bone2: 'Bip01 Effect', liveTime: 80 }],
    note: 'character.cpp:14054 case snCHAR_SOUND_CASTLE_SOLDER_B' },
  { effectId: 0x5120, kind: 'skill', timing: 'cast', keyCode: '',
    pairs: [{ bone1: 'Bip01 Sword', bone2: 'Bip01 Effect', liveTime: 80 }],
    note: 'character.cpp:14057 case snCHAR_SOUND_CASTLE_SOLDER_C' },

  // ===== 事件帧：`EventAttack`(:4151) / `EventSkill_Monster`(:14092) =====
  // ⚠ 这三条的源码触发点是**事件帧**（`timing: 'event'`）。我方目前的调用点只有"起手"，
  //   查表时会命中它们并**说明用了事件帧那条**（`via: 'eventPhase'`）—— 不静默。
  { effectId: 0x1470, kind: 'attack', timing: 'event', keyCode: '',
    pairs: [{ bone1: 'bip01 s01', bone2: 'bip01 s02', liveTime: 25 }],
    note: 'character.cpp:4531（在 `smCHAR::EventAttack` 的 `case snCHAR_SOUND_GUARDIAN_SAINT`）'
      + ' → AssaParticleClanMonsterHit2（:3101 的 Start(…,25)）' },
  { effectId: 0x1540, kind: 'skill', timing: 'event', keyCode: '',
    pairs: [
      { bone1: 'Bip01 Box05', bone2: 'Bip01 L Hand', liveTime: 45, delay: 15 },
      { bone1: 'Bip01 Box08', bone2: 'Bip01 R Hand', liveTime: 45, delay: 15 }],
    note: 'character.cpp:14353 case snCHAR_SOUND_IRONFIST → AssaParticle_MonsterIronFist（:2721/:2729，**左右手各一条**）；'
      + '两条都是 **`SetDelay(15)` + `SetAlpha(-180)`**（:2724-2725 / :2732-2733，逐字）' },
  { effectId: 0x1340, kind: 'skill', timing: 'event', keyCode: '',
    pairs: [{ bone1: 'Bip-skill-01', bone2: 'Bip-skill-02', liveTime: 20, delay: 2 }],
    note: 'character.cpp:14167-14172 `case snCHAR_SOUND_RATOO: if (chrAttackTarget) AssaParticle_RatooHit1(this)`'
      + ' → :2875 `Start(…,20)`；**SetDelay(2)**（:2877，逐字）' },
];

/**
 * **一个怪物身上全部武器曳光** —— 实验室与游戏**共用这一份**（AGENTS #15：
 * "同一个判定/算法在仓库里出现第二份，哪怕只差一点，就是 bug 的种子"）。
 *
 * 生命周期照源码：**起手**（`BeginAttack_Monster`/`BeginSkill_Monster`）或**事件帧**
 * （`EventAttack`/`EventSkill_Monster`）时 `new cAssaMotionBlur`，活 `LiveTime` 帧后被管理器
 * `delete`（`AssaEffect.cpp:112-124`）。所以：
 *   · 只在 `ATTACK`/`SKILL` 动作态里画（`inAction`）—— 站立/走路时原版**没有这些对象**；
 *   · 一次挥击 = 一条新带子（`restart()`），判据见 `update()` 里的三条；
 *   · 阶段对不上就**什么都不画**（起手拿不到事件帧那条，反之亦然）。
 */
export class MonsterTrails {
  /** 当前生效的那条登记 + 它的带子（**按登记对象判等**：换了分支 ⇒ 骨对/寿命都不同 ⇒ 整组重建） */
  private cur: { def: WeaponTrailDef; trs: Array<WeaponTrail | null> } | null = null;
  /** 上一帧的动作条目**对象身份**（判"换了一招"） */
  private lastMotion: unknown = null;
  private lastFrame = -1;
  /** 本招的**事件帧**到了没有（只对 `timing: 'event'` 那条有意义） */
  private eventArmed = false;
  /** 事件帧那一下要**从头起算**这条带子（`new` 的语义） */
  private restartPending = false;
  /** 查表结果打过哪几行（按 kind/阶段/via/登记键去重，不是"只打一次"） */
  private readonly logged = new Set<string>();
  /** 骨采样闭包要读它 —— 只在 `update()` 期间有效 */
  private ctx: MonsterTrailFrame | null = null;

  constructor(
    private readonly opts: {
      /** 诊断用：哪个怪（进日志） */
      who: string;
      /** 原版 `smCharInfo.dwCharSoundCode`（= `snCHAR_SOUND_*`） */
      effectId: number;
      /** 诊断输出（实验室的日志面板 / 游戏的 console） */
      log?: (msg: string) => void;
    },
  ) {}

  /** **起手**时调（`BeginAttack_Monster`/`BeginSkill_Monster` 那一刻） */
  onSwingStart(): void { this.eventArmed = false; this.restartPending = false; }

  /** **事件帧**命中那一下调（`EventSkill_Monster`/`EventAttack` 才 `new` 的那条从此刻起算） */
  onEventFrame(): void { this.eventArmed = true; this.restartPending = true; }

  dispose(): void {
    for (const tr of this.cur?.trs ?? []) { tr?.dispose(); tr?.object.removeFromParent(); }
    this.cur = null;
  }

  update(ctx: MonsterTrailFrame): void {
    this.ctx = ctx;
    if (!ctx.inAction) {
      // 站立/走路/死亡…：原版这些对象不存在（带子属于某一次挥击）
      for (const tr of this.cur?.trs ?? []) tr?.hide();
      this.eventArmed = false;
      this.ctx = null;
      return;
    }
    // **两个阶段各查一次**：源码里带子要么在起手 `new`、要么在事件帧 `new`，从不"起手先建、
    // 事件帧再补"（Ratoo 就是后者 —— 起手建会让光在"举武器"阶段就烧完，劈下来时没有，用户实测）
    const castHit = findWeaponTrailDef(this.opts.effectId, ctx.kind, 'cast', ctx.keyCode);
    const eventHit = castHit ? null : findWeaponTrailDef(this.opts.effectId, ctx.kind, 'event', ctx.keyCode);
    const hit = castHit ?? eventHit;
    const def = hit?.def ?? null;
    const waiting = !!eventHit && !this.eventArmed;      // 事件帧那条：还没到事件帧
    const phase = castHit ? 'cast' : eventHit ? 'event' : '-';
    const kcName = ctx.keyCode ? `'${String.fromCharCode(ctx.keyCode)}'` : "''";
    const diagKey = `${ctx.kind}|${phase}|${hit?.via ?? '-'}|${def?.keyCode ?? '-'}|${kcName}`;
    if (!this.logged.has(diagKey)) {
      this.logged.add(diagKey);
      this.opts.log?.(`[曳光] 查表：${this.opts.who} effectId=0x${this.opts.effectId.toString(16)}`
        + ` kind=${ctx.kind} keyCode=${ctx.keyCode ?? '-'}（${kcName}）`
        + (def
          ? ` → 命中 ${phase} 阶段 / ${hit!.via}（登记 keyCode='${def.keyCode}'）`
            + def.pairs.map((p) => `${p.bone1}/${p.bone2}(${p.liveTime}帧${p.delay ? `+延迟${p.delay}` : ''})`).join('、')
            + (phase === 'event' ? '　⏳ 等事件帧（源码在 `EventSkill_Monster`/`EventAttack` 才 new）' : '')
          : ` → **${ctx.kind} 这一招没有带子**（该怪未登记 / 该 KeyCode 这一支本来就不画）`));
    }
    if (this.cur && this.cur.def !== def) {
      this.dispose();                                    // 换了分支：骨对与寿命都不同，整组重建
    }
    if (!def || waiting) {
      for (const tr of this.cur?.trs ?? []) tr?.hide();
      this.ctx = null;
      return;
    }
    if (!this.cur) this.cur = { def, trs: def.pairs.map(() => null) };
    const trs = this.cur.trs;
    // **一次挥击 = 一条新带子**（原版每挥一次 `new cAssaMotionBlur`，活 `LiveTime` 帧后销毁）。
    // 三条判据**并列**（都是精确条件）：
    //   ① **动作条目换了** —— idle→attack 时帧号是**变大**的（待机几十帧 → 起手 280），只看回绕判不到；
    //   ② **同一条目重放** —— 帧号回绕（末帧 450 → 起手 280）；
    //   ③ **事件帧那条刚刚到**（`restartPending`）—— 它的一生从事件帧起算，不在起手。
    const newSwing = this.lastMotion !== ctx.motion || ctx.frame < this.lastFrame || this.restartPending;
    this.restartPending = false;
    for (let pi = 0; pi < def.pairs.length; pi++) {
      const pair = def.pairs[pi]!;
      let tr = trs[pi];
      if (!tr) {
        tr = createWeaponTrail({
          liveTime: pair.liveTime,
          delay: pair.delay,               // 只有 IronFist(15) / Ratoo(2) 有（源码 `SetDelay`）
          label: `${pair.bone1} / ${pair.bone2}`,
          // 怪物侧：**两根骨**在那一历史帧的世界位置（`cAssaMotionBlur::Draw:2433-2444`）——
          // 采样由调用方注入（实验室走 `AnimPlayer.sampleBoneEnds`、游戏走 `evalBoneFrame`）
          sample: (f) => this.samplePair(pair.bone1, pair.bone2, f),
          log: this.opts.log,
        });
        ctx.addToScene(tr.object);       // 顶点已是世界坐标 ⇒ 挂场景下，不跟随角色变换
        trs[pi] = tr;
      }
      if (newSwing) tr.restart();
      // ⚠ `startFrame` 与 `frame` 必须**同单位**（本项目 = 原版帧 ×160）：不同单位会让
      //   `Draw():2430` 那条"钳到起手帧"恒不成立 ⇒ 带子采到**本动作之外**的帧（另一个动作的姿势）
      tr.update(ctx.frame, ctx.startFrame);
    }
    this.lastMotion = ctx.motion;
    this.lastFrame = ctx.frame;
    this.ctx = null;
  }

  /** 取某一历史帧上两根骨的世界位置（调用方注入的 `sampleBone` 负责补角色 root 变换） */
  private samplePair(bone1: string, bone2: string, f: number): { a: THREE.Vector3; b: THREE.Vector3 } | null {
    const c = this.ctx;
    if (!c) return null;
    const va = c.sampleBone(bone1, f);
    const vb = c.sampleBone(bone2, f);
    if (!va || !vb) return null;
    return { a: va, b: vb };
  }
}

/** 每帧喂给 `MonsterTrails.update` 的一帧上下文（实验室与游戏各填各的） */
export interface MonsterTrailFrame {
  /** 正在播的是普攻还是技能（原版 `BeginAttack_Monster` / `BeginSkill_Monster` 是**两个函数**） */
  kind: MotionKind;
  /** 动作的 `MotionInfo->KeyCode`（ASCII；`0`/`null` = 走 `''` 键） */
  keyCode: number | null | undefined;
  /** 是否在挥击/施法状态里（`ATTACK`/`SKILL`）—— 不在就什么都不画 */
  inAction: boolean;
  /** 当前动作的**对象身份**（判"换了一招"用；只看帧号回绕会漏掉 idle→attack） */
  motion: unknown;
  /** 当前帧 / 该动作起手帧 —— **同一单位**（本项目 = 原版帧 ×160） */
  frame: number;
  startFrame: number;
  /** 某根骨在**历史帧**上的**世界**坐标（调用方负责 `root.matrixWorld`）。取不到返回 `null` */
  sampleBone: (bone: string, frame: number) => THREE.Vector3 | null;
  /** 把带子的 `Object3D` 挂进场景（每个骨对**只调一次**） */
  addToScene: (o: THREE.Object3D) => void;
}
/** 查表结果：命中了哪一条 + **命中的是源码的哪一支** */
export interface WeaponTrailHit {
  def: WeaponTrailDef;
  /** `'keyCode'` = 精确 KeyCode 命中；`'else'` = 源码的 `else`／该 case 不看 KeyCode */
  via: 'keyCode' | 'else';
}

/** 一条登记是否匹配（`pass = 'exact'` 查精确 KeyCode，`'else'` 查 `keyCode === ''` 那一支） */
function trailPassMatches(def: WeaponTrailDef, pass: 'exact' | 'else', kc: string): boolean {
  if (def.excludeKeyCode !== undefined && kc === def.excludeKeyCode) return false;
  return pass === 'exact' ? (kc !== '' && def.keyCode.includes(kc)) : def.keyCode === '';
}

/**
 * **查表 —— 唯一实现**（AGENTS #15）：实验室与游戏共用这一份，
 * 参数与 `monster-attack-fx.ts` 的 `resolveMonsterFx` 同构（`kind` + `timing` + `keyCode`）。
 *
 * ⚠ **只看请求的那个阶段**（`timing`）：起手的调用点不该拿到"事件帧那条"，反之亦然 ——
 *   否则 Ratoo 这种"只在事件帧才有带子"的怪会在**举武器**时就把光烧完（用户实测：
 *   "技能 1 只有开头举起武器的一段有光，劈下来的时候没光"）。阶段对不上就返回 `null`，
 *   由调用方在自己那个时刻（起手 / 事件帧）再查一次。
 *
 * @param keyCode 原版 `MotionInfo->KeyCode`（ASCII；`0`/`null` ⇒ 走 `''` 键）
 * @returns `null` = 这一刻原版没有带子（无登记条目 / 该 KeyCode 那一支本来就不画 / 阶段不符）
 */
export function findWeaponTrailDef(
  effectId: number, kind: MotionKind, timing: FxPhase, keyCode?: number | null,
): WeaponTrailHit | null {
  const kc = keyCode == null ? '' : keyOf(keyCode);
  for (const pass of ['exact', 'else'] as const) {
    for (const def of WEAPON_TRAILS) {
      if (def.effectId !== effectId || def.kind !== kind || def.timing !== timing) continue;
      if (!trailPassMatches(def, pass, kc)) continue;
      return { def, via: pass === 'exact' ? 'keyCode' : 'else' };
    }
  }
  return null;
}

export interface WeaponTrailDeps {
  /**
   * **取某一段的两个端点**（按历史帧）—— 两侧共用一个机制，只有"端点怎么算"不同：
   *   · **怪物**（`cAssaMotionBlur::Draw:2433-2444`）：两根**骨**在那一历史帧的世界位置；
   *   · **玩家**（`smCHAR::DrawMotionBlurTool:10214-10245`）：**同一根骨**（`ChrTool->ObjBip`）
   *     + 沿骨轴的两点 —— 原点与 `(0,0,SizeMax)`（`SizeMax` = 武器网格 `maxY`，
   *     `character.cpp:1981-1988`），段数/回溯帧数另有**两套**（`ActionPattern==0` → 32×40，否则 16×80）。
   * 返回 `null` = 这一帧取不到（骨不在 / 没有武器）⇒ 那一段写零、并**上报一次**。
   */
  sample: (frame: number) => { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } } | null;
  /**
   * **起手后延迟多少帧才出现**（原版 `SetDelay(n)` → `Main():2374-2392` 的 `StartDelay`：
   * `Draw():2405` 在 `StartDelay > 0` 时**直接 return** ⇒ 那几帧什么都不画）。
   * 全仓只有两处设过它（`hoAssaParticleEffect.cpp`，逐字）：**IronFist `SetDelay(15)`**（`:2724/2732`）、
   * **Ratoo `SetDelay(2)`**（`:2877`）。其余 11 处不延迟。
   * ⚠ 延迟结束时原版把 `TimeCount` **清零**（`Main():2390`）⇒ 寿命从那帧起算，不是从起手算。
   */
  delay?: number;
  /**
   * 存活帧数。**省略 = 常驻**（`alpha` 恒 1，不按寿命衰减）。
   *
   * ⚠ 两侧语义不同（源码就是这样，不是我方差异）：
   *   · **怪物** `cAssaMotionBlur`（`AssaParticle.cpp:2365 Main` / `:2490 Start`）：每挥一次
   *     `new` 一个，活 `LiveTime` 帧后销毁 ⇒ 传 `liveTime`；
   *   · **玩家** `DrawMotionBlurTool`：由 `DrawMotionBlur` **每帧调用**，带子靠"回溯历史帧"构成，
   *     **没有生命周期** ⇒ **不要传**（传了反而要靠 restart 判"新一轮"，而帧号不回绕时判不到，
   *     用户实测"有时候莫名其妙攻击没有曳光"）。
   */
  liveTime?: number;
  /**
   * **每段回溯帧数** —— 原版是**两套**，不是一套：
   *   · 怪物 `cAssaMotionBlur::Draw:2411` → `mFrames = 30`（默认）
   *   · 玩家 `smCHAR::DrawMotionBlurTool:10173-10187` → `ActionPattern == 0` 时 **40**，否则 80
   *     （近战普攻/技能走默认 0 ⇒ **40**）
   * ⚠ 我一度把 30 写死、玩家侧也用了 30 —— 那是错的（两处源码给的数不同）。
   */
  framesPerLevel?: number;
  /** 诊断用标签（例如 `Bip01 R Hand / bip01 wea`），只进日志 */
  label: string;
  /** 诊断输出（实验室的日志面板）——`reportFallback` 进的是 `fallback-log`，**实验室看不见**，
   *  所以"画不出来"这类必须**同时**打进这里（否则又是我看不见、你也看不见的静默失败）。 */
  log?: (msg: string) => void;
}

export interface WeaponTrail {
  /**
   * 每帧调：`frame` = 当前动画帧；`startFrame` = 该动作的起手帧（`MotionInfo->StartFrame`）。
   * ⚠ 两者的单位必须一致（本项目的帧号是 `advance()` 那套 = 原版帧 ×160）——
   *   传了不同单位的 `startFrame`，`Draw():2430` 那条钳位就**恒不生效**，带子会采到本动作之外的帧。
   */
  update(frame: number, startFrame: number): void;
  /** 起手时调（原版 `Start` 里 `TimeCount = 0; Alpha = 0;`） */
  restart(): void;
  /**
   * **不在挥击/施法时调** —— 原版每帧画之前先过闸门（`smCHAR::DrawMotionBlur` `character.cpp:10134`
   * 的 `if (ShootingMode || …) return FALSE;`），且这些对象**只在起手分支里 `new`**（存在时间 = 一次挥击）。
   * ⚠ 不隐藏而是"停更"的话，带子会**冻在最后一帧**的位置（常驻那条 `alpha` 恒 1）——
   *   屏幕上是一条静止的带子挂在半空。
   */
  hide(): void;
  /** 已存活帧数（`TimeCount`）/ 是否已超寿命 */
  readonly expired: boolean;
  readonly object: THREE.Object3D;
  /**
   * 设/清残影染色（写入 shader 的 `uColor`）。玩家侧由 `trailTintOfSkill` 决定；`null` = 复位白。
   * ⚠ **每帧在 `update()` 之前**调用（`update` 每帧写 `uAlpha`、也会刷新 uniform），不是"设一次"。
   */
  setTint(t: TrailTint | null): void;
  dispose(): void;
}

/**
 * 建一条武器曳光。
 *
 * ⚠ 顶点数 = `TRAIL_LEVEL * 2` = 64（原版 `MotionBlurVertex[64]`，`Draw():2399` 逐字）。
 * ⚠ 三角形 = `(mLevel2 - 2) / 2 * 2` = 每相邻两段一个四边形（两个三角形），共 31×2 = 62 个 —
 *    但原版是**逐段判重后**才 `AddObjectFace`（`:2466-2471`），所以本实现把"重复段"的三角形
 *    退化成零面积（三点共线）而不是重排索引 —— 效果相同（不可见），且顶点缓冲不必每帧重建。
 */
export function createWeaponTrail(deps: WeaponTrailDeps): WeaponTrail {
  const n = TRAIL_LEVEL;
  const verts = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const pos = new THREE.BufferAttribute(verts, 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  const uv = new THREE.BufferAttribute(uvs, 2);

  // UV：原版 `Start():2490` 的 `MotionBlurTexLink` —— 每段沿 V 占 1/32，段内两点 v 相同、u=0/1
  for (let c = 0; c < n; c++) {
    const v = c / n;
    uvs[(c * 2) * 2 + 0] = 0; uvs[(c * 2) * 2 + 1] = v;
    uvs[(c * 2 + 1) * 2 + 0] = 1; uvs[(c * 2 + 1) * 2 + 1] = v;
  }

  // 索引：相邻两段 (2c,2c+1) 与 (2c+2,2c+3) 组成一个四边形
  const idx: number[] = [];
  for (let c = 0; c + 1 < n; c++) {
    const a = c * 2, b = c * 2 + 1, d = c * 2 + 2, e = c * 2 + 3;
    idx.push(a, b, e, a, e, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', pos);
  geo.setAttribute('uv', uv);
  geo.setIndex(idx);

  // ⚠ **我方方案（与源码不同）**：源码用 `MeshBasic(贴图) + 整体 Alpha + 加法`，
  //   那张贴图承担"两端暗"的亮度剖面。这里改成**纯 shader**：
  //   · 横向（`vUv.x`）：`smoothstep` 两侧羽化 ⇒ 消除面片硬边
  //   · 沿长度（`vUv.y`）：起点淡入、末端淡出 ⇒ 取代贴图那条剖面
  //   · 整体（`uAlpha`）：仍是**源码那套**按 `LiveTime` 衰减的总透明度
  //   · 混合仍为**加法**（与源码 `SMMAT_BLEND_LAMP` 一致）
  //   形态（32 段 / 回溯帧数 / 两端点算法）全部照源码，见本文件开头的出处。
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uAlpha: { value: 0 },     // 总透明度（源码的 `Alpha`）
      uFadeIn: { value: 0.12 },  // 沿长度：起点淡入占的比例
      uFadeOut: { value: 0.55 }, // 沿长度：末端淡出占的比例
      uSoft: { value: 0.30 },    // 横向：两侧羽化宽度（占半宽的比例）
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uAlpha, uFadeIn, uFadeOut, uSoft;
      varying vec2 vUv;
      void main() {
        // 横向（u=0/1 是带子的两侧）⇒ 中间实、两侧柔
        float edge = smoothstep(0.0, uSoft, vUv.x) * (1.0 - smoothstep(1.0 - uSoft, 1.0, vUv.x));
        // 沿长度（v=0 尾 / v=1 头）⇒ 两端淡出（取代原版贴图的亮度剖面）
        float along = smoothstep(0.0, uFadeIn, vUv.y)
                    * (1.0 - smoothstep(1.0 - uFadeOut, 1.0, vUv.y));
        float a = uAlpha * edge * along;
        if (a <= 0.001) discard;
        gl_FragColor = vec4(uColor * a, a);   // 加法混合：颜色本身也按 a 衰减
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,   // 与源码同为加法
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;   // 顶点每帧变，包围球不更新

  let timeCount = 0;
  let alpha = 0;
  /** 骨名对不上只报一次（否则每帧刷屏）——**静默把顶点设 0** 正是 AGENTS #12 禁的那类降级 */
  let reportedMissing = false;

  return {
    object: mesh,
    get expired() { return deps.liveTime ? timeCount - (deps.delay ?? 0) > deps.liveTime : false; },
    restart(): void { timeCount = 0; alpha = 0; },
    setTint(t: TrailTint | null): void {
      const c = mat.uniforms.uColor.value;
      if (!t) { c.set(1, 1, 1); return; }
      c.set(t.r, t.g, t.b);
    },
    update(frame: number, startFrame: number): void {
      timeCount++;
      // 原版 `Main():2373-2392` 的两段：
      //   ① 延迟期（`StartDelay > 0`）⇒ `Draw():2405` 直接 return，**什么都不画**；
      //   ② 延迟结束那帧把 `TimeCount` **清零** ⇒ 寿命从这里才起算。
      const delay = deps.delay ?? 0;
      if (timeCount <= delay) {
        mesh.visible = false;
        return;
      }
      const lived = timeCount - delay;
      // ⚠ **淡出曲线是我方的**（用户 2026-09-20 定"不用纹理、纯 shader 实现我们自己的曳光"）：
      //   源码只把端点寿命写死（`LiveTime`），`Alpha` 在 `Start():2499` 置 0 之后**再没人写过**
      //   （全仓唯一写入点是 IronFist 的 `SetAlpha(-180)`，`:2725/2733`）——原版把带子的亮度剖面
      //   交给了那张贴图 `m_DoomG-01.bmp`，而**我们不用贴图**，所以这条曲线由 shader 承担。
      //   寿命数字仍照源码（`AssaMotionBlur(..., 80)` 等，见 `WEAPON_TRAILS` 的 note）。
      alpha = deps.liveTime ? Math.max(0, 1 - lived / deps.liveTime) : 1;

      for (let c = 0; c < n; c++) {
        // `Draw():2429-2431`：回溯帧 = 当前帧 − 段号×每段帧数，且**不早于起手帧**
        // （每段帧数：怪物 30 / 玩家 40，见 `WeaponTrailDeps.framesPerLevel`）
        let f = frame - c * (deps.framesPerLevel ?? TRAIL_FRAMES);
        if (f < startFrame) f = startFrame;
        const seg = deps.sample(f);
        const o = c * 6;
        if (!seg) {
          if (!reportedMissing) {
            reportedMissing = true;
            const msg = `武器曳光画不出来：「${deps.label}」端点在历史帧上取不到坐标`
              + '（原版 `GetObjectFromName` 精确匹配；怪物 D_PA 的骨名是 `Bip01 wea`）⇒ 顶点全零、带子不可见';
            deps.log?.(`  ⚠ ${msg}`);          // lab 日志面板（可见）
            reportFallback('fx', msg);          // 项目的降级总账
          }
          verts[o] = verts[o + 1] = verts[o + 2] = 0;
          verts[o + 3] = verts[o + 4] = verts[o + 5] = 0;
          continue;
        }
        verts[o] = seg.a.x; verts[o + 1] = seg.a.y; verts[o + 2] = seg.a.z;
        verts[o + 3] = seg.b.x; verts[o + 4] = seg.b.y; verts[o + 5] = seg.b.z;
      }
      pos.needsUpdate = true;
      // 探针：**每次挥击只打第一帧**（一次挥击一条，不刷屏）。
      // 两个数**必须一起看** —— 我上一轮只看 `去重` 就误判了：
      //   · `去重` = 32 段里有几个不同位置。源码 `Draw():2430` 把起手之前的帧钳到 `StartFrame`
      //     ⇒ 刚起手时靠后的段全落在起手帧上，`去重` 小是**源码行为**，不是"没画出来"；
      //     而**旧代码把 `startFrame` 传成了没 ×160 的值**（钳位恒不成立）⇒ 去重反而"很大"
      //     却全是本动作之外的姿势（假象）。
      //   · `跨度` = 带子的世界尺寸。**这才是"看不看得见"的判据** —— 32 个点也可能挤在 1 单位里。
      if (lived === 1) {
        let uniq = 0;
        const seen = new Set<string>();
        let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
        for (let c = 0; c < n * 2; c++) {
          const o = c * 3;
          const x = verts[o]!, y = verts[o + 1]!, z = verts[o + 2]!;
          if (x < mnx) mnx = x; if (x > mxx) mxx = x;
          if (y < mny) mny = y; if (y > mxy) mxy = y;
          if (z < mnz) mnz = z; if (z > mxz) mxz = z;
          if ((c & 1) === 0) {
            const k = `${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`;
            if (!seen.has(k)) { seen.add(k); uniq++; }
          }
        }
        const span = Math.hypot(mxx - mnx, mxy - mny, mxz - mnz);
        deps.log?.(`  [曳光·起手] alpha=${alpha.toFixed(2)} visible=${alpha > 0}`
          + ` 跨度=${span.toFixed(1)} 去重=${uniq}/${n} 中心=(${((mnx + mxx) / 2).toFixed(0)},`
          + `${((mny + mxy) / 2).toFixed(0)},${((mnz + mxz) / 2).toFixed(0)}) label=${deps.label}`);
      }
      mat.uniforms.uAlpha!.value = alpha;
      mesh.visible = alpha > 0;
    },
    dispose(): void { geo.dispose(); mat.dispose(); },
    hide(): void { mesh.visible = false; },
  };
}
