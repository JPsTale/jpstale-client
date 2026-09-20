/**
 * 角色动画播放器 —— **「推进帧 → 求值 → 施加到骨骼 → 更新世界矩阵」的唯一实现**。
 *
 * 为什么要有它：这段尾巴在仓库里曾经写了 **5 份**（自机 / 远端玩家 / 怪物 / NPC / 选角预览），
 * 每份都长得差不多但细节在漂：
 *   - 选角预览用 `evalSkeleton`（**每帧新建求值工作区**）、而且**不调 `updateBoneWorlds`**
 *     ⇒ 骨骼世界矩阵只能靠渲染器的 `scene.updateMatrixWorld` 顺带更新，于是
 *     `skeleton.update()` 读到的是上一帧的矩阵 —— 姿态比别处晚一帧，且与游戏内不同源；
 *   - 怪物/远端/NPC 各自手写了一遍帧推进（`ANIM_UNITS_PER_SEC * min(dt,0.1)` + 自己对
 *     `motion.repeat` 取模），与 `advanceAnimFrame` 只差一个 `rate` 参数和边界写法。
 * 用户的定调（2026-09-15）：**"我不希望角色选择页面自己搞一套动画，它应该跟游戏内用一套东西。"**
 *
 * 分工（别把业务塞进来）：
 *   - 本模块只管"**怎么把一帧画出来**"：帧推进、求值、施加、矩阵更新；
 *   - **状态机策略留在调用方**（`step.ended` 之后是切条目、死亡定格、还是回 STAND）——
 *     各状态机本来就不同（自机与 NPC 有 DEAD 定格，怪物/远端只回 STAND）；
 *   - 自机的攻击要在"推进完、求值前"插命中帧判定（原版在事件帧上报），
 *     所以 `advance()` 与 `apply()` 是**分开的两步**，不是一个包办的大函数。
 */
import * as THREE from 'three';
import { advanceAnimFrame, applyToBones, createEvalWorkspace, evalSkeletonInto, evalBoneFrame, type BoneFrame } from './animation.js';
import { reportFallback } from './fallback-log.js';
import type { AnimStep, EvalWorkspace } from './animation.js';
import { CHRMOTION_EXT } from './char-format.js';
import type { InxData, MotionInfo, SmbData } from './char-format.js';

/**
 * 骨骼世界矩阵更新：**只对"父节点不是骨骼"的根骨** `updateMatrixWorld(true)`。
 *
 * `Skeleton.update()` 只读 `bone.matrixWorld` 算 `boneMatrices`，它自己**不会**更新 matrixWorld；
 * 脱离场景图的孤立根骨（如武器 waraxe）不更新就会停在 bind 值 → 武器不显示。
 * 父节点是骨骼的那些会被父链的递归带到，不必逐骨各递归一遍整棵子树（那是 O(n²)）。
 */
export function updateBoneWorlds(bones: THREE.Bone[]): void {
  for (const b of bones) {
    const p = b.parent;
    if (!p || !(p as THREE.Bone).isBone) b.updateMatrixWorld(true);
  }
}

/**
 * 求值工作区缓存（按动画包对象缓存）—— 每帧求值都要用，绝不能每帧新建。
 *
 * ⚠ 这份缓存在改造前只存在于 WorldView（`evalWsFor`）：选角预览每帧 new 一个工作区。
 * 现在**只有这一份**，所有调用方共用。
 */
const evalWsBySmb = new WeakMap<object, EvalWorkspace>();

export function evalWorkspaceFor(smb: object): EvalWorkspace {
  let ws = evalWsBySmb.get(smb);
  if (!ws) {
    ws = createEvalWorkspace(smb as SmbData);
    evalWsBySmb.set(smb, ws);
  }
  return ws;
}

