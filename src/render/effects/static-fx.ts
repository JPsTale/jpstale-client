/**
 * **静态 `.smd` 模型** —— 特效系统此前缺的那条原子能力。
 *
 * ## 为什么需要它
 *
 * 原版 `SetAssaEffect(int MaxTime, char *FileName, smCHAR *pChar, POINT3D *pPosi,
 *                     int AddHeight = 0, int BlendType = 0)`
 * （`sinbaram/AssaEffect.h:492`）支持把**一个模型**当作特效 —— 祭司起手法阵的
 * `MAAM2.ASE` 就是（`sinSkillEffect.cpp` 的 `CharFlag == 2` 分支里与两张光环并列）。
 *
 * 而我们的粒子特效系统只能表达**粒子/广告牌**（`PartSystem` → quarks，见 §12）⇒
 * 法阵只能做出两张光环，中间的纹样做不出来。**这不是"缺资产"，是缺能力**：
 * 资产是齐的（`maam2.smd` 就在那儿）。
 *
 * ## 与角色/怪物模型的区别（本文件存在的理由）
 *
 * 角色/怪物模型靠两样东西驱动：`.inx`（选动作条目）+ `.smb`（骨架）。
 * **ASS 特效模型两者都没有** —— `image/sinimage/assaeffect/startmagic/` 下只有
 * `.smd` 和两张贴图。所以这里：顶点**直接铺开**（不做骨骼预乘）、UV 按面取（`texLinks`）、
 * 贴图按材质表（`materials[].texturePaths`）。
 *
 * ## "序列帧"问题的**更正**（2026-09-18，我先前写错过一版）
 *
 * 我先写过"`AniMaxCount = 20` / `InitMaxFrame(25)` 是**寿命**、网格是静态的" —— **错的** ✗。
 * 真相（`smObj3d.cpp` / `HoEffectView.cpp`）：帧号是**真的**，`HoEffectView::UpdateMesh:619`
 * `m_Pat->Frame = m_iCurrentFrame`，`smPAT3D::SetFrame` → `smOBJ3D::TmAnimation`：
 *   · 旋转用 `TmRotate`（这就是下面逐对象应用的矩阵）；
 *   · 位移用 `GetPosFrame(frame)`（`smObj3d.cpp:999`）—— **线性插值、值即平移**；
 *   · 另有 `tmRot` / `tmScale` 两类轨道（本模块暂未用）。
 * 判据是 `!TmFrameCnt && (TmRotCnt > 0 || TmPosCnt > 0 || TmScaleCnt > 0)`
 * ⇒ **有任一轨道就播**（我当初只看 `tmFrameCnt` 就下结论，于是漏掉了动画）。
 * 实现在 `StaticMeshTrack` / `applyStaticMeshTracks`，由调用方按帧推进。
 *
 * ## 同一份网格被放很多次：**资产只解析一次**（2026-09-21）
 *
 * Pike Wind 的环是 `15+level` 个 `HoEffectPat`（`HoEffect.cpp:6291`），每个都指向**同一个**
 * `bong.smd` —— 原版只 `smASE_Read` 一次（`HoEffect.cpp:3100-3109` 的 `PatObj[3]` 表），
 * 之后每个环片持有的是**引用**。我此前这里写的是裸 `fetch` + 裸 `parseSmb` ⇒ 一次施法真的
 * 下 25 次、解析 25 次（L10 实测）。现走 `AssetManager.loadParsedAsset`（同一 `(kind,url)`
 * 只解析一次；字节层是内存 → IndexedDB → 网络三级）。
 *
 * ⚠ 缓存的**只有解析结果**（`SmbData`，只读：本文件与 `getRotMatrixInto` 都只读它）：
 * 每个实例仍各建自己的 `Object3D` / 几何 / 材质 —— ①一个 `Object3D` 只能有一个父节点；
 * ②材质要逐实例改 `opacity`（淡出包络），共享会把多个实例的淡出搅在一起。
 */

import * as THREE from 'three';
import { parseSmb } from '../../core/char-parser.js';
import { loadParsedAsset } from '../../core/asset-manager.js';
import { normalizeTexturePath } from './part-assets.js';
import { fetchAndDecodeTexture } from '../char-texture-loader.js';
import { FONE } from '../../core/geom.js';
import { reportFallback } from '../../char/fallback-log.js';
import { getRotMatrixInto, toYupRowInto , quatToMatrixRowInto} from '../../char/animation.js';
import type { Obj3D, SmbData } from '../../char/char-format.js';

