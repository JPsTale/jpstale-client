/**
 * Healing（祭司 T1·1）的**表现层**。
 *
 * ## ⚠ 先读：完整源码取证在 `docs/技能系统-healing-完整源码.md`（逐段原文 + file:line）
 *
 * 那份文档是用户 2026-09-27 明确要求的产物（"把 healing 的源码全部找出来，不要逐行猜测"）。
 * 本文件只实现其中的**一条**路径，选择依据写在下面。
 *
 * ## 原版有**两套**实现（都在 `sinSkillEffect.cpp`，互不相同）
 *
 * | | MESH 版 `sinEffect_Healing2`（`:1632`） | FACE 版 `sinEffect_Healing`（`:1302`） |
 * |---|---|---|
 * | 载体 | `HIALTEST` 网格（`.smb` 33 骨骼 + `.smd` 网格 / `HIAL.bmp` 8 帧图集） | `SIN_EFFECT_FACE` 广告牌（`Agony\Agony0.tga`，Size 2000） |
 * | 调用点 | `character.cpp:11529/11536`（**EventSkill**，玩家施法的事件帧） | **现有树里没有调用点**（只有定义） |
 * | 每帧驱动 | 四个 mover（`sinMoveEffect2` / `sinCheckCharState` / `sinSkillEffectMove` / `sinPublicEffectMove`）**都不命中**（实例的 `MoveKind`/`CODE` 均未赋值）⇒ **不位移**；只有 `AniCount` 每帧 +1（30 帧循环）推 `Frame`、末 20 帧淡出、250 帧清零 | 命中 **`sinSkillEffectMove` 的 `case SKILL_HEALING`**（`sinSkillEffect.cpp:428-468`）⇒ **绕角色公转 + 上升 + 每帧发射粒子** |
 *
 * ## 本文件的实现与依据（**逐字**，2026-09-27 二次核对源码后修正）
 *
 * * **载体**：`sinEffect_Healing2`（`sinSkillEffect.cpp:1632`，**`character.cpp:11529/11536` 的 EventSkill 调的就是它**）
 *   的第二份实例 —— `HIALTEST` 网格（`.smb` 33 骨骼 + `.smd` 网格；绑定姿态 = 展开光翼的人形，
 *   实测包围盒 17.6×11.1×9.1 单位）。
 *   ⚠ 第一份实例（`smASE_ReadBone` + `BoneFlag = 1` + `Y = 13000`，贴骨渲染）**未移植** ⇒ 显式上报。
 * * **该实例的初值**（`:1646-1667` 逐字）：
 *   `Y = 7000`（`sinEffectDefaultSet` 的高度偏移）、`Max_Time = 250`、`AniCount = 1`、
 *   `AniMax = 30`、`AniTime = 1`、`Color_A = 150`、**`CODE = SKILL_HEALING`**、
 *   `RotateAngle = 256`、`RotateDistance.z = 256*16`（=4096 raw = 16 单位）、
 *   `Angle.y = -(pChar->Angle.y)+180`、`MoveSpeed.y = 200`、`AlphaTime = Max_Time-20`、`AlphaAmount = 10`。
 * * **每帧**（`sinSkillEffectMove` 的 `case SKILL_HEALING`，`sinSkillEffect.cpp:428-468`）——**因为有 `CODE`，这条对本实例生效**：
 *   ```
 *   RotateAngle += 25; RotateDistance.z += 16;
 *   RotatePosi = (Rz·sin, Rz·cos) >> 16;    // RotateDistance.y 未设 = 0
 *   Posi.x = pChar->pX + RotatePosi.x;      // ★ 绕角色公转
 *   Posi.z = pChar->pZ + RotatePosi.z;
 *   MoveSpeed.y += 20;
 *   Posi.y = pChar->pY + 7000 + MoveSpeed.y;
 *   Angle.y = -((RotateAngle) + ANGLE_270);
 *   if (Time < Max_Time - 30) sinEffect_HealParticle3(&DesPosi, MatHolyMind[0], 1, 500, 50, 10);   // 每帧 2 颗
 *   ```
 * * **粒子**：`sinEffect_HealParticle3`（`:1585`，末尾 `memcpy` 复制 ⇒ **每帧 2 颗**）+ `case SIN_EFFECT_HEALING3`（`:466-479`）：
 *   `H_MIND00.tga` 广告牌、尺寸 `rand(0..500)+200` raw、寿命 `rand(0..20)+50` 帧、颜色 `24/107/74` 起每帧 `+3/+1/+2`、
 *   等速漂移 `Rz=32`（raw/帧）、`MoveSpeed.y = rand(0..20)+10`、`Gravity` 从 10 每帧 −5、末 22 帧每帧 −10/255 淡出。
 * * **不加工的东西**：贴图 UV 保持数据原样（源码里 `AniCount` 驱动的是**网格帧** `Frame = AniCount*160`，
 *   不是贴图 UV；本机 `.smd` 缺帧数据 `tmFrameCnt = 0` ⇒ 无网格帧可播，如实登记，不做自造补偿）。
 *
 * ## ⚠ 已知阻塞（未解决，如实登记）
 *
 * 真机二分：**同位置的 `BoxGeometry` 能渲染，`HIALTEST` 的几何（原样 / 烘焙 / 从零重建）都不渲染**，
 * 而几何体检正常（`pos=1092 uv=1092 index=1092 索引最大=1091 NaN=0`、包围盒有限）⇒ 实机上仍看不到天使。
 * 下一个候选：改走 **FACE 版**（两张 `Agony0.tga` 广告牌 + 每帧 `H_MIND00.tga` 粒子，参数逐字见
 * 文档 §21-24）—— 不依赖骨骼/网格，可绕开本阻塞；所需资产已核对**全部在库**。**待用户裁定**。
 */
