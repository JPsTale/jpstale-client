/**
 * 远程攻击的投射物（弓/弩 → 一支箭；标枪 → 标枪本身）。**纯表现**：
 * 不参与命中/伤害判定 —— 服务端仍是唯一裁决者（伤害在事件帧由服务端结算），
 * 这里只补"看得见的那一支箭/那一把标枪"。
 *
 * ── 依据与"缺口"（用户 2026-09-16 提："原版弓箭/弩会飞出一支箭，标枪会飞出一把标枪，我们没有实现"）
 *   · **模型**：`weapons/arrow.smd`（贴图 `weapons\arrow.tga`）我方资产里就有；
 *     标枪用**武器自己的 dropitem 模型**（`itwt1xx.smd`，32 件标枪全部在盘上）。
 *     两者都是**刚体**（箭 20 顶点/24 面/无骨名），经 `loadSmdFromUrl` 的 Z-up→Y-up 转换
 *     （`(x,z,-y)`，武器/掉落物共用那一份）后各自的长轴是本地 **±Y** ——
 *     尖端轴**按类型固定**在 `TIP_AXIS` 里（箭 +Y、标枪 −Y），不做任何几何推断：
 *     头尾是资产既定事实，用户实测标枪照抄箭的轴会"头尾颠倒"，翻过来即可。
 *   · ⚠ **exm 里玩家箭矢的飞行代码是缺口**：`PatArrow = smASE_Read("weapons\\arrow.ase")` 只在
 *     `playmain.cpp` 里声明/加载/释放（三处），**全仓没有任何渲染点** —— 与 AGENTS 已记的
 *     "exm 反编译不完整（技能→特效调度器同样丢失）"同族。故下列参数**由我们定**（都写在这里，
 *     日后拿到证据只需要改这几行）：
 *       ① **飞行时长** = 该次攻击"释放 → 首个事件帧"的动画时长 ⇒ 箭**正好在命中帧到达**（自洽）；
 *          没有事件帧时退成"距离 ÷ 弹速"（`FALLBACK_SPEED`）。
 *       ② **起点** = 武器挂载骨的世界坐标（取 `WeaponMount` 那个组所在骨 ⇒ 自机/远端同一处取）；
 *          **终点** = 命中特效（白光）打的那个点 —— 目标**身体中部**，且**每帧跟踪**
 *          （目标会走动，定点飞行会落在它身后；时长不变，速度自适应）。
 *       ③ **标枪绕飞行轴自转**（掷出的枪会转），箭不自转。
 *   · 引擎里"贴一个 mesh 从 A 飞到 B"的现成机制在 exm 里是 `HoNewEffectMove`（怪物/技能用）；
 *     我们是另一套渲染栈，故只借它的**语义**（直线 + 到点即消失），不照抄它的 `skillCode` 分支。
 */
import * as THREE from 'three';
import { ANIM_UNITS_PER_SEC } from '../char/animation.js';
import { loadSmdFromUrl } from './weapon-loader.js';
import { loadCharTextures } from './char-texture-loader.js';
import { getWeaponTypeFromIdCode } from '../char/weapon-type.js';
import type { EffectManager } from './effects/effect-manager.js';
import { impShotSystem } from './effects/imp-shot.js';

/** 箭的模型（我方资产 `client/weapons/arrow.smd`，经 `/res/*` 资产通道取） */
export const ARROW_URL = '/res/weapons/arrow.smd';

/** 没有事件帧数据时的弹速（世界单位/秒）。有事件帧时不用它 —— 时长由动画给。 */
export const FALLBACK_SPEED = 900;
/** 飞行时长的上下限（秒）：太短看不见、太长像飘 */
export const MIN_FLIGHT_SEC = 0.10;
export const MAX_FLIGHT_SEC = 0.90;
/** 标枪自转角速度（弧度/秒） —— 我们的决定，见文件头 ③ */
export const JAVELIN_SPIN = Math.PI * 4;

