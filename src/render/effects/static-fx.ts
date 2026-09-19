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
 */

import * as THREE from 'three';
import { parseSmb } from '../../core/char-parser.js';
import { normalizeTexturePath } from './part-assets.js';
import { fetchAndDecodeTexture } from '../char-texture-loader.js';
import { getMoveLocation, FONE } from '../../core/geom.js';
import { reportFallback } from '../../char/fallback-log.js';

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
  group: THREE.Object3D;
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
export function applyStaticMeshTracks(tracks: StaticMeshTrack[], frame: number): void {
  for (const t of tracks) {
    const k = t.keys;
    if (k.length && k[0]!.frame <= frame) {
      let i = 0;
      while (i + 1 < k.length && !(k[i]!.frame <= frame && k[i + 1]!.frame > frame)) i++;
      const a = k[i]!, b = k[Math.min(i + 1, k.length - 1)]!;
      const alpha = b.frame > a.frame ? (frame - a.frame) / (b.frame - a.frame) : 0;
      const [px, py, pz] = toYup(
        a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, a.z + (b.z - a.z) * alpha,
      );
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

/**
 * 加载一个**静态** `.smd` 模型（无骨架、无 `.inx`）。
 *
 * @param smdPath 资产相对路径（如 `image\sinimage\assaeffect\startmagic\maam2.smd`）
 * @param opts.scale 整体缩放（原版 `SetAssaEffect` 的尺寸由资产自身决定，这里留个口子）
 */
export async function loadStaticSmd(
  smdPath: string,
  opts: { scale?: number } = {},
): Promise<StaticModelResult | null> {
  const p = normalizeTexturePath(smdPath);
  const res = await fetch('/res/' + p);
  if (!res.ok) return null;
  const smd = parseSmb(await res.arrayBuffer());
  // ⚠ **逐对象建网格**这段是按 `smd.objects` 循环的 —— 文件若不兼容/畸形，读出的对象数可能是
  //   天文数字 ⇒ 循环把主线程钉死（无日志、无报错，表现为"卡住"）。这里**先报数、再设上限**：
  //   超限就上报并放弃（AGENTS #12：宁可显式失败，也不静默卡死）。
  if (!smd.objects || smd.objects.length > 512) {
    console.log(`[static-fx] 对象数异常（${smd.objects?.length}）⇒ 放弃该网格（不冒卡死的风险）`);
    reportFallback('fx', `静态网格 ${p} 的对象数异常（${smd.objects?.length} 个）⇒ 放弃加载`
      + '（防"畸形文件把主线程钉死"；见 static-fx.loadStaticSmd 的守卫）');
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

  let objIdx = 0;
  for (const obj of smd.objects) {
    objIdx++;
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
    const oa = obj.angle ?? { x: 0, y: 0, z: 0 };
    const tm = (obj.tmRotate as unknown as { m?: number[] } | undefined)?.m;
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
    const rot = hasTracks && tm && tm.length === 16
      ? new THREE.Matrix4().fromArray(tm.map((v) => v / 256))
      : null;
    const put = (vx: number, vy: number, vz: number): [number, number, number] => {
      if (!hasTracks) return toYup(vx, vy, vz);          // 无轨道：裸顶点（单位阵）
      const r = getMoveLocation(vx, vy, vz, oa.x, oa.y, oa.z);
      // 对象自身的旋转（`tmRotate`，PT 空间里先转，再统一 Z-up → Y-up）
      const v = rot ? new THREE.Vector3(r.x, r.y, r.z).applyMatrix4(rot) : r;
      return toYup(v.x + op.x / FONE, v.y + op.y / FONE, v.z + op.z / FONE);
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
    if (keys.length >= 1 || scaleKeys.length >= 1) {
      const track: StaticMeshTrack = { group: objGroup, keys, scaleKeys };
      tracks.push(track);
      applyStaticMeshTracks([track], 0);   // 初值 = 第 0 帧
    }
  }

  if (opts.scale && opts.scale !== 1) root.scale.setScalar(opts.scale);
  console.log(`[static-fx] ${p} 完成：对象 ${objIdx} 个、轨道 ${tracks.length} 条、贴图 ${usedTextures.length} 张`);
  return {
    group: root,
    textures: usedTextures,
    // 有逐帧位移轨道 ⇒ 调用方按帧推进（`applyStaticMeshTracks`）；网格本身仍是静态几何
    animated: tracks.length > 0,
    tracks,
    // eslint-disable-next-line no-console

    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      for (const t of texCache.values()) t?.dispose();
    },
  };
}