import * as THREE from 'three';
import { loadParsedAsset } from '../../core/asset-manager.js';
import { parseSmb } from '../../core/char-parser.js';
import { buildSkeleton, buildSkinnedMesh } from '../skinned-builder.js';
import { loadCharTextures, fetchAndDecodeTexture } from '../char-texture-loader.js';
import { reportFallback } from '../../char/fallback-log.js';

/** 骨架（33 根 Biped 骨骼） */
const SMB = '/res/image/sinimage/effect/skilleffect/healing/hialtest.smb';
/** 蒙皮网格（未经蒙皮/烘焙会塌成一团） */
const SMD = '/res/image/sinimage/effect/skilleffect/healing/hialtest.smd';

/** `Max_Time = 250`（`sinSkillEffect.cpp:1654`）—— 生命周期（70 逻辑帧/秒 ⇒ ≈3.57s） */
const MAX_TIME = 250;
/** `Color_A = 150`（`:1659`）；`AlphaTime = Max_Time - 20`、`AlphaAmount = 10`、`AlphaCount = 1`（`:1665-1667`） */
const BASE_ALPHA = 150 / 255;
const FADE_AT = 230;
const FPS = 70;
/** 第一份实例的高度偏移：`sinEffectDefaultSet(..., 13000)`（`sinSkillEffect.cpp:1643`，贴骨那份） */
const UPPER_LIFT_RAW = 13000;
/** `sinEffectDefaultSet(..., pChar, 0, 7000)`（`:1646`）——实例②的高度偏移（raw） */
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
/** `Angle.y = -((RotateAngle) + ANGLE_270)`（`:435`）里的 ANGLE_270（PT 角度制） */
const ANGLE_270 = 4096 * 270 / 360;
/** PT 角度制：4096 = 整圈 */
const PT_ANGLE_FULL = 4096;
/** 原始单位 → 世界单位（PT 定点：256/单位） */
const FONE = 256;