export type ProjectileKind = 'arrow' | 'javelin' | 'magic';

export interface ProjectileChoice {
  kind: ProjectileKind;
  /** 模型 URL（arrow 固定；javelin = 该武器自己的 dropitem 模型；magic 不用模型） */
  url?: string;
}

/**
 * **射出什么** = 由武器 idcode 决定（唯一实现，自机/远端/将来怪物共用）。
 *
 *   · `BOW` / `CROSSBOW` → 一支箭（`weapons/arrow.smd`）—— 两种武器共用同一支箭（用户描述一致）；
 *   · `JAVELIN` → 标枪本身（该武器的 dropitem 模型；**没有模型码 → 返回 null**，见下）；
 *   · 其余（近战/法杖/拳套…）→ null（不射任何东西）。
 *
 * ⚠ 返回 null 的两种含义不同，调用方用 `isRangedWeapon()` 区分：
 *   "本来就不射"（近战）vs "该射但没有模型"（标枪缺模型码，例如私服新增、OpenItem 里没有的那些）。
 *   后者必须**上报**（AGENTS #12：降级要可见），绝不能拿箭的模型去顶替一把标枪（那是编数据）。
 */
/**
 * 该职业此刻**是否以施法方式进行普通攻击**（用户 2026-09-16 定调："法师、祭司的攻击
 * 应该是空手+法杖类武器"；萨满先前那条只提"图腾"，空手未提，故不擅自扩 —— 要加只改这一行）。
 *
 * ⚠ 类别用 **`getWeaponTypeFromIdCode`**：它就是 `gamedb.itemlist.category` 的那套分类
 * （`Wands → 'STAFF'`、`Phantom → 'PHANTOM'`），**并且自带 idcode 前缀兜底**（表外新道具）——
 * 一份实现，别再手写第二遍（用户 2026-09-16 提醒："weapon-type 还不够用吗？"）。
 * ⚠ 更别用同表的 `attackClass`：它是派生列、覆盖不全（私服法杖查不到 ⇒ 静默不射，
 * 正是"用法杖攻击没看到法球"的根因）。
 */
function castsMagicAttack(idcode: number, type: string | null, jobId: number | null | undefined): boolean {
  if (jobId === 7 || jobId === 8) return !idcode || type === 'STAFF';   // 空手 或 法杖（物品表 category=Wands）
  if (jobId === 10) return type === 'PHANTOM';                          // 图腾（category=Phantom）
  return false;
}

export function projectileChoiceOf(
  idcode: number, dorpItem?: string | null, jobId?: number | null,
): ProjectileChoice | null {
  const type = getWeaponTypeFromIdCode(idcode);
  // ① 魔法职业的普通攻击 = 施法（法师/祭司空手或法杖类；萨满图腾）
  if (castsMagicAttack(idcode, type, jobId)) return { kind: 'magic' };
  // ② 远程武器：弓/弩 → 箭（共用一支）；标枪 → 标枪本身。与职业无关（谁能拿由服务端职业门管）
  if (type === 'BOW' || type === 'CROSSBOW') return { kind: 'arrow', url: ARROW_URL };
  if (type === 'JAVELIN' && dorpItem) {
    return { kind: 'javelin', url: '/res/image/sinimage/items/dropitem/it' + dorpItem.toLowerCase() + '.smd' };
  }
  return null;
}

/** 会放法术弹的职业：法师 7 / 祭司 8 + 萨满 10（11 职业版的图腾，我方补） */
export const MAGIC_JOBS = new Set([7, 8, 10]);

/** 该武器**本该**射出投射物吗（弓/弩/标枪）—— 用来区分"不射"与"该射却没模型" */
export function isRangedWeapon(idcode: number): boolean {
  const type = getWeaponTypeFromIdCode(idcode);
  return type === 'BOW' || type === 'CROSSBOW' || type === 'JAVELIN';
}

