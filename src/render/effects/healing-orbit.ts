/**
 * Healing（祭司 T1·1）的**表现层**。
 *
 * ## ⚠ 先读：完整源码取证在 `docs/技能系统-healing-完整源码.md`（逐段原文 + file:line）
 *
 * 那份文档是用户 2026-09-27 明确要求的产物（"把 healing 的源码全部找出来，不要逐行猜测"）。
 *
 * ## 原版 `sinEffect_Healing2`（`sinSkillEffect.cpp:1632-1680`）到底建了什么
 *
 * 它建了**两份** `SIN_EFFECT_MESH`，但**只有第二份会被画出来**：
 *
 * | | 第一份（`:1641-1646`） | 第二份（`:1648-1668`，**唯一可见**） |
 * |---|---|---|
 * | 读法 | `smASE_ReadBone(ASE)` → `smASE_SetPhysique(它)` | `smASE_Read(ASE)`（**用上面那份当 physique** ⇒ 蒙皮到它的骨架上） |
 * | `BoneFlag` | **`= 1`** | 未设（= 0） |
 * | 高度 | `sinEffectDefaultSet(..., 13000)` | `sinEffectDefaultSet(..., 7000)` |
 * | `CODE`/`AniMax`/`Color_A`/… | **都不设** | `CODE = SKILL_HEALING`、`AniMax = 30`、`AniTime = 1`、`Color_A = 150`、`Max_Time = 250`、`RotateAngle = 256`、`RotateDistance.z = 256*16`、`MoveSpeed.y = 200`、`AlphaTime = Max_Time-20` |
 *
 * **`BoneFlag = 1` ⇒ 这一份永不被绘制**（不是"我们没实现"）：
 *   `sinDrawEffect2`（`sinEffect2.cpp:273` 取深度、`:346` 排序）两处的条件都是
 *   `if (Flag && Time > 0 && !BoneFlag)` —— 全树**再没有任何地方**读 `BoneFlag`
 *   （`grep -ar BoneFlag` 只有 7 处 `= 1` 赋值 + 这 2 处判断；`NewSourcePT-2023` 与 `ex-machina` 两棵树一致）。
 *   它的真实作用是**当 physique 用**（`smASE_SetPhysique` 设全局 `smPhysique`，紧接着的
 *   `smASE_Read` 用它把网格蒙皮到那 33 根骨上）—— 所以它必须存在，但不该出现在画面上。
 *
 * ⚠ **我此前把它当成"第二只看不见的天使"实现，是读错了**（2026-09-27 用户报"头顶上的天使不动"时才发现）。
 *   已删除：不再有"头顶固定不动的那只"。
 *
 * ## 可见那份的每帧行为（全部逐字）
 *
 * * **公转/上升/淡出** —— `sinSkillEffectMove` 的 `case SKILL_HEALING`（`:428-468`）：
 *   `RotateAngle += 25; RotateDistance.z += 16; Posi = (pChar + Rz·sin, pChar + 7000 + MoveSpeed.y, pChar + Rz·cos)`
 *   （`MoveSpeed.y += 20`/帧，初值 200）；`AlphaTime` 起末 20 帧每帧 −10/255。
 * * **自身 30 帧动画**（本文件 2026-09-27 补上，用户报"天使不动"）：绘制处
 *   `sinEffect2.cpp:323` 逐字 —— `sinPatMesh->Frame = AniCount * 160;`
 *   （160 = `SCENE_TICKSPERFRAME`，即"1 个 ASE 动画帧"的刻度）；`AniCount` 由 `sinActiveEffect2`
 *   每帧推进（`AniTime = 1` ⇒ 每帧；`AniCount++`，`>= AniMax(30)` 归 0）。
 *   实测本机 `hialtest.smb` **确有这份动画**：`Bip01 Head/L Hand/R Hand` 等骨的
 *   `tmRot` 关键帧在 `0,160,…,4800`（= 31 键 / 30 帧），手臂在帧 0→15→30 之间往复摆动。
 *   ⇒ 姿势用**共用的** `applyPose`（`char/anim-player.ts`，与角色动画同一实现，AGENTS #15）。
 * * **贴图**保持数据原样：`AniCount` 在源码里驱动的是**网格帧**（上面的 `Frame`），不是贴图 UV。
 * * **朝向 = 每帧跟着公转角转**（`Angle.y`）—— 绘制读的是 `RanderAngle`（`:324` 的
 *   `SetPosi(&Posi, &RanderAngle)`），而 `sinMoveEffect2` 的**第一行**就是
 *   `memcpy(&pEffect->RanderAngle, &pEffect->Angle, sizeof(POINT3D));`（`sinEffect2.cpp:444`），
 *   且 `sinActiveEffect2` 每帧对每个存活实例都调 `sinMoveEffect2` ⇒ **`RanderAngle` 每帧等于 `Angle`**，
 *   而 `case SKILL_HEALING` 每帧写 `Angle.y = -((RotateAngle) + ANGLE_270)`（`:435`）
 *   ⇒ 模型绕 Y 轴跟着公转一起转（正脸始终朝"前方"）。
 *   ⚠ **我一度得出"不转向"的错结论**：只搜了 `RanderAngle.y = …` 赋值点（那两处在
 *   `SIN_MOVE_LINE`/`SIN_MOVE_SONGPYEUN` 里、本实例确实不命中），漏看了 mover **入口处那句 memcpy**
 *   —— 用户 2026-09-27 实测指出"正脸方向从来没变过，看起来非常僵硬"才发现。
 * * **粒子**：`sinEffect_HealParticle3`（`:1585`，尾部 `memcpy` 复制 ⇒ **每帧 2 颗**）+
 *   `case SIN_EFFECT_HEALING3`（`:466-479`）：`H_MIND00.tga` 广告牌、尺寸 `rand(0..500)+200` raw、
 *   寿命 `rand(0..20)+50` 帧、颜色 `24/107/74` 起每帧 `+3/+1/+2`、等速漂移 `Rz=32`、
 *   `MoveSpeed.y = rand(0..20)+10`、`Gravity` 从 10 每帧 −5、末 22 帧每帧 −10/255 淡出。
 *
 * ## 寿命
 *
 * `Max_Time = 250`（`:1654`，@70fps ≈ 3.57s）⇒ `sinActiveEffect2` 里 `Time > Max_Time` 时
 * `memset` 整个槽位。第一份（未设 `Max_Time`）的寿命源码未定义 —— 既然它不可见，这里不再涉及。
 */