/* ── 粒子：逐字来自 `sinEffect_HealParticle3`（`sinSkillEffect.cpp:1585-1640`）
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
  root: THREE.Object3D;
  mats: THREE.Material[];
  /**
   * **第一份实例**（`sinEffect_Healing2` 的第一段：`smASE_ReadBone` + `sinEffectDefaultSet(..., 13000)`
   * + `BoneFlag = 1`）：同一个网格、高度 = `pChar->pY + 13000`（≈50.8，**头顶**）、**贴骨**
   * （`BoneFlag=1` ⇒ 由骨骼挂载路径绘制，`sinDrawEffect2` 会跳过它）、**没有 `CODE`** ⇒ 不吃任何 mover
   * （不公转、不上升）、也没有 `Color_A`/`Alpha*` ⇒ 不淡出。
   * ⚠ **寿命**：源码**没有**给它 `Max_Time`（`sinEffectDefaultSet` 不设、该段也不设）⇒ 按
   * `sinActiveEffect2` 的 `if (Max_Time != SIN_EFFECT_NO_TIME && Time > Max_Time) memset`，
   * 残留值为 0 时**第 2 帧就被清空**；只有残留恰为 `SIN_EFFECT_NO_TIME(0xFFFF0000)` 才永不过期。
   * **这是源码自身的未定义行为**（见 `docs/技能系统-healing-完整源码.md` §D）—— 我们取
   * **与第二份同寿命（250 帧）**，这是**我方选择**，写在这里以便复核。
   */
  upper: THREE.Object3D | null;
  /** 施法者位置（起手快照；原版每帧读 `pChar->pX/pY/pZ`，我们暂不跟随移动） */
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