export interface ProjectileSpec {
  /** 起点（武器骨的世界坐标） */
  from: THREE.Vector3;
  /** 终点（**命中特效的锚点**：目标身体中部，见 `unitBodyAnchorY`）；每帧会被 `track` 覆盖 */
  to: THREE.Vector3;
  /** 飞行时长（秒）。缺省/非正值 → 按 `FALLBACK_SPEED` 用距离算 */
  flightTime?: number;
  /**
   * 终点实时取值（每帧调；返回 null 表示"这次取不到，沿用上一次"）。
   *
   * 为什么必须追踪而不是"开火时定死"（用户 2026-09-16 实测"箭的目标位置与视觉不符"）：
   * 命中特效（白光 `NormalHit1`）落在目标**当时的**身体中部，而目标（怪）是会走动的 ——
   * 定点飞行会落在它身后，白光却打在身上 ⇒ 两边对不上。
   * 追踪时**时长不变**（仍等于"释放→事件帧"）⇒ 箭照样在命中那一刻到达，只是速度随距离自适应。
   */
  track?: () => THREE.Vector3 | null;
  /** 到达瞬间问"这一段是不是 miss"（结果来自与服务端攻击计划**同一份**数据源，见调用方） */
  missed?: () => boolean | null;
}

/**
 * 命中特效的锚点高度 = 目标**身体中部**（`root.position.y + topY * 0.5`）。
 *
 * ⚠ 与 `WorldView.spawnEffectOnUnit`（白光 `NormalHit1` 的落点）**必须是同一条规则**：
 * 箭要飞到"白光打在哪"，两处各算一份迟早会漂开（AGENTS #15）。故只在这里定义一次。
 */
export function unitBodyAnchorY(baseY: number, topY: number): number {
  return baseY + topY * 0.5;
}

/**
 * 放箭提前量（动画帧数，1 帧 = 160 子帧单位）—— **我方决定**。
 *
 * 依据：原版放箭就发生在 `EventFrame` 那一刻（`character.cpp:3586` 的 `if (!shootFlag &&
 * chrAttackTarget)` 位于事件帧条件之内），而"命中"是箭飞到之后的事；我们服务端的伤害与命中音效
 * 都在事件帧结算 ⇒ 若也在事件帧才放箭，箭就永远比命中晚。
 * 故取"事件帧**前** LEAD 帧放箭、飞行正好用掉这 LEAD 帧的时间"：
 *   · 箭不再在动画第 0 帧就飞出去（用户 2026-09-16 实测："抬手拉弓时箭就飞了"）；
 *   · 到达时刻仍等于事件帧（用户上一轮的要求："同一时刻飞到目标位置"）。
 * 取 6 帧（≈0.2s @30fps）：足够看清箭飞出去，又落在"弓拉满"那一下附近。改这里即可调整观感。
 */
export const RELEASE_LEAD_FRAMES = 6;

/**
 * 放箭时刻（秒，从动作起始算起）=（首个事件帧 − 提前量）÷ 动画速率。
 *
 * 事件帧很早（提前量比它还大）时夹到 0 ⇒ 那一刀立刻放箭，不会出现负时间。
 */
export function releaseDelaySec(eventFrame: number, rate: number, leadFrames = RELEASE_LEAD_FRAMES): number {
  const u = ANIM_UNITS_PER_SEC * (rate > 0 ? rate : 1);
  return Math.max(0, (eventFrame - leadFrames * 160) / u);
}

/** 飞行时长（秒）= 提前量那一段动画时间（于是箭在事件帧到达）。取不到事件帧时按弹速兜底。 */
export function releaseFlightTime(
  eventFrame: number | undefined, rate: number, leadFrames = RELEASE_LEAD_FRAMES,
): number | undefined {
  if (!eventFrame || eventFrame <= 0 || !(rate > 0)) return undefined;
  const u = ANIM_UNITS_PER_SEC * rate;
  // 事件帧比提前量还早时：提前量就是"到事件帧"的全部时间（放箭即飞，仍在事件帧到达）
  const lead = Math.min(leadFrames * 160, eventFrame);
  // ⚠ 别拿 `releaseDelaySec`（从**动作起点**算的延迟）当飞行时长 —— 两者起点不同，我写混过一次
  return flightDuration(0, lead / u);
}