export interface StaticModelResult {
  group: THREE.Group;
  /** 实际用到的贴图路径（诊断用） */
  textures: string[];
  /** 原版声明了序列帧、但本实现只能静态渲染时为 false */
  animated: boolean;
  /**
   * **逐帧位移动画**（原版 `smOBJ3D::TmAnimation` 的 `GetPosFrame`）—— 每个对象一条轨道。
   *
   * 关键帧的 `frame` 是**动画单位**（160/帧，与 `.inx` 同制式），值就是矩阵平移行
   * （`GetPosFrame` 线性插值、**无除法**）。实测 `pt_4-1-25.smd`：12 块冰从远处/高处
   * （frame 0）扫到最终位置（frame 320~1120）并保持到 4000 —— 这就是"召唤出一簇簇冰块"。
   * 调用方按"当前帧"（= `InitMaxFrame` 对应的帧数 × 160）调 `applyStaticMeshTracks`。
   */
  tracks?: StaticMeshTrack[];
  dispose(): void;
}

/** 一个对象的逐帧轨道（`group` 会被逐帧设 position / scale） */
export interface StaticMeshTrack {
  /** 该轨道的"轴向非 1"告警是否已上报过（**每轨道一次**，否则每帧都报 ⇒ 刷屏） */
  axisWarned?: boolean;
  /** "旋转段表不可用、已改为按 key 插值"是否已上报过（同上一项的理由：每轨道一次） */
  segWarned?: boolean;
  /** 这份网格的上轴约定（见 `loadStaticSmd` 的 `upAxis`；`'y'` = 旋转不做 Z-up→Y-up 共轭） */
  upAxis?: 'z' | 'y';
  group: THREE.Object3D;
  /** 该对象的解析结果（`Obj3D`）——**逐帧旋转轨道**（`tmRot`）从它求，见 `applyStaticMeshTracks` */
  obj: Obj3D;
  /** 位移关键帧（原版 `GetPosFrame`）：帧号 160/帧，值即 PT 空间平移 */
  keys: Array<{ frame: number; x: number; y: number; z: number }>;
  /** 缩放关键帧（原版 `GetScaleFrame`）：如法阵 `maam2` 的 z 从 1 → 9（张开），20 帧 */
  scaleKeys?: Array<{ frame: number; x: number; y: number; z: number }>;
}

/**
 * 按 `frame`（动画单位）推进轨道 —— **逐行照抄** `smOBJ3D::GetPosFrame` / `GetScaleFrame`
 * （`smObj3d.cpp:999` / `:1031`）：线性插值、值直接用、帧号早于首个关键帧则**不改**。
 *
 * 坐标系：位移走 `toYup`（含 PT→three 的轴映射）；缩放只是**轴序置换**（PT 的 z↔three 的 y、
 * PT 的 y↔three 的 −z ⇒ 缩放的负号无所谓 ⇒ `set(sx, sz, sy)`）—— 法阵的 `tmScale.z` = PT 的"上"，
 * 在 three 里落在 y 轴 ✓。
 */
/** 逐帧旋转的暂存（单线程串行调用 ⇒ 模块级复用） */
const ROT_A: number[] = new Array(16).fill(0);
const ROT_OUT: number[] = new Array(16).fill(0);
const ROT_M4 = new THREE.Matrix4();
const ROT_P = new THREE.Vector3();
const ROT_Q = new THREE.Quaternion();
const ROT_S = new THREE.Vector3();
/** 段表不可用那条路用的 slerp 端点（three 的 Quaternion，自带最短路径处理） */
const SEG_QA = new THREE.Quaternion();
const SEG_QB = new THREE.Quaternion();