export interface AnimPlayer {
  /** 当前帧位置（子帧单位：1 动画帧 = 160）。只读；改它用 `setFrame` */
  readonly frame: number;
  /** 直接设帧（切条目用 `motion.startFrame * 160`；死亡定格、命中回绕也用它） */
  setFrame(frame: number): void;
  /** 推进一步（内部就是共享的 `advanceAnimFrame`，含 `repeat` 取模与 dt 上限） */
  advance(motion: MotionInfo, dt: number, rate?: number): AnimStep;
  /**
   * 把当前帧求值并施加到骨骼（含 `updateBoneWorlds` + `skeleton.update()`）。
   * @param smbOverride 该动作自带的动画包（怪物/NPC 的 `motion.animSmb`）；缺省用构造时那个
   */
  apply(smbOverride?: SmbData): void;
  /**
   * **把骨摆到指定帧、返回它的世界坐标** —— 原版武器曳光的回溯求值
   * （`cAssaMotionBlur::Draw`：`pframe = frame - cnt*30; AnimObjectTree(obj, pframe, …)`，
   * `AssaParticle.cpp:2427-2445`）。
   *
   * ⚠ **它会改骨骼姿势**（把骨架摆到那一历史帧）⇒ 采样完调用方**必须** `apply()`
   *   把当前帧复原，否则角色停在历史姿势上。
   */
  sampleBoneAt(boneName: string, atFrame: number, smbOverride?: SmbData): { x: number; y: number; z: number } | null;
  /**
   * 同 `sampleBoneAt`，但返回**整个世界矩阵**（要朝向时用 —— 例如玩家武器曳光的第二端点
   * = 骨原点 + **骨轴** × `SizeMax`，`DrawMotionBlurTool:10214-10245`）。
   * ⚠ 同样**会改骨骼姿势**，调用方必须 `apply()` 复原。返回的是 `clone()`，安全持有。
   */
  sampleBoneMatrix(boneName: string, atFrame: number, smbOverride?: SmbData): THREE.Matrix4 | null;
  /**
   * **只求一根骨的"原点 + 局部 Y 轴"**（曳光两端点直接由它算）—— **不碰骨架**：
   * 不 `applyToBones`、不 `skeleton.update()`、也不需要事后 `apply()` 复原。
   *
   * ⚠ 为什么必须有这个（而不是用上面那个）：近战曳光每帧要 **32 个历史帧**的骨矩阵，
   *   上面那个每段都会摆**整个骨架 + 重算蒙皮矩阵** ⇒ 32 段 × 2 手 = 64 次/帧，
   *   用户实测"一攻击就卡成 PPT"。本方法只算目标骨**及其父链**（约 6 根）——
   *   与原版 `AnimObjectTree(ChrTool->ObjBip, pframe, …)` 同量级。
   */
  sampleBoneEnds(boneName: string, atFrame: number, smbOverride?: SmbData): BoneFrame | null;
}

// 施加姿势用的临时量。**模块级即可**：`applyPose` 全同步、不会重入（每帧串行调用）。
const tmpM = new THREE.Matrix4();
const posV = new THREE.Vector3();
const quatQ = new THREE.Quaternion();
const sclV = new THREE.Vector3();

/**
 * 把"某角色的当前帧"求值并施加到骨骼 —— **姿势尾巴的唯一实现**。
 *
 * 这就是"每帧把一帧动画画出来"的全部内容：求值（复用工作区）→ 施加到骨骼 →
 * 更新根骨世界矩阵 → `skeleton.update()`。`AnimPlayer.apply` 直接转调它，
 * 所以自机 / 选角预览 / 远端 / 怪物 / NPC 全走同一段代码。
 *
 * 帧号存在哪儿由调用方决定：自机与选角预览放在 `AnimPlayer` 里，
 * 怪物/NPC/远端沿用它们各自的 `actor.animFrame`（那些结构里还带着别的状态）。
 */
export function applyPose(smb: SmbData, frame: number, bones: THREE.Bone[], skeleton: THREE.Skeleton): void {
  const frames = evalSkeletonInto(smb, frame, false, evalWorkspaceFor(smb));
  applyToBones(bones, frames, tmpM, posV, quatQ, sclV);
  updateBoneWorlds(bones);
  skeleton.update();
}