/**
 * miss 时"飞过目标再飞多远"（世界单位）—— **我方决定**（原版玩家箭矢的这段代码是缺口，
 * 见文件头；怪物那套 `HoNewEffectTracker` 只是到点即爆）。
 * 取约 1.3 个角色高，够看清"擦肩而过"而不会飞出视野。
 */
export const MISS_PASS_THROUGH = 60;

/**
 * miss 之后的续飞段：**速度不变**，只延续长度与时长（用户 2026-09-16 明确：
 * "miss 时箭不能停在目标位置，而是按相同的速度再飞一段距离"）。
 */
export function missContinue(dist: number, dur: number): { length: number; duration: number } {
  const speed = dur > 0 ? dist / dur : FALLBACK_SPEED;
  return { length: MISS_PASS_THROUGH, duration: MISS_PASS_THROUGH / Math.max(1, speed) };
}

/**
 * 飞行时长（秒）—— 纯函数，便于回归（`npm run verify-projectile`）。
 *
 * 给出 `flightTime` 就用它（夹到 [MIN,MAX]）：调用方按"释放 → 首个事件帧"的动画时长算，
 * 于是箭**正好在命中帧到达**；没有事件帧数据时退成"距离 ÷ `FALLBACK_SPEED`"。
 */
export function flightDuration(distance: number, flightTime?: number): number {
  const clamp = (v: number) => Math.min(Math.max(v, MIN_FLIGHT_SEC), MAX_FLIGHT_SEC);
  if (flightTime && flightTime > 0) return clamp(flightTime);
  return clamp(distance / FALLBACK_SPEED);
}

export interface ProjectileManager {
  /** 放一支（模型异步加载；加载完成时若已过飞行时长就直接不显示） */
  spawn(choice: ProjectileChoice, spec: ProjectileSpec): void;
  /** 每帧推进（由 WorldView 主循环调用） */
  update(dt: number): void;
  /** 摘掉所有在飞的（切图/销毁世界） */
  dispose(): void;
  /** 当前在飞数量（诊断/自检用） */
  readonly count: number;
}

interface Live {
  kind: ProjectileKind;
  obj: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** 飞行方向（单位向量，用于朝向与自转轴）；追踪时每帧按 from→to 重算 */
  dir: THREE.Vector3;
  dur: number;
  t: number;
  spin: number;
  track?: () => THREE.Vector3 | null;
  missed?: () => boolean | null;
  /** 本段速度（世界单位/秒）—— miss 续飞要"同速"，故每帧记下 */
  speed: number;
  /** 已经为 miss 续飞过一次（续飞段不再续飞，避免一直飞下去） */
  extended: boolean;
  /** 法术弹的粒子"停止"句柄：到点即停，否则粒子会一直堆在命中点上（用户实测"残留"） */
  stop?: (() => void) | null;
}

/** 模型缓存：同一 URL 只加载一次（含贴图），之后每支 `clone()`（共享 geometry/material） */
const modelCache = new Map<string, Promise<{ group: THREE.Group }>>();

function loadModel(url: string): Promise<{ group: THREE.Group }> {
  let p = modelCache.get(url);
  if (!p) {
    p = (async () => {
      const m = await loadSmdFromUrl(url, url.split('/').pop() ?? 'projectile');
      // ⚠ 贴图必须在这里等 —— `loadSmdFromUrl` 只给出"要加载哪些贴图"，不加载。
      // 漏了这一步的表现是"箭是灰模"（材质是 0x8899aa 的默认色），而且不报错。
      await loadCharTextures(m.texturesToLoad);
      return { group: m.group };
    })().catch((e) => {
      modelCache.delete(url);   // 一次失败不毒化（与 asset-manager 的解析缓存同一约定）
      throw e;
    });
    modelCache.set(url, p);
  }
  return p;
}

