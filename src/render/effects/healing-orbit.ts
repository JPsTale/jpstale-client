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
 * ## 本文件的实现与依据
 *
 * * **载体**：MESH 版的 `HIALTEST` 网格（"小天使"的几何 = 33 根 Biped 骨骼的蒙皮模型，
 *   绑定姿态为展开光翼的人形，实测包围盒 17.6×11.1×9.1 单位）。
 * * **运动**：FACE 版 `case SKILL_HEALING` 的**逐字参数**（`sinSkillEffect.cpp:428-468`）：
 *   ```
 *   RotateAngle += 25;                       // 4096/圈 ⇒ 163.84 帧/圈（@70fps ≈ 2.34s 一圈）
 *   RotateDistance.z += 16;                  // 半径每帧 +16 raw（初值 128*24*2 = 6144 = 24 单位）
 *   RotatePosi.x = RotateDistance.y*cos + RotateDistance.z*sin;   // RotateDistance.y 未设 = 0
 *   RotatePosi.z = -RotateDistance.y*sin + RotateDistance.z*cos;
 *   >>= 16;
 *   Posi.x = pChar->pX + RotatePosi.x;        // ★ 绕角色公转
 *   Posi.z = pChar->pZ + RotatePosi.z;
 *   MoveSpeed.y += 20;                        // 上升速度每帧累加（raw）
 *   Posi.y = pChar->pY + 7000 + MoveSpeed.y;  // 高度 = 角色 + 7000/256 + 累积
 *   Angle.y = -((RotateAngle) + ANGLE_270);   // 朝向随公转
 *   ```
 *   （raw ÷ 256 = 世界单位 ⇒ 半径 24 起、每帧 +0.0625；高度 27.34 起、每帧 +0.078 的累加量）
 *   ⚠ 依据：MESH 版按源码**本应静止**（无 mover 命中），但用户 2026-09-27 实测原版
 *   "**绕角色的头旋转飞行**" ⇒ 采用 FACE 版的运动参数（源码里唯一一处写出这种运动的实现）。
 * * **渲染**：`buildSkeleton + buildSkinnedMesh` 后把姿态**烘焙进顶点**（`applyBoneTransform`；
 *   本机 `.smd` 无帧数据 `tmFrameCnt = 0`，绑定姿态即目标形态），用**普通 `THREE.Mesh`** 渲染 ——
 *   因为 `SkinnedMesh` 在本项目渲染管线里**不被提交渲染**（真机探针实测）。
 * * **贴图**：`HIAL.bmp` = **64×512 = 8 帧 64×64** 序列图集（实测逐帧为 8 张清晰天使，白→蓝）；
 *   本机 `.smd` 的 UV 覆盖整张图集 ⇒ 用 `map.offset/repeat` 切帧、随寿命推进（原版 `TexRect` 逐帧）。
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
import { loadCharTextures } from '../char-texture-loader.js';
import { reportFallback } from '../../char/fallback-log.js';

/** 骨架（33 根 Biped 骨骼） */
const SMB = '/res/image/sinimage/effect/skilleffect/healing/hialtest.smb';
/** 蒙皮网格（未经蒙皮/烘焙会塌成一团） */
const SMD = '/res/image/sinimage/effect/skilleffect/healing/hialtest.smd';

/** `Max_Time = 250`（`sinSkillEffect.cpp:1654`；70 逻辑帧/秒 ⇒ ≈3.57s） */
const MAX_TIME = 250;
/** `Color_A = 150`（`:1659`） */
const BASE_ALPHA = 150 / 255;
/** `AlphaTime = Max_Time - 20`（`:1665`）—— 末 20 帧每帧 −10/255（`AlphaAmount`） */
const FADE_AT = 230;
const FPS = 70;
/** `HIAL.bmp` 图集：实测 64×512 = 8 帧 64×64 */
const ATLAS_FRAMES = 8;
/** 每推进一格图集帧的逻辑帧数（原版帧序列定义在转换产物里缺失，按"铺满寿命"实现） */
const ATLAS_FRAME_SPAN = Math.max(1, Math.floor(MAX_TIME / ATLAS_FRAMES));

/* ── 运动参数：逐字来自 `sinSkillEffectMove` 的 `case SKILL_HEALING`（`sinSkillEffect.cpp:428-468`） ── */
/** `RotateAngle += 25`/帧（4096 = 整圈） */
const ROTATE_PER_FRAME = 25;
/** `RotateDistance.z` 初值 `128 * 24 * 2` = 6144 raw（= 24 世界单位） */
const RADIUS_RAW0 = 128 * 24 * 2;
/** `RotateDistance.z += 16`/帧（raw） */
const RADIUS_GROW_PER_FRAME = 16;
/** `MoveSpeed.y += 20`/帧（raw） */
const RISE_SPEED_GROW_PER_FRAME = 20;
/** `Posi.y = pChar->pY + 7000 + MoveSpeed.y` 里的 7000 raw（≈27.34 世界单位） */
const ANCHOR_LIFT_RAW = 7000;
/** PT 角度制：4096 = 整圈 */
const PT_ANGLE_FULL = 4096;