import * as THREE from 'three';
import { loadParsedAsset } from '../../core/asset-manager.js';
import { parseSmb } from '../../core/char-parser.js';
import { buildSkeleton, buildSkinnedMesh } from '../skinned-builder.js';
import { loadCharTextures, fetchAndDecodeTexture } from '../char-texture-loader.js';
import { applyPose } from '../../char/anim-player.js';
import { reportFallback } from '../../char/fallback-log.js';
import type { SmbData } from '../../char/char-format.js';

/** 骨架（33 根 Biped 骨骼；也是原版第一份实例充当的 physique） */
const SMB = '/res/image/sinimage/effect/skilleffect/healing/hialtest.smb';
/** 蒙皮网格（不蒙皮会塌成一团：见文件头） */
const SMD = '/res/image/sinimage/effect/skilleffect/healing/hialtest.smd';

/** `Max_Time = 250`（`sinSkillEffect.cpp:1654`）—— 生命周期（70 逻辑帧/秒 ⇒ ≈3.57s） */
const MAX_TIME = 250;
/** `Color_A = 150`（`:1659`）；`AlphaTime = Max_Time - 20`、`AlphaAmount = 10`（`:1665-1667`） */
const BASE_ALPHA = 150 / 255;
const FADE_AT = 230;
const FPS = 70;
/** `sinEffectDefaultSet(..., pChar, 0, 7000)`（`:1646`）——高度偏移（raw） */
const Y_OFFSET_RAW = 7000;
/** `RotateAngle = 256`（`:1661`）—— 初始公转角（PT 角度制，4096/圈） */
const ROTATE_ANGLE_0 = 256;
/** `RotateAngle += 25`（`sinSkillEffectMove` 的 `case SKILL_HEALING`，`sinSkillEffect.cpp:429`） */
const ROTATE_PER_FRAME = 25;
/** `RotateDistance.z = 256 * 16`（`:1662`）= 4096 raw（= 16 世界单位）—— 初始公转半径 */
const RADIUS_RAW_0 = 256 * 16;
/** `RotateDistance.z += 16`（`:430`） */
const RADIUS_GROW = 16;
/** `MoveSpeed.y = 200`（`:1664`）—— 初始上升速度（raw/帧） */
const MOVE_SPEED_Y_0 = 200;
/** `MoveSpeed.y += 20`（`:433`） */
const MOVE_SPEED_Y_GROW = 20;
/** `Angle.y = -((RotateAngle) + ANGLE_270)`（`:435`）里的 `ANGLE_270`（PT 角度制：4096 = 整圈） */
const ANGLE_270 = 4096 * 270 / 360;
/** PT 角度制：4096 = 整圈 */
const PT_ANGLE_FULL = 4096;
/** 原始单位 → 世界单位（PT 定点：256/单位） */
const FONE = 256;
/* ── 自身 30 帧动画（`AniCount` / `AniMax = 30` / `AniTime = 1`，`:1655-1657`） ── */
/** `AniCount = 1`（`:1655`）—— 初值 */
const ANI_COUNT_0 = 1;
/** `AniMax = 30`（`:1656`）—— 到 30 归 0 */
const ANI_MAX = 30;
/** 绘制处的刻度：`Frame = AniCount * 160`（`sinEffect2.cpp:323`）；160 = 1 个动画帧 */
const TICKS_PER_ANI_FRAME = 160;

