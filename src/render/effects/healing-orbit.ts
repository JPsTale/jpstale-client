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
const FADE_AT = 230;                   // AlphaTime = Max_Time - 20
const FPS = 70;

interface HealingOrbit {
  root: THREE.Object3D;
  mats: THREE.Material[];
  at: { x: number; y: number; z: number };
  frame: number;
}
const live: HealingOrbit[] = [];
let frameAcc = 0;

/** 起一份旋转小天使（`at` = 被治疗者**脚底**位置；原版 `pChar` = 目标 ?: 自己） */
export function runHealingOrbit(
  deps: { scene: THREE.Scene; log?: (msg: string) => void },
  at: { x: number; y: number; z: number },
  fxScale = 1,
): void {
  void (async () => {
    try {
      const smb = await loadParsedAsset(SMB, 'anim', parseSmb, true);
      const smd = await loadParsedAsset(SMD, 'model', parseSmb, true);
      const skel = buildSkeleton(smb, false);
      const built = buildSkinnedMesh(smd, smb, null, false, skel);
      await loadCharTextures(built.texturesToLoad);

      // 逐实例克隆材质（末段淡出要独立改透明度；蒙皮网格共享材质会互相干扰）
      const mats: THREE.Material[] = [];
      for (const mesh of built.meshes) {
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mesh.material = list.map((m) => {
          const c = (m as THREE.MeshPhongMaterial).clone();
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
      deps.log?.(`  ✦ Healing 小天使：骨骼蒙皮 ${built.meshes.length} 网格 / ${skel.bones.length} 骨骼，`
        + `锚点上方 ${ANCHOR_LIFT.toFixed(1)}、绕头 r=${RADIUS} 公转上升 ${(MAX_TIME / FPS).toFixed(2)}s`);
      live.push({ root, mats, at: { ...at }, frame: 0 });
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
    for (const m of o.mats) m.opacity = alpha;
  }
}