interface HealingOrbit {
  root: THREE.Object3D;
  mats: THREE.Material[];
  /** 施法者位置（起手快照；原版每帧读 `pChar->pX/pY/pZ`，我们暂不跟随移动） */
  at: { x: number; y: number; z: number };
  frame: number;
  nextLogFrame: number;
}
const live: HealingOrbit[] = [];
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
  void (async () => {
    try {
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

      // 图集切帧 + 逐实例克隆材质/贴图（AssetManager 的贴图全仓共享，不能直接改 offset/repeat）
      const mats: THREE.Material[] = [];
      for (const mesh of meshes) {
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mesh.material = list.map((m) => {
          const c = (m as THREE.MeshPhongMaterial).clone();
          if (c.map) {
            c.map = c.map.clone();
            c.map.repeat.set(1, 1 / ATLAS_FRAMES);
            c.map.offset.set(0, 1 - 1 / ATLAS_FRAMES);
            c.map.needsUpdate = true;
          }
          // 双面：材质数据里 `twoSide !== 1` 会被设成 FrontSide，而天使是单面片模型
          c.side = THREE.DoubleSide;
          c.transparent = true;
          c.opacity = BASE_ALPHA;
          c.depthWrite = false;
          mats.push(c);
          return c;
        }) as never;
      }

      const root = new THREE.Group();
      for (const m of meshes) root.add(m);
      if (fxScale !== 1) root.scale.multiplyScalar(fxScale);
      root.position.set(at.x, at.y + ANCHOR_LIFT_RAW / 256, at.z);
      if (casterYaw != null) root.rotation.y = casterYaw + Math.PI;
      deps.scene.add(root);

      // 运行期日志：创建 + 逐网格（用户 2026-09-27 明确要求）
      root.updateMatrixWorld(true);
      const box0 = new THREE.Box3().setFromObject(root);
      const size0 = box0.getSize(new THREE.Vector3());
      const center0 = box0.getCenter(new THREE.Vector3());
      logFn?.(`  ✦ Healing 小天使：烘焙网格 ${meshes.length} 个 / 源骨骼 ${skel.bones.length}`
        + ` 尺寸 ${size0.x.toFixed(1)}×${size0.y.toFixed(1)}×${size0.z.toFixed(1)}`
        + ` 世界中心 (${center0.x.toFixed(1)},${center0.y.toFixed(1)},${center0.z.toFixed(1)})`
        + ` 锚点 (${at.x.toFixed(1)},${(at.y + ANCHOR_LIFT_RAW / 256).toFixed(1)},${at.z.toFixed(1)})`
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
            return mm?.map ? `${img?.width ?? '?'}x${img?.height ?? '?'}（切 ${ATLAS_FRAMES} 帧）` : '无';
          })()}`);
      }
      live.push({ root, mats, at: { ...at }, frame: 0, nextLogFrame: 0 });
    } catch (e) {
      reportFallback('skillfx', 'Healing 小天使加载失败：' + String(e));
    }
  })();
}

/** 每帧调一次（WorldView 帧循环）：按 `case SKILL_HEALING` 逐字推进公转/上升/图集帧/淡出 */
export function updateHealingOrbits(dt: number): void {
  if (live.length === 0) return;
  frameAcc += dt * FPS;
  const n = Math.floor(frameAcc);
  if (n <= 0) return;
  frameAcc -= n;
  for (let i = live.length - 1; i >= 0; i--) {
    const o = live[i]!;
    o.frame += n;
    if (o.frame >= MAX_TIME) {
      o.root.removeFromParent();
      for (const m of o.mats) m.dispose();
      logFn?.(`  · Healing 小天使 f=${o.frame} 寿命到（Max_Time）⇒ 销毁`);
      live.splice(i, 1);
      continue;
    }
    const t = o.frame;
    // 公转：`RotateAngle += 25`/帧；半径 `RotateDistance.z` 从 6144 起每帧 +16（raw）
    const theta = (ROTATE_PER_FRAME * t) / PT_ANGLE_FULL * Math.PI * 2;
    const radius = (RADIUS_RAW0 + RADIUS_GROW_PER_FRAME * t) / 256;
    // `RotateDistance.y` 未设 = 0 ⇒ 偏移取 (r·sin, r·cos)
    o.root.position.set(
      o.at.x + Math.sin(theta) * radius,
      o.at.y + (ANCHOR_LIFT_RAW + RISE_SPEED_GROW_PER_FRAME * t) / 256,
      o.at.z + Math.cos(theta) * radius,
    );
    // `Angle.y = -((RotateAngle) + ANGLE_270)`（PT 角 → three 弧度）
    o.root.rotation.y = -((ROTATE_PER_FRAME * t + 270 * PT_ANGLE_FULL / 360) / PT_ANGLE_FULL * Math.PI * 2);
    // 图集帧推进 + 末 20 帧淡出
    const alpha = t >= FADE_AT ? Math.max(0, (150 - (t - FADE_AT) * 10) / 255) : BASE_ALPHA;
    const atlasFrame = Math.min(ATLAS_FRAMES - 1, Math.floor(t / ATLAS_FRAME_SPAN));
    for (const m of o.mats) {
      m.opacity = alpha;
      const map = (m as THREE.MeshPhongMaterial).map;
      if (map) map.offset.y = 1 - (atlasFrame + 1) / ATLAS_FRAMES;
    }
    if (t >= o.nextLogFrame) {
      o.nextLogFrame += 35;
      const scr = projectFn ? projectFn({ x: o.root.position.x, y: o.root.position.y, z: o.root.position.z }) : null;
      logFn?.(`  · Healing 小天使 f=${t} pos=(${o.root.position.x.toFixed(1)},`
        + `${o.root.position.y.toFixed(1)},${o.root.position.z.toFixed(1)}) 半径=${radius.toFixed(1)}`
        + ` 图集帧=${atlasFrame}/${ATLAS_FRAMES - 1} 透明度=${alpha.toFixed(2)}`
        + ` 屏幕=${scr ? `(${scr.x.toFixed(0)},${scr.y.toFixed(0)})${scr.onScreen ? '在画面内' : '★画面外'}` : '(无 project)'}`);
    }
  }
}
