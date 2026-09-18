/**
 * PT 时间轴 → quarks：把 `core/effect/pt-timeline.ts` 的状态机接到 quarks 的粒子上。
 *
 * 一个 Behavior 顶掉原来的整套"曲线近似"（`SizeOverLife`/`ColorOverLife`/`VelocityTrack`/
 * `PtRotationTrack`/`PtCameraFacingSpin`/`ApplyForce`）：每帧按 PT 的**每帧顺序**推进状态，
 * 再把结果写进 quarks 粒子的 `position/size/color/rotation`。
 *
 * 朝向按 `HoNewParticle.cpp:3090-3180` 的四种面片语义（规格 §B5.6）：
 *   · **TYPE_ONE**   相机空间四边形 + `PartAngle` 做 `Rx·Ry·Rz`（`AddFace2DBillBoard`）
 *   · **TYPE_TWO**   **世界空间 XZ 平面** + `PartAngle`（+ 发射器 Angle，我方为 0）（`AddFace2dPlane`）
 *   · **TYPE_THREE** 屏幕空间**轴向条带**：轴 = 旋转后的局部 Y，宽度朝相机展开（`AddFaceThree`）
 *   · **TYPE_FOUR**  位置历史条带（`AddFaceTrace`）—— 交给我们保留的 quarks `RenderMode.Trail`，
 *                    横截面朝向用 `LocalAngle` 这一条**未表达**（近似，见 notes）
 *   · **TYPE_FIVE**（我方扩展，非 PT）面片法线对齐速度方向
 *
 * ⚠ `LocalAngle` 原版**只喂 TYPE_FOUR**（`AddFaceTrace`）；ONE/TWO/THREE 用的是 `PartAngle`
 * —— 我们此前给 billboard 也做"局部旋转"是发明，这里按原版改回，并在 notes 里说明。
 */
import * as THREE from 'three';
import type { Behavior, Particle, IParticleSystem } from 'three.quarks';
import {
  createState, stepFrame, quadSize, type PtState, type PtTimelineCfg,
} from '../../core/effect/pt-timeline.js';

const REF_UP = new THREE.Vector3(0, 1, 0);
const tmpDir = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpUp = new THREE.Vector3();

/** 由 BEHAVIOR 持有的相机（`PtCameraFacingSpin` 时代就是这一份） */
let camRef: THREE.Camera | null = null;
export function setTimelineCamera(cam: THREE.Camera | null): void { camRef = cam; }

const DEG = Math.PI / 180;

/**
 * **我方扩展**（非原版）：把 `localangle*` 也施加到 TYPE_ONE/TWO/THREE 的朝向上。
 *
 * 原版 `LocalAngle` **只被 TYPE_FOUR 拖尾用**（`AddFaceTrace`），ONE/TWO/THREE 用的是 `PartAngle`
 * —— 我们此前给广告板做过"局部旋转"，那是发明。默认关（= 按原版）；开则保留那个观感
 * （用户在实验室肉眼比对后决定）。
 */
let localAngleSpin = false;
export function setLocalAngleSpin(on: boolean): void { localAngleSpin = on; }
export function isLocalAngleSpin(): boolean { return localAngleSpin; }

export interface PtParticleLike {
  age?: number;
  life?: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  size: THREE.Vector3;
  color: THREE.Vector4;
  rotation?: number | THREE.Quaternion;
}

export class PtTimeline implements Behavior {
  type = 'PtTimeline';
  private states = new WeakMap<object, PtState>();
  /**
   * 发射器节点（`initialize` 时拿到）。
   *
   * ⚠ **必须自己加上发射器的世界坐标**：`.part` 系统建的是 `worldSpace = true`
   * （`quarks-runtime.spawnSystem`：`ps.worldSpace = !opts.follow`）——那种模式下 quarks 把
   * 发射器世界坐标**烘进出生位置**，而本行为每帧用 `st.pos`（= PT 的 `LocalPos`，局部）覆盖
   * `particle.position` ⇒ 若不自己叠加，粒子会全部回到**世界原点**（用户实测：CC 三招的粒子
   * 都出现在 (0,0,0)，冰块网格在目标处 —— 网格走另一条链，所以只有它是对的）。
   */
  private emitter: THREE.Object3D | null = null;
  /** `worldSpace = true`（= 非 `follow`，默认）：位置是**世界坐标**且在出生时冻结（尾迹语义） */
  private worldSpace = true;
  /** 每粒子的姿态（TYPE_TWO/THREE 需要按位置/相机算，逐帧写） */
  private m = new THREE.Matrix4();
  private tmpWorld = new THREE.Vector3();