/** 起一份小天使（`at` = 被治疗者**脚底**位置；原版 `pChar` = 目标 ?: 自己） */
export function runHealingOrbit(
  deps: { scene: THREE.Scene; log?: (msg: string) => void;
          project?: ((p: { x: number; y: number; z: number }) => { x: number; y: number; onScreen: boolean } | null) | null },
  at: { x: number; y: number; z: number },
  fxScale = 1,
  casterYaw: number | null = null,
): void {
  logFn = deps.log;
  projectFn = deps.project ?? null;
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

      // 把蒙皮姿态烘焙进顶点（`applyBoneTransform` 需要骨骼 `matrixWorld` 已算好）
      const holder = new THREE.Group();
      holder.add(built.group);
      holder.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      for (const sm of built.meshes) {
        const srcPos = sm.geometry.getAttribute('position');
        const srcUv = sm.geometry.getAttribute('uv');
        const n = srcPos.count;
        const posArr = new Float32Array(n * 3);
        const uvArr = srcUv ? new Float32Array(n * 2) : null;
        const v = new THREE.Vector3();
        const fn = (sm as unknown as { applyBoneTransform?: (i: number, v: THREE.Vector3) => THREE.Vector3 })
          .applyBoneTransform;
        if (!fn) {
          reportFallback('skillfx', 'Healing 小天使：该网格不是 SkinnedMesh（无 applyBoneTransform）⇒ 直接按顶点渲染');
        }
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(srcPos, i);
          if (fn) fn.call(sm, i, v);
          posArr[i * 3] = v.x; posArr[i * 3 + 1] = v.y; posArr[i * 3 + 2] = v.z;
          if (uvArr && srcUv) { uvArr[i * 2] = srcUv.getX(i); uvArr[i * 2 + 1] = srcUv.getY(i); }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        if (uvArr) geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
        const srcIdx = sm.geometry.getIndex();
        if (srcIdx) geo.setIndex(new THREE.BufferAttribute(srcIdx.array.slice(), 1));
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, sm.material);
        m.frustumCulled = false;   // 顶点是烘焙出来的，静态包围球不可靠（同 `weapon-trail` 的做法）
        meshes.push(m);
      }

      // **材质按数据原样**（不加工）：源码里 `AniCount` 驱动的是**网格帧**（`Frame = AniCount*160`，
      // `sinDrawEffect2:322`），**不是贴图 UV** —— 本机 `.smd` 缺帧数据（`tmFrameCnt = 0`）⇒ 无帧可播；
      // ⚠ 该网格的 UV 覆盖**整张** `HIAL.bmp`（64×512 = 8 帧 64×64 的序列图集，实测），
      //   这是**转换产物**的属性（原版 ASE 的帧内 UV 无从查证）—— 如实登记，不做自造补偿。
      // 只按需克隆材质（逐实例独立控制透明度）；贴图对象共享（不改 offset/repeat 就不必克隆贴图）。
      const mats: THREE.Material[] = [];
      for (const mesh of meshes) {
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const cloned = list.map((m) => {
          const c = (m as THREE.MeshPhongMaterial).clone();
          c.transparent = true;
          c.opacity = BASE_ALPHA;
          c.depthWrite = false;
          mats.push(c);
          return c;
        });
        // ★ **必须是"单材质"或"材质数 == 几何 groups 数"**（2026-09-27 定案，这就是"网格不渲染"的根因）：
        //   three 的 `renderObject` 在 `Array.isArray(material)` 时**只按 `geometry.groups` 逐组绘制**
        //   （`renderObject`: `for (i < groups.length) { material[group.materialIndex] }`）——
        //   几何**没有 groups** 时一个面都不画。此前这里一律写 `list.map(...)`（数组，哪怕只有 1 个），
        //   而我们的几何没有 groups ⇒ **整具模型不渲染**；对照物 `BoxGeometry` 自带 1 个 group，
        //   所以它一直能画（这条差异误导了我好几轮）。
        //   现在：只有 1 份材质（或几何无 groups）就用**单材质**；多材质且几何有 groups 才用数组。
        mesh.material = (cloned.length === 1 || mesh.geometry.groups.length === 0
          ? cloned[0]! : cloned) as never;
        logFn?.(`  · 材质装配：几何 groups=${mesh.geometry.groups.length}，`
          + `源材质 ${list.length} 份 ⇒ 用${Array.isArray(mesh.material) ? '数组' : '单材质'}`);
      }

      const root = new THREE.Group();
      for (const m of meshes) root.add(m);
      // **第一份实例**（贴骨、Y=13000）：同网格再放一份在头顶；不公转/不上升/不淡出（源码该段只设
      // `BoneFlag=1`，没有 CODE/Color_A/Alpha*）。⚠ 它的寿命源码未定义（见 live 结构的说明）——
      // 我们按与第二份同寿命保留，属我方选择。
      const upper = new THREE.Group();
      for (const m of meshes) {
        const um = new THREE.Mesh(m.geometry, m.material);   // 同几何/同材质（该份无独立透明度）
        um.frustumCulled = false;
        upper.add(um);
      }
      upper.position.set(at.x, at.y + UPPER_LIFT_RAW / FONE, at.z);
      if (fxScale !== 1) root.scale.multiplyScalar(fxScale);
      root.position.set(at.x, at.y + Y_OFFSET_RAW / FONE, at.z);
      if (casterYaw != null) { root.rotation.y = casterYaw + Math.PI; upper.rotation.y = casterYaw + Math.PI; }
      deps.scene.add(root);
      deps.scene.add(upper);

      // 运行期日志：创建 + 逐网格（用户 2026-09-27 明确要求）
      root.updateMatrixWorld(true);
      const box0 = new THREE.Box3().setFromObject(root);
      const size0 = box0.getSize(new THREE.Vector3());
      const center0 = box0.getCenter(new THREE.Vector3());
      logFn?.(`  ✦ Healing 小天使：烘焙网格 ${meshes.length} 个 / 源骨骼 ${skel.bones.length}`
        + ` 尺寸 ${size0.x.toFixed(1)}×${size0.y.toFixed(1)}×${size0.z.toFixed(1)}`
        + ` 世界中心 (${center0.x.toFixed(1)},${center0.y.toFixed(1)},${center0.z.toFixed(1)})`
        + ` 锚点 (${at.x.toFixed(1)},${(at.y + Y_OFFSET_RAW / FONE).toFixed(1)},${at.z.toFixed(1)})`
        + ` 运动=绕角色公转(25/帧, r 24+0.0625/帧)+上升(速度+0.078/帧)`);
      for (const [mi, mesh] of meshes.entries()) {
        const g = mesh.geometry;
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        const sz = bb.getSize(new THREE.Vector3());
        logFn?.(`  · 网格[${mi}] 顶点 ${g.getAttribute('position')?.count ?? 0}`
          + ` 烘焙后包围盒 ${sz.x.toFixed(1)}×${sz.y.toFixed(1)}×${sz.z.toFixed(1)}`
          + ` 贴图 ${(() => {
            const mm = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshPhongMaterial;
            const img = mm?.map?.image as { width?: number; height?: number } | undefined;
            return mm?.map ? `${img?.width ?? '?'}x${img?.height ?? '?'}` : '无';
          })()}`);
      }
      logFn?.(`  · 第一份实例（贴骨·头顶）：Y=${(UPPER_LIFT_RAW / FONE).toFixed(1)}（13000/256）`
        + ` 不公转/不上升/不淡出；⚠ 源码未定义其寿命（槽位残留），我们取与第二份同寿命（250 帧）—— 我方选择`);
      live.push({ root, mats, at: { ...at }, frame: 0, nextLogFrame: 0, upper });
    } catch (e) {
      reportFallback('skillfx', 'Healing 小天使加载失败：' + String(e));
    }
  })();
}

