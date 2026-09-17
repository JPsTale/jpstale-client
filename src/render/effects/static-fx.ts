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
 * ## "序列帧"问题**已结案**（2026-09-18）
 *
 * 此前这里记着："原版对 `MAAM2.ASE` 还设了 `AniMaxCount = 20` / `AniDelayTime = 4`（序列帧），
 * 静态 `.smd` 只有一帧数据，表达不了那 20 帧；**尚未查明**。"
 *
 * 现查源码结案（`HoBaram/NewEffect/HoEffectController.cpp:183,207`）：
 *   `InitMaxFrame(frame)` → `m_iMaxFrame = int(frame * 160)`；
 *   `Main` 里 `m_fCurrentFrame += 160*30*elapsedTime`（**30fps**），到点就把 `m_fCurrentFrame` 归零、
 *   `m_iLoopCount++`，而 `InitLoop(1)` 时**直接置为不活跃**。
 * ⇒ 那个"帧数"是**寿命**（帧 @30fps），**不是网格动画**。网格始终是静态的，
 *   看得见的"动"来自 `EventFadeColor` 的**秒级** alpha 包络。
 * ⇒ 故本模块"按静态模型渲染"是**对的**；调用方自己给"寿命 + alpha 包络"即可
 *   （见 `glacial-spike.ts` 的 `MESH_LIFE_SEC`/`MESH_FADE`、`cast-circle-runner.ts` 的包络）。
 */

import * as THREE from 'three';
import { parseSmb } from '../../core/char-parser.js';
import { normalizeTexturePath } from './part-assets.js';
import { fetchAndDecodeTexture } from '../char-texture-loader.js';

export interface StaticModelResult {
  group: THREE.Group;
  /** 实际用到的贴图路径（诊断用） */
  textures: string[];
  /** 原版声明了序列帧、但本实现只能静态渲染时为 false */
  animated: boolean;
  dispose(): void;
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

  for (const obj of smd.objects) {
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
        const [x, y, z] = toYup(v.x, v.y, v.z);
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
      root.add(mesh);
    }
  }

  if (opts.scale && opts.scale !== 1) root.scale.setScalar(opts.scale);
  return {
    group: root,
    textures: usedTextures,
    animated: false,
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      for (const t of texCache.values()) t?.dispose();
    },
  };
}