/* ── 粒子：逐字来自 `sinEffect_HealParticle3`（`sinSkillEffect.cpp:1585-1630`）
      与 `case SIN_EFFECT_HEALING3`（`:466-479`） ── */
/** `MatHolyMind[0]` = `image\Sinimage\Effect\SkillEffect\HolyMind\H_MIND00.tga`（`sinSkillEffect.cpp:78`） */
const HEAL_PARTICLE_TEX = 'image/sinimage/effect/skilleffect/holymind/h_mind00.tga';
/** 发射条件 `if(Time < Max_Time - 30)`（`:459`） */
const EMIT_UNTIL = MAX_TIME - 30;
/** `TotalSize = rand() % 500 + 200`（`:1595`）、寿命 `rand() % 20 + 50`（`:1598`） */
const P_SIZE_MIN_RAW = 200, P_SIZE_RANGE_RAW = 500;
const P_LIFE_MIN = 50, P_LIFE_RANGE = 20;
/** `AlphaAmount = 10`、`AlphaTime = Max_Time - 22`（`:1601-1603`） */
const P_FADE_SPAN = 22, P_FADE_STEP = 10;
/** `RotateDistance.z = 32`（`:1606`）、初速度 `MoveSpeed.y = rand() % 20 + 10`（`:1613`）、`Gravity = 10`（`:1614`） */
const P_DRIFT_RADIUS_RAW = 32;
const P_VY_MIN = 10, P_VY_RANGE = 20;
/** 颜色初值 `r/g/b = 24/107/74`（`:1620-1622`），每帧 `r += 3; g++; b += 2`（`:474-476`） */
const P_RGB_0: readonly [number, number, number] = [24, 107, 74];
const P_RGB_STEP: readonly [number, number, number] = [3, 1, 2];
/** 每帧发射**两颗**（`sinEffect_HealParticle3` 尾部 `memcpy` 复制一份，`:1636-1638`） */
const P_PER_FRAME = 2;
/** `DesPosi` 抖动 `rand() % 1000 - 500`（`:452-454`）、`DesPosi.y -= 1000`（`:457`） */
const P_JITTER_RAW = 1000, P_DROP_RAW = 1000;