export function applyStaticMeshTracks(tracks: StaticMeshTrack[], frame: number): void {
  for (const t of tracks) {
    // ① **旋转**：原版每帧 `TmAnimation` → `GetRotFrame`（有旋转轨道时）或绑定姿态 `TmRotate`。
    //    复用 `char/animation.js` 的 `getRotMatrixInto`（含"段查找 + 绑定姿态回退"的既有教训），
    //    再按角色动画同一套 `toYupRowInto` 转 Y-up、`fromArray`+`decompose` 落地 —— 与
    //    `char/animation.js:calcBone/applyToBones` 完全一致（AGENTS #15：不写第二份）。
    // ⚠ **段表可能坏掉**：有些 ASE 导出的 `.smd` 把 `tmRotFrame` 留成未初始化填充（`0xCDCDCDCD`；
    //   实测 `effect/objanimationdata/pikewind/bong.smd`）⇒ `getTmFrameRot` 永远 <0
    //   ⇒ 走 `getRotMatrixInto` 只会**每帧回退绑定姿态** ⇒ 动画"不转"；更隐蔽的是那条路还会乘上按
    //   **坏表**推导的 `tmPrevRot` ⇒ 纯 Z 的 yaw 被搅成**绕斜轴的翻滚**（实测轴从 `(-0.83,0.40,0.40)`
    //   跳到 `(-1,0,0)`）⇒ 视觉上"整圈不在一个平面、歪斜"（用户 2026-09-21 的截图正是如此）。
    //   ⇒ 表不可用时**自己按关键帧直接 slerp**（原版读的是 `.ase`：按帧平铺、无段表、无 PrevRot）。
    //   判据：整张表里**没有一个**合法段区间。
    const segs = t.obj.tmRotFrame ?? [];
    const segsOk = segs.some((g) => (g?.startFrame ?? -1) >= 0 && (g?.endFrame ?? -1) >= (g?.startFrame ?? 0));
    const rotKeys = t.obj.tmRot ?? [];
    if (!segsOk && rotKeys.length > 0) {
      if (!t.segWarned) {
        t.segWarned = true;
        // 只报一次：资产问题（我们靠关键帧直插兜住），必须可见但不必每帧刷屏
        reportFallback('fx', `静态网格「${t.obj.nodeName ?? '?'}」的旋转段表不可用（未初始化填充）⇒ `
          + '改为**直接对关键帧 slerp**（原版读的是 .ase，那份没有段表/PrevRot）');
      }
      // key 的 `frame` 与调用方给的 frame 同制式（160 单位/帧）
      let i = 0;
      while (i + 1 < rotKeys.length && rotKeys[i + 1]!.frame <= frame) i++;
      const a = rotKeys[i]!, b = rotKeys[Math.min(i + 1, rotKeys.length - 1)]!;
      const span = b.frame - a.frame;
      const alpha = span > 0 ? Math.max(0, Math.min(1, (frame - a.frame) / span)) : 0;
      SEG_QA.set(a.x, a.y, a.z, a.w);
      SEG_QB.set(b.x, b.y, b.z, b.w);
      SEG_QA.slerp(SEG_QB, alpha);
      quatToMatrixRowInto(SEG_QA.x, SEG_QA.y, SEG_QA.z, SEG_QA.w, ROT_A);
    } else {
      getRotMatrixInto(t.obj, frame, ROT_A, ROT_OUT);
    }
    // 两路汇到同一段：源空间（行主序）→ three 的 Y-up → 分解出四元数
    // 轴向换算：`'z'`（默认）走 Z-up→Y-up 共轭；`'y'` 的资产本来就是 Y-up ⇒ 不转
    if ((t.upAxis ?? 'z') === 'y') ROT_OUT.splice(0, 16, ...ROT_A);
    else toYupRowInto(ROT_A, ROT_OUT, ROT_A.slice());
    ROT_M4.fromArray(ROT_OUT);
    ROT_M4.decompose(ROT_P, ROT_Q, ROT_S);
    t.group.quaternion.copy(ROT_Q);

    const k = t.keys;
    if (k.length && k[0]!.frame <= frame) {
      let i = 0;
      while (i + 1 < k.length && !(k[i]!.frame <= frame && k[i + 1]!.frame > frame)) i++;
      const a = k[i]!, b = k[Math.min(i + 1, k.length - 1)]!;
      const alpha = b.frame > a.frame ? (frame - a.frame) / (b.frame - a.frame) : 0;
      // ⚠ **这里到底该不该 ÷FONE，我没有证据，不要再猜**（2026-09-21）：
      //   我按"位移键是定点数"除了一次，用户实测："**旋风被挤到一起了**" ⇒ 那刀是错的，已回退。
      //   两份来源互相矛盾、且都只是间接证据：
      //   · `ChainLance` 的 `pPosi->y += 3000` 我们按 ÷256 = 11.7 单位渲染（用户看过那一段"正常"）；
      //   · 而 `ReadASE_GEOMOBJECT` 是 `x=(int)(atof(文本)*fONE)` ⇒ ASE 的文本数是世界单位、
      //     引擎存成定点 ⇒ 若 `.smd` 是它的定点化，则 ÷256 恢复世界单位；但那样刀光只有 0.15 单位
      //     （远小于可见尺寸）⇒ 与"转换器直接把数值写进 .smd"的读法冲突。
      //   ⇒ **结论：这族 .smd 的数值单位尚未取证**。要定它只能靠"与原版尺寸对照"（用户的眼睛）
      //     或找到 `.smd` 的写方（转换器）。在此之前**保持不除**（= 用户判定"大小很像原版"的那一版）。
      const [px, py, pz] = toAxis(
        a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, a.z + (b.z - a.z) * alpha,
        t.upAxis ?? 'z',
      );
      // ⚠ 位移**随父节点的朝向一起转**是对的（源码 `SetPosi(pos,Angle)`：Angle 参与朝向）
      //   —— 我一度把它"转回世界轴"，实测更糟（半径离散度 0% → 103%），已撤回。
      t.group.position.set(px, py, pz);
    }
    const sc = t.scaleKeys;
    if (sc && sc.length && sc[0]!.frame <= frame) {
      let i = 0;
      while (i + 1 < sc.length && !(sc[i]!.frame <= frame && sc[i + 1]!.frame > frame)) i++;
      const a = sc[i]!, b = sc[Math.min(i + 1, sc.length - 1)]!;
      const alpha = b.frame > a.frame ? (frame - a.frame) / (b.frame - a.frame) : 0;
      const sx = a.x + (b.x - a.x) * alpha;
      const sy = a.y + (b.y - a.y) * alpha;
      const sz = a.z + (b.z - a.z) * alpha;
      // **轴序置换**：PT(x,y,z) → three(x,z,y)（缩放只换轴、负号无所谓）。
      //
      // ⚠ 这里我改错过一次（写成"径向放大" ✗）：当时看到 `maam2` 是"躺平的圆盘、厚度仅 1 单位"，
      //   就以为"在 z 上增长 = 变厚、看不出"，于是把增长挪到圆盘平面。**用户实测纠正**：
      //   原版是"**沿 y 轴向上**、法阵向上发光"。回头对数据 —— `maam2` 的顶点在 PT z 上只占
      //   **0..1**（贴地薄片），缩放 ×9 = **从地面向上长出一根光柱** ✓ —— 数据与用户描述一致，
      //   是我把"厚度"当成实心饼，没想到"贴地薄片 ×N = 竖起来发光"。
      t.group.scale.set(sx, sz, sy);
      // 增长不在 z 上时（别的资产）本读法未必适用 —— 必须可见（AGENTS #12）
      // ⚠ 缩放按 **PT 的 z（= three 的 y）** 解释（轴序置换）；x/y 非 1 的资产本读法未必适用 ——
      //   这是**读法说明**，不是"缺功能"，故**不再上报**（用户 2026-09-18：它是噪报）。

    }
  }
}

