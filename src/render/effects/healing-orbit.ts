/**
 * Healing 的**旋转小天使** —— `sinEffect_Healing2`（`sinSkillEffect.cpp:1632-1668`）第二份实例。
 *
 * ## 资产与渲染路径（2026-09-27 真机调试定案）
 *
 * `HIALTEST.ASE`（= 我们的 `hialtest.smb` 骨架 + `hialtest.smd` 网格）**是一具骨骼蒙皮模型**：
 * `.smb` 里是 **33 根标准 Biped 骨骼**（`Bip01 / Spine / Neck / Head / Clavicle / UpperArm /
 * Forearm / Hand / Finger / Thigh / Calf / Foot / Toe`），绑定姿态就是**一个展开光翼的人形天使**
 * （实测包围盒 17.6 × 11.1 × 9.1 单位）。
 *
 * ⚠ **前几版错在哪**（记下来别再犯）：用 `static-fx.loadStaticSmd` 渲染 `.smd` ——
 * 那是静态网格链，**不做骨骼蒙皮** ⇒ 顶点停在绑定空间、整具模型塌成"一小团白光"
 * （实测：静态链只有 ~7 单位的一团；蒙皮链是 17.6 单位、翅膀清晰可辨）。
 * **判据：`.smb` 有骨骼（`boneNames` 非空）就必须走 `buildSkeleton + buildSkinnedMesh`**
 * （身体/怪物同一条链，见 `monster-loader` / `lite-loader`）。
 *
 * ## 原版参数（逐条出处）
 *
 *   · `sinEffectDefaultSet(Index2, SIN_EFFECT_MESH, pChar, 0, 7000)`（`:1646`）——
 *     **Y = 7000 是高度偏移**（`sinEffect2.cpp:1201-1220`：`Posi.y = pChar->pY + Y`）
 *     ⇒ 锚点 = 角色位置上方 **7000/256 ≈ 27.34 世界单位**。
 *     （第一份 `BoneFlag = 1` 贴骨实例 Y = 13000 ≈ 50.8，**未移植**——需骨骼挂载，presenter 上报。）
 *   · `Max_Time = 250`（`:1654`）—— 生命周期 250 逻辑帧（@70fps ≈ 3.57s）。
 *   · `AniCount = 1; AniMax = 30; AniTime = 1`（`:1655-1657`）—— 网格自带 30 帧动画。
 *     ⚠ 本机 `.smd` 的 `tmFrameCnt = 0`（无顶点动画数据）⇒ **绑定姿态**即当前可见形态；
 *     原版 `HIALTEST.ASE` 里的 30 帧（扇翅）在转换产物中缺失 —— 显式缺口，presenter 上报。
 *   · `Color_A = 150`（`:1659`）—— 初始不透明度 150/255。
 *   · `RotateAngle = 256`（`:1661`）—— 每帧公转 256（PT 角度制 4096/圈 = 1/16 圈/帧）。
 *   · `RotateDistance.z = 256 * 16`（`:1662`）—— 公转半径 **16 世界单位**。
 *   · `Angle.y`（`:1663`）—— 朝向随公转同步。
 *   · `MoveSpeed.y = 200`（`:1664`）—— 每帧上升 200/256 ≈ 0.78 单位。
 *   · `AlphaTime = Max_Time - 20`、`AlphaAmount = 10`（`:1665-1667`）—— 最后 20 帧每帧 -10/255 淡出。
 *
 * 驱动模式与 `multi-spark-runner` 同款：调用方每帧调 {@link updateHealingOrbits}（70fps 逻辑帧）。
 */
import * as THREE from 'three';
import { loadParsedAsset } from '../../core/asset-manager.js';
import { parseSmb } from '../../core/char-parser.js';
import { buildSkeleton, buildSkinnedMesh } from '../skinned-builder.js';
import { loadCharTextures } from '../char-texture-loader.js';
import { reportFallback } from '../../char/fallback-log.js';

/** 骨架（33 根 Biped 骨骼）—— 资产与小写化后的实际路径一致 */
const SMB = '/res/image/sinimage/effect/skilleffect/healing/hialtest.smb';
/** 蒙皮网格（若不蒙皮会塌成一团：见文件头 ⚠） */
const SMD = '/res/image/sinimage/effect/skilleffect/healing/hialtest.smd';

const ANCHOR_LIFT = 7000 / 256;        // sinEffectDefaultSet 的 Y=7000 ⇒ 角色上方 27.34
const MAX_TIME = 250;                  // Max_Time
const TURN_PER_FRAME = 256 / 4096;     // RotateAngle（4096 = 整圈）
const RADIUS = 16;                     // RotateDistance.z = 256*16（raw）÷256
const RISE_PER_FRAME = 200 / 256;      // MoveSpeed.y
const BASE_ALPHA = 150 / 255;          // Color_A
/** `HIAL.bmp` 的图集切分：实测 64×512 = 8 帧 64×64（每帧纯色渐变） */
const HEALING_ATLAS_FRAMES = 8;
/** 取第几帧（0 = 最亮/白）。原版由 `AniCount`/`TexRect` 逐帧推进，本机缺该数据 ⇒ 固定单帧 */
const HEALING_ATLAS_FRAME = 0;
/** 该帧在 UV 里的起点 v（three 的 UV v=0 在贴图**底部**（flipY）⇒ 帧 0 在顶部区间） */
const ATLAS_V0 = 1 - (HEALING_ATLAS_FRAME + 1) / HEALING_ATLAS_FRAMES;
/** 每推进一格图集帧所需的逻辑帧数（8 帧铺满 `MAX_TIME`） */
const ATLAS_FRAME_SPAN = Math.max(1, Math.floor(MAX_TIME / HEALING_ATLAS_FRAMES));
const FADE_AT = 230;                   // AlphaTime = Max_Time - 20
const FPS = 70;