interface HealingOrbit {
  root: THREE.Group;
  mats: THREE.Material[];
  /** 骨架/骨架对象（`applyPose` 用；与角色动画同一实现） */
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  smb: SmbData;
  /** `AniCount` —— 原版每逻辑帧 +1，`>= AniMax(30)` 归 0（`sinActiveEffect2`） */
  aniCount: number;
  /** 被治疗者**脚底**位置（原版 `pChar->pX/pY/pZ`；缺实时 getter 时用它，效果停在原地） */
  at: { x: number; y: number; z: number };
  frame: number;
  nextLogFrame: number;
}
/** 一颗 `H_MIND00.tga` 广告牌粒子（`sinEffect_HealParticle3` + `case SIN_EFFECT_HEALING3`） */
interface HealParticle {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  frame: number;
  maxLife: number;
  pos: { x: number; y: number; z: number };
  driftX: number;
  driftZ: number;
  moveSpeedY: number;
  gravity: number;
  rgb: [number, number, number];
}
const live: HealingOrbit[] = [];
const particles: HealParticle[] = [];
/** 粒子所属场景（`runHealingOrbit` 注入） */
let particleScene: THREE.Scene | null = null;
/** 粒子贴图 `H_MIND00.tga`（`runHealingOrbit` 里加载） */
let particleTex: THREE.Texture | null = null;
let frameAcc = 0;
let logFn: ((msg: string) => void) | undefined;
let projectFn: ((p: { x: number; y: number; z: number }) => { x: number; y: number; onScreen: boolean } | null) | null = null;
/** 被治疗者实时位置（见 `deps.targetPos`） */
let targetPosFn: (() => { x: number; y: number; z: number }) | null = null;

/** 起一只小天使（`at` = 被治疗者**脚底**位置；原版 `pChar` = 目标 ?: 自己） */
export function runHealingOrbit(
  deps: { scene: THREE.Scene; log?: (msg: string) => void;
          project?: ((p: { x: number; y: number; z: number }) => { x: number; y: number; onScreen: boolean } | null) | null;
          /** 被治疗者实时位置（原版每帧 `pChar->pX/pY/pZ`；缺它=用起手快照，效果停在原地） */
          targetPos?: () => { x: number; y: number; z: number } },
  at: { x: number; y: number; z: number },
  fxScale = 1,
): void {
  logFn = deps.log;
  projectFn = deps.project ?? null;
  targetPosFn = deps.targetPos ?? null;
  particleScene = deps.scene;
  void (async () => {
    try {
      if (!particleTex) {
        // `H_MIND00.tga`：`sinSkillEffect.cpp:78`（`MatHolyMind[i] = ...\HolyMind\H_MIND0%d.tga`）
        particleTex = await fetchAndDecodeTexture('/res/' + HEAL_PARTICLE_TEX);
        if (!particleTex) reportFallback('skillfx', 'Healing 粒子贴图加载失败：' + HEAL_PARTICLE_TEX);
      }
      const smb = await loadParsedAsset(SMB, 'anim', parseSmb, true);
      const smd = await loadParsedAsset(SMD, 'model', parseSmb, true);
      const skel = buildSkeleton(smb, false);
      const built = buildSkinnedMesh(smd, smb, null, false, skel);
      await loadCharTextures(built.texturesToLoad);

      // 材质：逐实例克隆（末段 `Color_A` 淡出要独立控制透明度）。
      // ★ **必须是"单材质"或"材质数 == 几何 groups 数"**（2026-09-27 定案，这就是此前"网格不渲染"的根因）：
      //   three 的 `renderObject` 在 `Array.isArray(material)` 时**只按 `geometry.groups` 逐组绘制**
      //   （`for (i < groups.length) { material[group.materialIndex] }`）——
      //   几何**没有 groups** 时一个面都不画。此前这里一律写 `list.map(...)`（数组，哪怕只有 1 个），
      //   而本模型每个网格各自一份材质、几何不带 groups ⇒ **整具模型不渲染**；对照物 `BoxGeometry`
      //   自带 1 个 group，所以它一直能画（这条差异误导了我好几轮）。
      const mats: THREE.Material[] = [];
      for (const mesh of built.meshes) {
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const cloned = list.map((m) => {
          const c = (m as THREE.MeshPhongMaterial).clone();
          c.transparent = true;
          c.opacity = BASE_ALPHA;
          c.depthWrite = false;
          mats.push(c);
          return c;
        });
        mesh.material = (cloned.length === 1 || mesh.geometry.groups.length === 0
          ? cloned[0]! : cloned) as never;
        // 蒙皮网格的包围球在**绑定空间**，而位移由骨骼的世界矩阵（含本 root）给 —— 特效常被算错而整只消失
        mesh.frustumCulled = false;
        logFn?.(`  · 材质装配：几何 groups=${mesh.geometry.groups.length}，`
          + `源材质 ${list.length} 份 ⇒ 用${Array.isArray(mesh.material) ? '数组' : '单材质'}`);
      }

      const root = new THREE.Group();
      // 骨骼必须在场景图里（`root` 的位移/旋转要经父链进 `bone.matrixWorld`；蒙皮读的正是它）
      root.add(built.skeletonGroup);
      root.add(built.group);
      root.scale.multiplyScalar(fxScale);
      root.position.set(at.x, at.y + Y_OFFSET_RAW / FONE, at.z);
      deps.scene.add(root);

      // 运行期日志：创建 + 逐网格 + 动画来源（用户 2026-09-27 明确要求）
      const box0 = new THREE.Box3().setFromObject(root);
      const size0 = box0.getSize(new THREE.Vector3());
      const rotKeyed = smb.objects.filter((o) => o.tmRot.length > 0).length;
      const lastKey = Math.max(...smb.objects.map((o) => o.tmRot.at(-1)?.frame ?? 0));
      logFn?.(`  ✦ Healing 小天使：蒙皮网格 ${built.meshes.length} 个 / 骨骼 ${skel.bones.length}`
        + ` 尺寸 ${size0.x.toFixed(1)}×${size0.y.toFixed(1)}×${size0.z.toFixed(1)}`
        + ` 锚点 (${at.x.toFixed(1)},${(at.y + Y_OFFSET_RAW / FONE).toFixed(1)},${at.z.toFixed(1)})`
        + ` 运动=绕角色公转(25/帧, r 16+0.0625/帧)+上升(200+20/帧 raw)+自身 ${ANI_MAX} 帧动画`
        + `（${rotKeyed} 根骨带旋转关键帧，末键 ${lastKey} = ${lastKey / TICKS_PER_ANI_FRAME} 动画帧）`);
      live.push({
        root, mats, bones: built.bones, skeleton: built.skeleton, smb,
        aniCount: ANI_COUNT_0, at: { ...at }, frame: 0, nextLogFrame: 0,
      });
    } catch (e) {
      reportFallback('skillfx', 'Healing 小天使加载失败：' + String(e));
    }
  })();
}