  constructor(
    private cfg: PtTimelineCfg,
    /** PT 的复制类型（1..4）；5 = 我方扩展 */
    private particleType: number,
  ) {}

  initialize(particle: Particle, ps: IParticleSystem): void {
    const p = particle as unknown as PtParticleLike;
    const st = createState(this.cfg, Math.random);
    const psAny = ps as unknown as { emitter?: THREE.Object3D; worldSpace?: boolean };
    this.emitter = psAny.emitter ?? null;
    this.worldSpace = psAny.worldSpace !== false;
    // quarks 在出生时已把发射器世界坐标写进 `p.position`（`worldSpace = true` 时）⇒ **捕获它再覆盖**：
    // 原版 `WorldPos` 就是"创建时的发射器位置"，且默认不再更新（尾迹）。若就地覆盖成局部坐标，
    // 粒子会全跑到世界原点（用户实测：CC 三招的粒子都在 (0,0,0)）。
    st.base = [p.position.x, p.position.y, p.position.z];
    this.states.set(p as object, st);
    p.life = st.life;                    // 寿命 = 逐粒子掷（`CreateNewParticle`）
    this.writePos(p, st);                // 出生点 = 发射器世界坐标 + 发射半径盒内一点
    p.velocity.set(0, 0, 0);             // 位置由状态机积分（`LocalPos += Dir·dt`），不走 quarks 的积分
    this.write(p, st, 0, true);
  }

  update(particle: Particle, delta: number): void {
    const p = particle as unknown as PtParticleLike;
    const st = this.states.get(p as object);
    if (!st) return;
    stepFrame(this.cfg, st, delta, Math.random);   // 时钟 → 各 Step → 重力（逐粒子逐帧重掷）→ 事件
    this.writePos(p, st);
    p.velocity.set(0, 0, 0);
    this.write(p, st, delta, false);
  }

  frameUpdate(): void { /* 逐粒子在 update 里做 */ }
  toJSON(): { type: string } { return { type: this.type }; }
  clone(): PtTimeline { return new PtTimeline(this.cfg, this.particleType); }
  reset(): void { /* 状态在 WeakMap 里，随粒子回收被 initialize 覆盖 */ }

  /**
   * 写位置 —— 按 quarks 的 `worldSpace` 分两种（对应原版 `attachPosFlag` 的两种语义）：
   *   · `worldSpace = true`（**非** follow，默认）= 原版"`WorldPos` 出生时冻结" ⇒
   *     世界坐标 = **出生时捕获的 base** + `LocalPos` ⇒ 发射器飞走时老粒子留在原地 = **尾迹**；
   *   · `worldSpace = false`（follow/attach）= 原版 `attachPosFlag` ⇒ 写**局部**坐标，
   *     由 quarks 按发射器当前变换 ⇒ 整团跟着载体走。
   */
  private writePos(p: PtParticleLike, st: PtState): void {
    if (this.worldSpace) {
      p.position.set(st.base[0]! + st.pos[0]!, st.base[1]! + st.pos[1]!, st.base[2]! + st.pos[2]!);
    } else {
      p.position.set(st.pos[0]!, st.pos[1]!, st.pos[2]!);
    }
  }

  /** 当前**世界**坐标（TYPE_THREE 的屏幕角要用；两种模式下算法不同） */
  private worldOf(st: PtState, out: THREE.Vector3): THREE.Vector3 {
    if (this.worldSpace) return out.set(st.base[0]!, st.base[1]!, st.base[2]!).add(new THREE.Vector3(st.pos[0]!, st.pos[1]!, st.pos[2]!));
    this.emitter?.getWorldPosition(out) ?? out.set(0, 0, 0);
    return out.set(out.x + st.pos[0]!, out.y + st.pos[1]!, out.z + st.pos[2]!);
  }