interface HealingOrbit {
  root: THREE.Object3D;
  mats: THREE.Material[];
  at: { x: number; y: number; z: number };
  frame: number;
  /** 下一条运行期日志的帧号（每 35 帧 = 0.5s 一条；见 updateHealingOrbits 的说明） */
  nextLogFrame: number;
}
const live: HealingOrbit[] = [];
let frameAcc = 0;

/** 起一份旋转小天使（`at` = 被治疗者**脚底**位置；原版 `pChar` = 目标 ?: 自己） */
export function runHealingOrbit(
  deps: { scene: THREE.Scene; log?: (msg: string) => void },
  at: { x: number; y: number; z: number },
  fxScale = 1,
): void {
  logFn = deps.log;
  void (async () => {
    try {
      const smb = await loadParsedAsset(SMB, 'anim', parseSmb, true);
      const smd = await loadParsedAsset(SMD, 'model', parseSmb, true);
      const skel = buildSkeleton(smb, false);
      const built = buildSkinnedMesh(smd, smb, null, false, skel);
      await loadCharTextures(built.texturesToLoad);

      // **图集切帧**（2026-09-27 真机诊断定案）：`HIAL.bmp` 是 **64×512 = 8 帧 64×64 的序列图集**
      // （实测逐帧渲染：8 张**清晰可辨的精灵天使**，颜色白→蓝渐变），而本机 `.smd` 的 UV 覆盖
      // **整张图集**（实测 u=0.09..0.98 v=0.29..1.00 / 0..1）⇒ 每个面片把 8 帧整条涂上去，
      // 加法混合下呈现为**一片白雾**。原版材质带 `TexRect`（子帧矩形、逐帧切换）—— 转换产物丢了它。
      // 这里用**贴图 transform**（`map.offset/repeat`）补回：零顶点开销、逐实例独立，
      // 每帧在 `updateHealingOrbits` 里推进帧号（白→蓝，即原版 `AniCount`/`AniTime` 的意图）。
      // ⚠ 必须**克隆贴图对象**（`tex.clone()` 共享 image）：AssetManager 的贴图是全仓共享的，
      //   直接改 `offset/repeat` 会污染所有使用者。
      const mats: THREE.Material[] = [];
      for (const mesh of built.meshes) {
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mesh.material = list.map((m) => {
          const c = (m as THREE.MeshPhongMaterial).clone();
          if (c.map) {
            c.map = c.map.clone();
            c.map.repeat.set(1, 1 / HEALING_ATLAS_FRAMES);
            c.map.offset.set(0, ATLAS_V0);
            c.map.needsUpdate = true;
          }
          c.transparent = true;
          c.opacity = BASE_ALPHA;
          c.depthWrite = false;
          mats.push(c);
          return c;
        }) as never;
      }
      const root = built.group;
      if (fxScale !== 1) root.scale.multiplyScalar(fxScale);
      root.position.set(at.x, at.y + ANCHOR_LIFT, at.z);
      deps.scene.add(root);
      // **运行期诊断**（用户 2026-09-27 要求："加粒子运行期间的日志"——截图看不出位置/尺寸/透明度）：
      // 创建时打印**实际渲染包围盒**（`Box3.setFromObject`，含骨骼蒙皮后的真实尺寸）与材质/贴图状态。
      root.updateMatrixWorld(true);
      const box0 = new THREE.Box3().setFromObject(root);
      const size0 = box0.getSize(new THREE.Vector3());
      const center0 = box0.getCenter(new THREE.Vector3());
      const withMap = mats.filter((m) => !!(m as THREE.MeshPhongMaterial).map).length;
      // **逐网格**的几何/贴图/UV 诊断（用户要求"运行期日志"：只有它能回答"白雾是不是它、
      // 哪个部件巨大、贴图对不对"）。每个蒙皮网格一条。
      for (const [mi, mesh] of built.meshes.entries()) {
        const g = mesh.geometry;
        g.computeBoundingBox();
        const gb = g.boundingBox;
        const gs = gb ? gb.getSize(new THREE.Vector3()) : null;
        const uv = g.getAttribute('uv');
        let u0 = 9, u1 = -9, v0 = 9, v1 = -9;
        for (let i = 0; uv && i < uv.count; i++) {
          const u = uv.getX(i), v = uv.getY(i);
          if (u < u0) u0 = u; if (u > u1) u1 = u;
          if (v < v0) v0 = v; if (v > v1) v1 = v;
        }
        const mm = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshPhongMaterial;
        const tex = mm?.map;
        const src = (tex?.image as { width?: number; height?: number } | undefined);
        deps.log?.(`  · 网格[${mi}] '${mesh.name || '(无名)'}' 顶点 ${g.getAttribute('position')?.count ?? 0}`
          + (gs ? ` 几何包围盒 ${gs.x.toFixed(1)}×${gs.y.toFixed(1)}×${gs.z.toFixed(1)}` : ' 几何包围盒 无')
          + ` UV u=${u0.toFixed(2)}..${u1.toFixed(2)} v=${v0.toFixed(2)}..${v1.toFixed(2)}`
          + ` 贴图 ${tex ? `${src?.width ?? '?'}x${src?.height ?? '?'} 混合=${mm.blending} 透明=${mm.transparent}` : '无'}`);
      }
      deps.log?.(`  ✦ Healing 小天使：蒙皮 ${built.meshes.length} 网格 / ${skel.bones.length} 骨骼 / `
        + `材质 ${mats.length}（有贴图 ${withMap}，待载 ${built.texturesToLoad.length}）`
        + ` 尺寸 ${size0.x.toFixed(1)}×${size0.y.toFixed(1)}×${size0.z.toFixed(1)}`
        + ` 中心 (${center0.x.toFixed(1)},${center0.y.toFixed(1)},${center0.z.toFixed(1)})`
        + ` 锚点 (${at.x.toFixed(1)},${(at.y + ANCHOR_LIFT).toFixed(1)},${at.z.toFixed(1)})`);
      live.push({ root, mats, at: { ...at }, frame: 0, nextLogFrame: 0 });
    } catch (e) {
      reportFallback('skillfx', 'Healing 小天使加载失败：' + String(e));
      return;
    }
  })();
  // 30 帧扇翅（AniMax）在本机资产里缺数据（tmFrameCnt = 0）—— 显式登记，不假装已实现
  reportFallback('skillfx', 'Healing：原版 AniMax=30 的扇翅动画在 .smd 里无帧数据（tmFrameCnt=0）⇒ 绑定姿态；'
    + '第一份贴骨实例（BoneFlag=1，Y=13000）未移植');
}