/**
 * 每帧调一次（WorldView 帧循环）—— **逐字实现** `sinActiveEffect2` 的这条链：
 *   `sinSkillEffectMove` 的 `case SKILL_HEALING`（公转/上升/发射）+ `AniCount` 推进
 *   + `AlphaTime` 淡出 + `Max_Time` 清零。
 */
export function updateHealingOrbits(dt: number): void {
  if (live.length === 0 && particles.length === 0) return;
  frameAcc += dt * FPS;
  const n = Math.floor(frameAcc);
  if (n <= 0) return;
  frameAcc -= n;

  for (let i = live.length - 1; i >= 0; i--) {
    const o = live[i]!;
    o.frame += n;
    const t = o.frame;
    if (t >= MAX_TIME) {
      o.root.removeFromParent();
      for (const m of o.mats) m.dispose();
      logFn?.(`  · Healing 小天使 f=${t} 寿命到（Max_Time=250）⇒ 清空`);
      live.splice(i, 1);
      continue;
    }
    // 基准点 = **被治疗者当前位置**（原版每帧读 `pChar->pX/pY/pZ`；缺 getter 才用起手快照）
    const base = targetPosFn ? targetPosFn() : o.at;
    // ── `case SKILL_HEALING`（`sinSkillEffect.cpp:428-468`）逐字 ──
    // RotateAngle += 25/帧；RotateDistance.z += 16/帧（raw，初值 4096 = 16 世界单位）
    const theta = (ROTATE_ANGLE_0 + ROTATE_PER_FRAME * t) / PT_ANGLE_FULL * Math.PI * 2;
    const radiusRaw = RADIUS_RAW_0 + RADIUS_GROW * t;
    // RotatePosi = (Rz·sin, Rz·cos) >> 16（`RotateDistance.y` 未设 = 0）⇒ 世界单位 = raw/FONE
    const offX = (radiusRaw * Math.sin(theta)) / FONE;
    const offZ = (radiusRaw * Math.cos(theta)) / FONE;
    // MoveSpeed.y += 20/帧（初值 200）；Posi.y = pChar->pY + 7000 + MoveSpeed.y
    const moveSpeedY = MOVE_SPEED_Y_0 + MOVE_SPEED_Y_GROW * t;
    o.root.position.set(base.x + offX, base.y + (Y_OFFSET_RAW + moveSpeedY) / FONE, base.z + offZ);
    // ── 朝向：`Angle.y = -((RotateAngle) + ANGLE_270)`（`:435`）──
    //   绘制读的是 `RanderAngle`，而 `sinMoveEffect2` 的**第一行**就是
    //   `memcpy(&pEffect->RanderAngle, &pEffect->Angle, sizeof(POINT3D))`（`sinEffect2.cpp:444`），
    //   且 `sinActiveEffect2` 每帧都调它 ⇒ **`RanderAngle` 每帧 = `Angle`** ⇒ 模型跟着公转转。
    //   ⚠ 我此前只搜 `RanderAngle.y = …`（那两处在别的 mover 分支里）就断言"本实例不转向"，
    //     漏了 mover 入口的 memcpy —— 用户实测"正脸方向从来没变过，看起来很僵硬"才发现。
    o.root.rotation.y = -((ROTATE_ANGLE_0 + ROTATE_PER_FRAME * t + ANGLE_270) / PT_ANGLE_FULL * Math.PI * 2);
    // ── 自身 30 帧动画：`sinPatMesh->Frame = AniCount * 160`（`sinEffect2.cpp:323`）──
    for (let k = 0; k < n; k++) {
      o.aniCount++;
      if (o.aniCount >= ANI_MAX) o.aniCount = 0;   // `AniCount++` / `>= AniMax ⇒ 0`（`sinActiveEffect2`）
    }
    o.root.updateMatrixWorld(true);   // 骨骼 world 要含本帧的位移/朝向，先推一次（否则晚一帧）
    if (o.bones.length > 0) applyPose(o.smb, o.aniCount * TICKS_PER_ANI_FRAME, o.bones, o.skeleton);
    // Color_A 末 20 帧每帧 −10/255（AlphaTime = Max_Time − 20、AlphaAmount = 10、AlphaCount = 1）
    const alpha = t >= FADE_AT ? Math.max(0, (150 - (t - FADE_AT) * 10) / 255) : BASE_ALPHA;
    for (const m of o.mats) m.opacity = alpha;

    // ── 每帧发射粒子：`if(Time < Max_Time - 30) sinEffect_HealParticle3(&DesPosi, MatHolyMind[0], 1, 500, 50, 10)`
    //    （`sinSkillEffect.cpp:459-460`；该函数末尾 `memcpy` 再复制一份 ⇒ 每帧 2 颗，`:1636-1638`）
    if (t < EMIT_UNTIL) {
      // DesPosi = Posi + rand(±500) + 小半径(32)偏移；再 DesPosi.y -= 1000（`:452-457`）
      const smallTheta = theta;   // 同一帧的 RotateAngle
      const jx = (Math.random() * P_JITTER_RAW - P_JITTER_RAW / 2) / FONE;
      const jy = (Math.random() * P_JITTER_RAW - P_JITTER_RAW / 2) / FONE;
      const jz = (Math.random() * P_JITTER_RAW - P_JITTER_RAW / 2) / FONE;
      const sx = (P_DRIFT_RADIUS_RAW * Math.sin(smallTheta)) / FONE;
      const sz = (P_DRIFT_RADIUS_RAW * Math.cos(smallTheta)) / FONE;
      const des = {
        x: o.root.position.x + jx + sx,
        y: o.root.position.y + jy + sz - P_DROP_RAW / FONE,   // ⚠ 源码把 z 分量加到 y（照抄）
        z: o.root.position.z + jz,
      };
      for (let k = 0; k < P_PER_FRAME; k++) spawnHealParticle(des);
    }

    if (t >= o.nextLogFrame) {
      o.nextLogFrame += 35;
      const scr = projectFn ? projectFn({ x: o.root.position.x, y: o.root.position.y, z: o.root.position.z }) : null;
      logFn?.(`  · Healing 小天使 f=${t} AniCount=${o.aniCount}/${ANI_MAX}`
        + ` pos=(${o.root.position.x.toFixed(1)},${o.root.position.y.toFixed(1)},${o.root.position.z.toFixed(1)})`
        + ` 半径=${(radiusRaw / FONE).toFixed(1)} 上升速度=${(moveSpeedY / FONE).toFixed(1)}/帧`
        + ` 透明度=${alpha.toFixed(2)} 粒子=${particles.length}`
        + ` 屏幕=${scr ? `(${scr.x.toFixed(0)},${scr.y.toFixed(0)})${scr.onScreen ? '在画面内' : '★画面外'}` : '(无 project)'}`);
    }
  }

  // ── 粒子逐帧推进（`case SIN_EFFECT_HEALING3`，`sinSkillEffect.cpp:466-479` 逐字）──
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.frame += n;
    if (p.frame >= p.maxLife) {
      p.sprite.parent?.remove(p.sprite);
      p.mat.dispose();
      particles.splice(i, 1);
      continue;
    }
    // sinFace += (Rz·sinφ, Rz·cosφ) >> 16 —— φ 固定 ⇒ 等速直线漂移
    p.pos.x += p.driftX;
    p.pos.z += p.driftZ;
    // `Gravity -= 5`；`sinFace.y += MoveSpeed.y + Gravity`（源码逐字）
    p.gravity -= 5;
    p.pos.y += (p.moveSpeedY + p.gravity) / FONE;
    // 颜色每帧变亮：r += 3; g++; b += 2（钳到 255）
    p.rgb[0] = Math.min(255, p.rgb[0] + P_RGB_STEP[0]);
    p.rgb[1] = Math.min(255, p.rgb[1] + P_RGB_STEP[1]);
    p.rgb[2] = Math.min(255, p.rgb[2] + P_RGB_STEP[2]);
    p.sprite.position.set(p.pos.x, p.pos.y, p.pos.z);
    // AlphaTime = Max_Time - 22、每帧 −10/255（255 起）
    const a = p.frame >= p.maxLife - P_FADE_SPAN
      ? Math.max(0, (255 - (p.frame - (p.maxLife - P_FADE_SPAN)) * P_FADE_STEP) / 255)
      : 1;
    p.mat.opacity = a;
    p.mat.color.setRGB(p.rgb[0] / 255, p.rgb[1] / 255, p.rgb[2] / 255);
  }
}