/**
 * 模型"尖端"在本地的朝向（`loadSmdFromUrl` 的 Z-up→Y-up 转换**之后**）—— 按类型固定。
 *
 *   · `arrow`（`weapons/arrow.smd`）：尖端 = **+Y**（弓已实测手感正确）
 *   · `javelin`（武器自己的 dropitem 模型）：尖端 = **−Y**
 *     —— 用户 2026-09-16 实测"标枪飞出去时头尾颠倒"：原来照抄了箭的轴，翻过来即可。
 *     头尾是固定的，**不需要任何几何推断**；某件模型真的例外时改这一张表（或按模型细分）即可。
 *   · `magic` 不用模型（粒子），填默认值占位。
 */
const TIP_AXIS: Record<ProjectileKind, THREE.Vector3> = {
  arrow: new THREE.Vector3(0, 1, 0),
  javelin: new THREE.Vector3(0, -1, 0),
  magic: new THREE.Vector3(0, 1, 0),
};

/** 取该类型的尖端轴（回归用；避免测试去猜几何） */
export function tipAxisOf(kind: ProjectileKind): THREE.Vector3 {
  return TIP_AXIS[kind].clone();
}

export function createProjectileManager(scene: THREE.Scene, fx: EffectManager | null = null): ProjectileManager {
  const live: Live[] = [];
  const _q = new THREE.Quaternion();
  const _pos = new THREE.Vector3();
  const _dirTmp = new THREE.Vector3();

  /** 摆到"飞行进度 f"的位置与朝向 */
  function place(l: Live, f: number): void {
    // 追踪：终点取"目标此刻的锚点" ⇒ 方向随之重算（时长不变，故速度自适应）
    if (l.track) {
      const t = l.track();
      if (t) l.to.copy(t);
      _dirTmp.subVectors(l.to, l.from);
      if (_dirTmp.lengthSq() > 1e-6) l.dir.copy(_dirTmp.normalize());
    }
    _pos.lerpVectors(l.from, l.to, f);
    l.obj.position.copy(_pos);
    // 朝向：把**该类型模型的尖端轴**对准飞行方向（箭 +Y / 标枪 −Y，见 TIP_AXIS）；标枪再绕飞行轴自转
    l.obj.quaternion.setFromUnitVectors(TIP_AXIS[l.kind], l.dir);
    if (l.spin !== 0) {
      _q.setFromAxisAngle(l.dir, l.spin * l.t);
      l.obj.quaternion.premultiply(_q);
    }
  }

  return {
    get count() { return live.length; },

    spawn(choice, spec) {
      const dir = new THREE.Vector3().subVectors(spec.to, spec.from);
      const len = dir.length();
      if (!(len > 0.01)) return;   // 起点终点重合（贴着打）→ 没什么可飞的
      dir.divideScalar(len);
      const dur = flightDuration(len, spec.flightTime);
      const to = spec.to.clone();

      if (choice.kind === 'magic') {
        // 法术弹 = **一堆发光粒子挂在飞行节点上**（原版就是粒子系统，不是网格模型）：
        // 节点从手飞到目标，粒子跟着它生成 ⇒ 尾迹自然留在身后。
        // 节点的世界坐标由 `getWorldPosition` 自己更新（three 会 updateWorldMatrix），故不必入场景图。
        const node = new THREE.Object3D();
        node.position.copy(spec.from);
        // ⚠ 别静默吞异常（曾经 `.catch(() => {})` 把"特效管理器是 null / 贴图缺失"全吃掉了）
        if (!fx) {
          console.warn('[projectile] 法术弹没有特效管理器（fx=null）→ 只有飞行节点、没有粒子'
            + '（检查 createProjectileManager 是否在 createEffectManager 之后调用）');
        } else {
          void fx.spawnSystem(impShotSystem(), { pos: { x: 0, y: 0, z: 0 }, attach: node })
            .then((h) => {
              if (!h) { console.warn('[projectile] 法术弹粒子没挂上（spawnSystem 返回 null）'); return; }
              // 贴图是异步加载的：句柄可能比"创建"晚到 —— 那时弹可能**已经到点并被移除**，
              // 此时再没人会调 stop ⇒ 立刻停掉（否则粒子会堆在命中点上，就是用户看到的"残留"）
              const l = live.find((x) => x.obj === node);
              if (l) l.stop = h.stop;
              else { h.stop(); console.log('[projectile] 粒子加载完成时弹已到点 → 立即停止发射'); }
            })
            .catch((e) => { console.warn('[projectile] 法术弹粒子播放失败', e); });
        }
        live.push({
          kind: choice.kind, obj: node, from: spec.from.clone(), to, dir, dur, t: 0, spin: 0,
          track: spec.track, missed: spec.missed, speed: len / Math.max(dur, 1e-3), extended: false,
          stop: null,
        });
        return;
      }

      const url = choice.url;
      if (!url) return;
      void loadModel(url).then((m) => {
        const obj = m.group.clone();
        // 模型原点在"尾端"（箭：z=0 处 6 个顶点 = 尾羽），于是整支箭朝目标方向伸出、
        // 顺势从手里飞出去 —— 与"箭离开弓"的观感一致，故不做额外的原点偏移。
        scene.add(obj);
        const l: Live = {
          kind: choice.kind,
          obj,
          from: spec.from.clone(),
          to,
          dir,
          dur,
          t: 0,
          spin: choice.kind === 'javelin' ? JAVELIN_SPIN : 0,
          track: spec.track, missed: spec.missed, speed: len / Math.max(dur, 1e-3), extended: false,
        };
        place(l, 0);
        live.push(l);
      }).catch((err) => {
        // 资产缺失要看得见（AGENTS #12），但不要每箭一条 —— 同一条 URL 的失败由模型缓存去重
        console.warn('[projectile] 模型加载失败，本次不显示：' + url, err);
      });
    },

    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const l = live[i];
        l.t += dt;
        const f = l.dur > 0 ? Math.min(1, l.t / l.dur) : 1;
        place(l, f);
        // 本段速度（用于 miss 续飞"同速"）
        const seg = l.from.distanceTo(l.to);
        if (seg > 1e-3) l.speed = seg / Math.max(l.dur, 1e-3);
        if (l.t < l.dur) continue;

        // 到点：先问这一段是不是 miss（判定源与命中音效**同一份**服务端计划，见调用方）
        console.log('[projectile] 到达 kind=' + l.kind + ' 位置 ('
          + l.to.x.toFixed(1) + ',' + l.to.y.toFixed(1) + ',' + l.to.z.toFixed(1) + ')'
          + ' miss=' + (l.missed?.() === true));
        if (!l.extended && l.missed?.() === true) {
          const next = missContinue(seg, l.dur);
          l.from.copy(l.to);                                   // 从"目标处"接着飞
          l.to.copy(l.from).addScaledVector(l.dir, next.length); // 沿原方向、同速再飞一段
          l.dur = next.duration;
          l.t = 0;
          l.extended = true;
          l.track = undefined;      // 续飞段不再追踪目标（miss 就是"擦过去"）
          l.missed = undefined;
          place(l, 0);
          continue;
        }

        // 箭/标枪/法术弹：到点即消失 —— 命中表现（白光 `NormalHit1`、飘字、音效）由既有链路负责，
        // 这里**不重复播**（原版那颗弹另带 `MONSTER_IMP_HIT1` 的碎粒，我们暂不叠，避免两套特效打架）
        l.stop?.();     // 法术弹：立刻停止发射（否则粒子堆在命中点上，用户实测"残留"）
        scene.remove(l.obj);
        live.splice(i, 1);
      }
    },

    dispose() {
      for (const l of live) scene.remove(l.obj);
      live.length = 0;
    },
  };
}