  /** 把状态写进 quarks 粒子（尺寸/颜色/朝向） */
  private write(p: PtParticleLike, st: PtState, _dt: number, _init: boolean): void {
    const { w, h } = quadSize(st);                       // SizeExt != 0 才覆盖高度
    p.size.set(w, h, 1);
    p.color.set(
      st.val.color[0]! / 255, st.val.color[1]! / 255,
      st.val.color[2]! / 255, st.val.color[3]! / 255,
    );
    const q = p.rotation as THREE.Quaternion | undefined;
    if (!q || !(q as unknown as { isQuaternion?: boolean }).isQuaternion) return;
    const cam = camRef;

    if (this.particleType === 2) {
      // 世界空间 XZ 面：只吃 PartAngle（发射器 Angle 我方恒 0）
      const [rx, ry, rz] = st.val.partAngle as [number, number, number];
      this.eulerToQuat(q, rx, ry, rz);
      if (localAngleSpin) this.applyLocal(q, st);
      return;
    }
    if (this.particleType === 3 && cam) {
      // 轴向条带：轴 = 旋转后的局部 Y 投影到屏幕的**面内角**（`AddFaceThree` 的屏幕空间语义）
      tmpDir.set(0, 1, 0).applyQuaternion(this.eulerQuat(st.val.partAngle as [number, number, number]));
      tmpDir.add(this.worldOf(st, this.tmpWorld));
      const px = tmpDir.x - cam.position.x, py = tmpDir.y - cam.position.y, pz = tmpDir.z - cam.position.z;
      // 用相机基把世界向量投到相机空间算屏幕角（等价 GetCameraCoord + atan2）
      tmpRight.crossVectors(cam.up, cam.getWorldDirection(new THREE.Vector3())).normalize();
      tmpUp.crossVectors(cam.getWorldDirection(new THREE.Vector3()), tmpRight).normalize();
      const sx = px * tmpRight.x + py * tmpRight.y + pz * tmpRight.z;
      const sy = px * tmpUp.x + py * tmpUp.y + pz * tmpUp.z;
      const theta = Math.atan2(sy, sx) - Math.PI / 2;    // 轴的屏幕角（Y 轴 → 0 表示竖直）
      q.copy(cam.quaternion).multiply(this.axisQuat(new THREE.Vector3(0, 0, 1), theta));
      if (localAngleSpin) this.applyLocal(q, st);
      return;
    }
    if (this.particleType === 5) {
      // 我方扩展：面片法线对齐速度方向
      const [dx, dy, dz] = st.val.dir as [number, number, number];
      tmpDir.set(dx, dy, dz);
      if (tmpDir.lengthSq() > 1e-9) {
        this.m.lookAt(tmpDir.normalize(), new THREE.Vector3(0, 0, 0), REF_UP);
        q.setFromRotationMatrix(this.m);
      } else q.copy(cam ? cam.quaternion : new THREE.Quaternion());
      return;
    }
    // TYPE_ONE（与 TYPE_FOUR 的兜底）：相机空间 + PartAngle 做 Rx·Ry·Rz（照抄 `AddFace2DBillBoard`）
    const [rx, ry, rz] = st.val.partAngle as [number, number, number];
    this.eulerToQuat(q, rx, ry, rz);
    if (cam) q.premultiply(cam.quaternion);
    if (localAngleSpin) this.applyLocal(q, st);
  }

  /** 开关打开时：在既有朝向上再叠一层 `LocalAngle`（我方扩展，非原版语义） */
  private applyLocal(q: THREE.Quaternion, st: PtState): void {
    const [lx, ly, lz] = st.val.localAngle as [number, number, number];
    if (!lx && !ly && !lz) return;
    q.multiply(this.eulerQuat([lx, ly, lz]));
  }

  private eulerQuat([rx, ry, rz]: [number, number, number]): THREE.Quaternion {
    const q = new THREE.Quaternion();
    this.eulerToQuat(q, rx, ry, rz);
    return q;
  }

  /** 原版顺序 `Rx·Ry·Rz`（`HoNewParticle.cpp:2452`）⇒ 四元数 `qx*qy*qz`（作用于向量 = 先 z 再 y 再 x） */
  private eulerToQuat(q: THREE.Quaternion, rx: number, ry: number, rz: number): void {
    q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), rx * DEG);
    if (ry) q.multiply(this.axisQuat(new THREE.Vector3(0, 1, 0), ry * DEG));
    if (rz) q.multiply(this.axisQuat(new THREE.Vector3(0, 0, 1), rz * DEG));
  }

  private axisQuat(axis: THREE.Vector3, rad: number): THREE.Quaternion {
    return new THREE.Quaternion().setFromAxisAngle(axis, rad);
  }
}