/** 一颗 `H_MIND00.tga` 广告牌粒子（参数逐字来自 `sinEffect_HealParticle3`，见常量注释） */
function spawnHealParticle(at: { x: number; y: number; z: number }): void {
  const sizeRaw = Math.random() * P_SIZE_RANGE_RAW + P_SIZE_MIN_RAW;
  const life = Math.floor(Math.random() * P_LIFE_RANGE) + P_LIFE_MIN;
  const phi = (Math.random() * PT_ANGLE_FULL + P_PER_FRAME) / PT_ANGLE_FULL * Math.PI * 2;
  const size = sizeRaw / FONE;
  const mat = new THREE.SpriteMaterial({
    map: particleTex!,
    blending: THREE.AdditiveBlending,   // `SMMAT_BLEND_LAMP`（`CreateTextureMaterial(..., SMMAT_BLEND_LAMP)`）
    depthWrite: false,
    transparent: true,
    color: new THREE.Color(P_RGB_0[0] / 255, P_RGB_0[1] / 255, P_RGB_0[2] / 255),
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  sprite.position.set(at.x, at.y, at.z);
  sprite.frustumCulled = false;
  particleScene?.add(sprite);
  particles.push({
    sprite, mat, frame: 0, maxLife: life, pos: { ...at },
    driftX: (P_DRIFT_RADIUS_RAW * Math.sin(phi)) / FONE,
    driftZ: (P_DRIFT_RADIUS_RAW * Math.cos(phi)) / FONE,
    moveSpeedY: Math.random() * P_VY_RANGE + P_VY_MIN,
    gravity: 10,
    rgb: [P_RGB_0[0], P_RGB_0[1], P_RGB_0[2]],
  });
}