/**
 * 造一个播放器。`smb` 是默认动画包（自机 = 职业包，怪物 = 它的包），
 * 骨骼与骨架由调用方给（它们可能被身体 / 头 / 武器共享，故不在这里建）。
 */
export function createAnimPlayer(smb: SmbData, bones: THREE.Bone[], skeleton: THREE.Skeleton): AnimPlayer {
  let frame = 0;
  return {
    get frame() { return frame; },
    setFrame(f: number) { frame = f; },
    advance(motion: MotionInfo, dt: number, rate = 1): AnimStep {
      const step = advanceAnimFrame(frame, motion, dt, rate);
      frame = step.frame;
      return step;
    },
    apply(smbOverride?: SmbData): void {
      applyPose(smbOverride ?? smb, frame, bones, skeleton);
    },
    sampleBoneAt(boneName: string, atFrame: number, smbOverride?: SmbData): { x: number; y: number; z: number } | null {
      // ⚠ 动画包必须与 `apply()` 用**同一份**：技能动作走 `m.animSmb`（`apply(m.animSmb ?? undefined)`），
      //   回溯时若用默认包，取到的是**另一个动作**的姿势 ⇒ 带子形状全错。
      // `applyPose` 内部已含 `updateBoneWorlds` ⇒ 骨的 `matrixWorld` 就是这一帧的
      applyPose(smbOverride ?? smb, atFrame, bones, skeleton);
      const b = bones.find((x) => x.name.toLowerCase() === boneName.toLowerCase());
      if (!b) return null;
      const e = b.matrixWorld.elements;
      return { x: e[12]!, y: e[13]!, z: e[14]! };
    },
    sampleBoneMatrix(boneName: string, atFrame: number, smbOverride?: SmbData): THREE.Matrix4 | null {
      applyPose(smbOverride ?? smb, atFrame, bones, skeleton);
      const want = boneName.toLowerCase();
      const b = bones.find((x) => x.name.toLowerCase() === want);
      return b ? b.matrixWorld.clone() : null;
    },
    sampleBoneEnds(boneName: string, atFrame: number, smbOverride?: SmbData): BoneFrame | null {
      const s = smbOverride ?? smb;
      const bf = evalBoneFrame(s, boneName, atFrame, evalWorkspaceFor(s));
      // **不静默**：骨名找不到（拼错/该模型没这根）必须看得见 —— 否则曳光只是"不见了"，
      // 无从判断是没数据还是没渲染（我一度在这条路上静默，白查了一轮）。
      if (!bf) {
        reportFallback('fx', `单骨求值取不到骨「${boneName}」：该动画包里没有这个名字的骨`
          + '（字段是 `Obj3D.nodeName`，精确匹配不区分大小写）⇒ 本帧端点为零');
      }
      return bf;
    },
  };
}

/**
 * 由 `bip .inx` + 动画包构造动作列表（**唯一实现**）—— 选角预览与游戏内都必须走它。
 *
 * 两处历史差异（都是漂移，已收敛）：
 *   - 选角预览多一层 `only`（lite 包只带一条条目的关键帧，见 `liteInxIndices`）；
 *   - 帧号要加上 `tmFrame` 偏移（`.inx` 的 start/end 是**条目内**帧号，全局帧轴在 smb 里）。
 */
export function buildMotionList(animSmb: SmbData, bipInxInfo: InxData, only?: number[]): MotionInfo[] {
  const list: MotionInfo[] = [];
  const tmFrame = animSmb.tmFrame;
  for (let i = CHRMOTION_EXT; i < bipInxInfo.motionCount; i++) {
    if (only && !only.includes(i)) continue;
    const mi = bipInxInfo.motions[i];
    if (!mi.state && !mi.startFrame && !mi.endFrame) continue;
    let startFrame = mi.startFrame;
    let endFrame = mi.endFrame;
    if (tmFrame && mi.motionFrame > 0 && tmFrame[mi.motionFrame - 1]) {
      const off = tmFrame[mi.motionFrame - 1].startFrame / 160;
      startFrame += off;
      endFrame += off;
    }
    list.push({ ...mi, startFrame, endFrame });
  }
  return list;
}