/**
 * 每帧调一次（WorldView 帧循环）—— **逐字实现** `sinActiveEffect2` 的这条链：
 *   `sinSkillEffectMove` 的 `case SKILL_HEALING`（公转/上升/发射）+ `AlphaTime` 淡出 + `Max_Time` 清零。
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
      o.upper?.removeFromParent();
      for (const m of o.mats) m.dispose();
      logFn?.(`  · Healing 小天使 f=${t} 寿命到（Max_Time=250）⇒ 清空`);
      live.splice(i, 1);
      continue;
    }
    // ── `case SKILL_HEALING`（`sinSkillEffect.cpp:428-468`）逐字 ──
    // RotateAngle += 25/帧；RotateDistance.z += 16/帧（raw，初值 4096 = 16 世界单位）
    const theta = (ROTATE_ANGLE_0 + ROTATE_PER_FRAME * t) / PT_ANGLE_FULL * Math.PI * 2;
    const radiusRaw = RADIUS_RAW_0 + RADIUS_GROW * t;
    // RotatePosi = (Rz·sin, Rz·cos) >> 16（`RotateDistance.y` 未设 = 0）⇒ 世界单位 = raw/FONE
    const offX = (radiusRaw * Math.sin(theta)) / FONE;
    const offZ = (radiusRaw * Math.cos(theta)) / FONE;
    // MoveSpeed.y += 20/帧（初值 200）；Posi.y = pChar->pY + 7000 + MoveSpeed.y
    const moveSpeedY = MOVE_SPEED_Y_0 + MOVE_SPEED_Y_GROW * t;
    o.root.position.set(o.at.x + offX, o.at.y + (Y_OFFSET_RAW + moveSpeedY) / FONE, o.at.z + offZ);
    // Angle.y = -((RotateAngle) + ANGLE_270)
    o.root.rotation.y = -((ROTATE_ANGLE_0 + ROTATE_PER_FRAME * t + ANGLE_270) / PT_ANGLE_FULL * Math.PI * 2);
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
      logFn?.(`  · Healing 小天使 f=${t} pos=(${o.root.position.x.toFixed(1)},${o.root.position.y.toFixed(1)},`
        + `${o.root.position.z.toFixed(1)}) 半径=${(radiusRaw / FONE).toFixed(1)}`
        + ` 上升速度=${(moveSpeedY / FONE).toFixed(1)}/帧 透明度=${alpha.toFixed(2)} 粒子=${particles.length}`
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