/** 每帧调一次（WorldView 帧循环）：公转 + 上升 + 末 20 帧淡出 */
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
      logFn?.(`  · Healing 小天使 f=${o.frame} 寿命到 ⇒ 销毁（网格与材质已清理）`);
      live.splice(i, 1);
      continue;
    }
    const ang = o.frame * TURN_PER_FRAME * Math.PI * 2;
    o.root.position.set(
      o.at.x + Math.cos(ang) * RADIUS,
      o.at.y + ANCHOR_LIFT + o.frame * RISE_PER_FRAME,
      o.at.z + Math.sin(ang) * RADIUS,
    );
    o.root.rotation.y = -ang;   // Angle.y 与公转同步（原版 :1663）
    const alpha = o.frame >= FADE_AT
      ? Math.max(0, (150 - (o.frame - FADE_AT) * 10) / 255)
      : BASE_ALPHA;
    // **图集帧推进**：8 帧铺满 250 帧寿命（每 `ATLAS_FRAME_SPAN` 帧进一格）—— 白 → 蓝的渐变序列。
    // ⚠ 8 帧的具体时间分配是本机缺 `TexRect` 数据下的**唯一可推之处**（原版 `AniTime = 1` 驱动
    //   网格帧，但本机 `.smd` 的 `tmFrameCnt = 0`）⇒ 先按"整段寿命走完 8 帧"实现，观感可调。
    const atlasFrame = Math.min(HEALING_ATLAS_FRAMES - 1, Math.floor(o.frame / ATLAS_FRAME_SPAN));
    for (const m of o.mats) {
      m.opacity = alpha;
      const map = (m as THREE.MeshPhongMaterial).map;
      if (map) map.offset.y = 1 - (atlasFrame + 1) / HEALING_ATLAS_FRAMES;
    }
    // **运行期日志**（用户 2026-09-27 要求）：每 35 逻辑帧（0.5s）一条 —— 位置是"追出来的"
    // （公转 + 上升都靠它），只有日志能证明它真的在动、在哪、有多淡。
    if (o.frame >= o.nextLogFrame) {
      o.nextLogFrame += 35;
      o.root.updateMatrixWorld(true);
      logFn?.(`  · Healing 小天使 f=${o.frame} pos=(${o.root.position.x.toFixed(1)},`
        + `${o.root.position.y.toFixed(1)},${o.root.position.z.toFixed(1)}) `
        + `图集帧=${atlasFrame}/${HEALING_ATLAS_FRAMES - 1} 可见=${o.root.visible} 透明度=${alpha.toFixed(2)} `
        + `父节点=${o.root.parent ? 'scene' : 'NONE'}`);
    }
  }
}

/** 运行期日志出口（由 `runHealingOrbit` 注入；未注入=不打）—— 与 `deps.log` 同一通道 */
let logFn: ((msg: string) => void) | undefined;