/** 顶点坐标：引擎 Z-up → three 的 Y-up（与 `skinned-builder` 的 `transformVertex` 同式） */
const toYup = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];
/** 顶点的轴向换算：`'z'` = PT 的 Z-up（→ three 的 Y-up）；`'y'` = 资产本来就是 Y-up，**原样用** */
const toAxis = (x: number, y: number, z: number, axis: 'z' | 'y'): [number, number, number] =>
  (axis === 'y' ? [x, y, z] : toYup(x, y, z));

/**
 * 加载一个**静态** `.smd` 模型（无骨架、无 `.inx`）。
 *
 * @param smdPath 资产相对路径（如 `image\sinimage\assaeffect\startmagic\maam2.smd`）
 * @param opts.scale 整体缩放（原版 `SetAssaEffect` 的尺寸由资产自身决定，这里留个口子）
 */
export async function loadStaticSmd(
  smdPath: string,
  opts: {
    scale?: number;
    /**
     * 这份网格的**上轴约定**（默认 `'z'` = 与角色/法阵同族的 PT 约定）。
     *
     * ⚠ 它**不是**全局常量：`Effect/ObjAnimationData/PikeWind/bong.smd`（Pike Wind 的环）按 **Y-up**
     *   解释才与"水平风环"相符 —— 同一个面片：按 Z-up 看与水平面成 **65°**（渲染出来就是"歪斜的碗"，
     *   用户 2026-09-21 实测截图），按 Y-up 看是 **26°**（接近平铺）。而法阵 `maam2` 明确是 Z-up
     *   （顶点 `z` 全 0、法线 `+Z`，我们渲染平铺正确）。**两个资产不同约定** ⇒ 只能逐资产标。
     *   判据可复算：面片法线与上轴的夹角 —— 哪种解释更接近"该特效应有的姿态"（这里是水平环）就用哪种。
     */
    upAxis?: 'z' | 'y';
  } = {},
): Promise<StaticModelResult | null> {
  const upAxis = opts.upAxis ?? 'z';
  const p = normalizeTexturePath(smdPath);
  // **取字节 + 解析都走 AssetManager**（见文件头"同一份网格被放很多次"）：同一 `(kind,url)`
  // 只解析一次 —— Pike Wind 的 25 个环片于是只下一次、只解析一次（原版也是"读一次、多个引用"）。
  // ⚠ URL 必须带 `/res/` 前缀：`cachedFetch` **不做**路径改写（它只小写 + 编码），而资产的唯一
  //   前缀就是 `/res/`（开发期由 Vite 插件 `devAssets` 拦截，见 AGENTS"资产访问机制"）。
  //   漏掉前缀**不会报错**：实测 dev server 把 index.html 当 SPA 回退送回来（`200` + `text/html`）
  //   ⇒ `parseSmb` 读的是 HTML ⇒ 网格一个都起不来（法阵/冰簇/环全受影响）。
  const url = '/res/' + p;
  let smd: SmbData;
  try {
    smd = await loadParsedAsset(url, 'model', (buf) => {
      const s = parseSmb(buf);
      // ⚠ **逐对象建网格**那段是按 `smd.objects` 循环的 —— 文件若不兼容/畸形，读出的对象数可能是
      //   天文数字 ⇒ 循环把主线程钉死（无日志、无报错，表现为"卡住"）。这里**先报数、再设上限**：
      //   超限就抛 ⇒ 调用方拿到 null（AGENTS #12：宁可显式失败，也不静默卡死），
      //   且 `loadParsedAsset` 不会把失败留在缓存里（见它的 catch：失败条目会被删掉）。
      if (!s.objects || s.objects.length > 512) {
        throw new Error(`对象数异常（${s.objects?.length} 个）⇒ 放弃该网格（不冒卡死的风险）`);
      }
      // **只有真的解析了才打印**（缓存命中不打印）—— 这行就是"资产只加载一次"的可核验证据
      console.log(`[static-fx] 解析 ${p}：对象 ${s.objects.length} 个`
        + '（首次；之后同一 URL 复用 AssetManager 的解析缓存）');
      return s;
    });
  } catch (e) {
    // 失败与原因都上报（原先是 `if (!res.ok) return null` —— 404 与"对象数异常"在下游同形）
    reportFallback('fx', `静态网格 ${p} 加载失败：${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  const mats = smd.materials ?? [];

  // 贴图：按材质表逐张解码（同一张只解一次）
  const texCache = new Map<string, THREE.DataTexture | null>();
  const usedTextures: string[] = [];
  const loadTex = async (raw: string): Promise<THREE.DataTexture | null> => {
    const key = normalizeTexturePath(raw);
    if (texCache.has(key)) return texCache.get(key)!;
    const t = await fetchAndDecodeTexture('/res/' + key);
    texCache.set(key, t);
    usedTextures.push(key);
    return t;
  };

  const root = new THREE.Group();
  root.name = 'static-fx:' + p;
  /** 逐帧位移轨道（收集后交给调用方推进，见 `StaticModelResult.tracks`） */
  const tracks: StaticMeshTrack[] = [];

  for (const obj of smd.objects) {
    // 每个对象一个 Group：**旋转**烘进几何（静态），**位移**逐帧写进 Group.position
    //（= 原版 `qmat` 的用法：`TmRotate` 做旋转、`GetPosFrame` 写 `_41.._43` 做平移）
    const objGroup = new THREE.Group();
    objGroup.name = obj.nodeName || 'obj';
    root.add(objGroup);
    // 逐帧位移关键帧（`tmPos`）—— `frame` 是动画单位（160/帧），值就是 PT 空间平移
    const keys = ((obj as unknown as { tmPos?: Array<{ frame: number; x: number; y: number; z: number }> }).tmPos ?? [])
      .map((k) => ({ frame: k.frame, x: k.x, y: k.y, z: k.z }));
    const scaleKeys = ((obj as unknown as { tmScale?: Array<{ frame: number; x: number; y: number; z: number }> }).tmScale ?? [])
      .map((k) => ({ frame: k.frame, x: k.x, y: k.y, z: k.z }));
    // **对象自带的变换** —— 多块拼成的网格全靠它摆位。
    // ⚠ 此前这里只用裸顶点 ⇒ 所有对象叠在原点：`pt_4-1-25.smd` 是 12 块自成一体的尖刺
    //   （名字叫 `Box01/Box11…Box21`），于是"冰块都在一个位置"（用户实测）。
    //   角色模型没露过这个问题，是因为它们靠**骨骼绑定矩阵**摆位。
    //
    // 实测（2026-09-18，逐对象打印）：
    //   · `posi` / `angle` 全 0、`tmFrameCnt` = 0 ⇒ 静态网格、无关键帧；
    //   · **`tmRotate` 是有效旋转**（`{m:[16]}`，3×3 以 256 定标 + 末位 256）⇒ **各块朝向不同**；
    //   · `tm` 里含平移，但那份数值的定标（÷256 还是 ÷256²）**我无法从数据判定** ⇒ **只应用旋转**，
    //     平移留空（否则会凭猜测把整簇挪到几百单位外）。
    //   `mWorld` / `tmResult` / `mLocal` 全是未初始化噪声（绑定流程没跑），不可用。
    const op = obj.posi ?? { x: 0, y: 0, z: 0 };
    // **何时应用 `tmRotate`** —— 照引擎 `smOBJ3D::TmAnimation`（`smObj3d.cpp:1482` 的条件）：
    // ```
    // if ((!TmFrameCnt && (TmRotCnt>0 || TmPosCnt>0 || TmScaleCnt>0)) ||
    //     ( TmFrameCnt && (NumTmRot>=0 || NumTmPos>=0 || NumTmScale>0))) { … TmRotate 作基础旋转 … }
    // else TmResult = 单位阵;
    // ```
    // ⇒ **完全没有轨道时用单位阵（裸顶点），不应用 `TmRotate`**。r[B7-13] 实测：翅膀
    // （`wing*.smd`，各计数 0）被我无条件应用 tmRotate ⇒ 朝向错（用户："y 轴颠倒"）；
    // 而冰簇（`pt_4-1-25.smd`，TmPosCnt>0）走有轨道分支 ⇒ `tmRotate` **应当**应用。
    const trackCount = (obj as unknown as {
      tmRotCnt?: number; tmPosCnt?: number; tmScaleCnt?: number; tmFrameCnt?: number;
    });
    const hasTracks = (trackCount.tmFrameCnt ?? 0) !== 0
      || (trackCount.tmRotCnt ?? 0) > 0 || (trackCount.tmPosCnt ?? 0) > 0 || (trackCount.tmScaleCnt ?? 0) > 0;
    // ⚠ **旋转不再烘进顶点**：`tmRotate` 只是"绑定姿态"，而原版每帧取的是
    // **旋转轨道** `tmRot`（`smOBJ3D::TmAnimation` → `GetRotFrame`）——烘焙绑定姿态会让
    // 有旋转轨道的网格停在绑定姿势（r[B7-16] 实测：刺客之眼的同心圆本该立起来，却平躺）。
    // 现在：顶点只做 Z-up→Y-up；旋转由 `applyStaticMeshTracks` 每帧写到 `objGroup.quaternion`
    // （复用 `char/animation.js` 的 `getRotMatrixInto` —— 与角色动画同一份实现）。
    const put = (vx: number, vy: number, vz: number): [number, number, number] => {
      if (!hasTracks) return toAxis(vx, vy, vz, upAxis);          // 无轨道：裸顶点（单位阵）
      return toAxis(vx + op.x / FONE, vy + op.y / FONE, vz + op.z / FONE, upAxis);
    };
    // 顶点按**面**展开（UV 是逐面的，同 `buildSkinnedMesh` 的做法）
    let tri = 0;
    // 逐材质分组：一个 obj 的面可能引用不同材质
    const byMat = new Map<number, { pos: number[]; uv: number[]; idx: number[] }>();
    for (const f of obj.faces) {
      const mi = f.v[3];
      const key = (mi >= 0 && mi < mats.length) ? mi : -1;
      let bucket = byMat.get(key);
      if (!bucket) { bucket = { pos: [], uv: [], idx: [] }; byMat.set(key, bucket); }
      // 面 → texLink（UV 三顶点）
      let tl = null;
      if (obj.texLinkPtr && f.lpTexLink) {
        const tlIdx = (f.lpTexLink - obj.texLinkPtr) / 32;
        if (tlIdx >= 0 && tlIdx < obj.texLinks.length) tl = obj.texLinks[tlIdx];
      }
      for (let k = 0; k < 3; k++) {
        const v = obj.vertices[f.v[k]];
        if (!v) continue;
        const [x, y, z] = put(v.x, v.y, v.z);
        bucket.pos.push(x, y, z);
        bucket.uv.push(tl ? tl.u[k]! : 0, tl ? 1.0 - tl.v[k]! : 0);
      }
      bucket.idx.push(tri * 3, tri * 3 + 1, tri * 3 + 2);
      tri++;
    }
    for (const [matIdx, g] of byMat) {
      if (g.pos.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setIndex(g.idx);
      geo.computeVertexNormals();

      const matData = matIdx >= 0 ? mats[matIdx] : undefined;
      const tex = matData?.texturePaths?.[0] ? await loadTex(matData.texturePaths[0]) : null;
      const mat = new THREE.MeshPhongMaterial({
        map: tex ?? null,
        // 原版 ASS 特效一律 `SMMAT_BLEND_LAMP`（加色发光）
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        color: tex ? 0xffffff : 0x8899aa,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      objGroup.add(mesh);
    }
    // 有位移轨道的对象登记轨道；初值取第 0 帧（原版起始就在远处，随后逐帧扫进来）
    // **任何轨道**（rot / pos / scale）都要建轨道：只按 `tmPos/tmScale` 建的话，
    // "只有旋转轨道"的网格（如刺客之眼的 31 个 `tmRot` 键）永远不会被逐帧推进 ⇒ 停在绑定姿态
    const rotKeys = ((obj as unknown as { tmRot?: unknown[] }).tmRot ?? []).length;
    if (keys.length >= 1 || scaleKeys.length >= 1 || rotKeys >= 1) {
      const track: StaticMeshTrack = { group: objGroup, obj: obj as unknown as Obj3D, keys, scaleKeys };
      track.upAxis = upAxis;
    tracks.push(track);
      applyStaticMeshTracks([track], 0);   // 初值 = 第 0 帧
    }
  }

  if (opts.scale && opts.scale !== 1) root.scale.setScalar(opts.scale);
  // ⚠ 这里**不再每实例打印**（原先是 `[static-fx] p 完成：对象 N 个…`）—— 它对同一资产恒为同值，
  //   25 个环片就是 25 行重复；"加载了一次"的证据在解析那行（上面），实例化的证据由调用方打印
  //   （如 `cast-circle-runner` 的 `🧊 ASE 网格 …`）。
  return {
    group: root,
    textures: usedTextures,
    // 有逐帧位移轨道 ⇒ 调用方按帧推进（`applyStaticMeshTracks`）；网格本身仍是静态几何
    animated: tracks.length > 0,
    tracks,

    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      // ⚠ **贴图不在这里 dispose**：它们是 `fetchAndDecodeTexture` 从 `AssetManager` 取来的
      //   **共享 DataTexture**（`char-texture-loader` 写明"调用方只读，不要 dispose"）。
      //   原先这里逐实例释放 ⇒ Pike Wind 一次施法把同一张贴图 dispose 25 次，而它仍被别的实例
      //   （甚至别处）引用 ⇒ 每次渲染再重新上传 —— 正是"重复加载"的另一半，性质是
      //   **共享可变状态被单方释放**。生命周期归 AssetManager 的 LRU（字节预算 / 条目上限）。
    },
  };
}
