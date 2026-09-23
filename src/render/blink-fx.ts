/**
 * 锻造/合成呼吸发光（aging/craft blink）的**渲染层唯一实现**。
 *
 * 纯逻辑（哪一级用哪一行、波形、滚动量）在 `src/game/agingBlink.ts`；本文件只做"把那些数
 * 写进材质"。自机主手/副手、远端玩家主手/副手必须都走这里（AGENTS #15：同一判定不许有第二份）。
 *
 * 复刻的两件事（证据见 agingBlink.ts 文件头的四步链路）：
 *
 *   ① **呼吸光** —— 原版每帧把 `(bTime*R)>>9` 加进 `smRender.Color_R/G/B`，再被
 *      `AddLight()` 加到顶点光上 ⇒ 贴图被 `(光照 + 表色×波形)` 调制。
 *      three 里等价的写法是 `emissive = 表色×波形` + `emissiveMap = 贴图`：
 *      最终片元 = `贴图×光照 + 贴图×表色×波形`，与原版**逐项同构**。
 *      （⚠ 不用 `material.color` 做这件事：color 是"乘在光照之前"的，加到它上面等于把
 *       光的强弱也一起改了，与原版"加一份与光照无关的色"不是一回事。）
 *
 *   ② **第二通道叠加贴图**（`TexMixCode >= 0` 才有）—— 原版是 D3D 的第二纹理级
 *      `COLOROP_ADD`（贴图 + 上一级结果），UV 用同一套坐标 + 按 `TexScroll` 横向滚动。
 *      这里用"与网格共几何、同父节点、加色混合、不写深度"的第二层网格实现：变换、可见性、
 *      刺客匕首那种镜像克隆全部自动跟随（克隆发生在挂载时，晚于本文件的建立）。
 *
 * ⚠ 偏移写在 **texture.offset**（不是材质 uniform）⇒ 同一张贴图被两把武器共用时会互相踩；
 *   故贴图按 `(TexMixCode, TexScroll)` 缓存**私有副本**（≤ 12 份，每份 64×64，可忽略）。
 */
import * as THREE from 'three';
import { fetchAndDecodeTexture } from './char-texture-loader.js';
import { reportFallback } from '../char/fallback-log.js';
import { blinkWave, mixOverlayTexture, overlayScrollU, MIX_TEXTURE_DIR, type BlinkRow } from '../game/agingBlink.js';

interface OverlayTexEntry {
  tex: THREE.DataTexture | null;
  loading: Promise<THREE.DataTexture | null> | null;
}

/** `(TexMixCode, TexScroll)` → 私有贴图副本（偏移写在这份上，故不能共用解码缓存那一份） */
const overlayTexCache = new Map<string, OverlayTexEntry>();

function overlayTextureOf(code: number, scroll: number, anisotropy: number): Promise<THREE.DataTexture | null> {
  const key = `${code}:${scroll}`;
  let entry = overlayTexCache.get(key);
  if (!entry) {
    entry = { tex: null, loading: null };
    overlayTexCache.set(key, entry);
  }
  if (entry.tex) return Promise.resolve(entry.tex);
  if (!entry.loading) {
    const self = entry;
    const loading = (async (): Promise<THREE.DataTexture | null> => {
      const file = mixOverlayTexture(code);
      if (!file) {
        reportFallback('blink', `第二通道：TexMixCode=${code} 无对应贴图（表只定义 0..9）⇒ 该件只有呼吸光`);
        return null;
      }
      const rel = MIX_TEXTURE_DIR + file;
      const base = await fetchAndDecodeTexture('/res/' + rel, anisotropy);
      if (!base) {
        reportFallback('blink', `第二通道贴图缺失：${rel}（原版该级别应有叠加贴图）⇒ 该件只有呼吸光`);
        return null;
      }
      // 复制一份（共享解码缓存的 DataTexture 只读，别动它的 offset/wrap）
      const img = base.image as { data: Uint8Array<ArrayBuffer>; width: number; height: number };
      const tex = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat);
      tex.flipY = base.flipY;
      tex.colorSpace = base.colorSpace;
      tex.generateMipmaps = base.generateMipmaps;
      tex.minFilter = base.minFilter;
      tex.magFilter = base.magFilter;
      tex.anisotropy = base.anisotropy;
      tex.wrapS = THREE.RepeatWrapping;   // 原版两通道都是 wrap 采样（UV 越界即平铺）
      tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
      self.tex = tex;
      return tex;
    })();
    self.loading = loading;
    return loading;
  }
  return entry.loading;
}

/** 把滚动量写进贴图偏移（同 (贴图,模式) 的多件武器算出的是同一个值，重复写无害） */
function applyScroll(tex: THREE.DataTexture, scrollMode: number, nowMs: number): void {
  const u = overlayScrollU(scrollMode, nowMs);
  if (u !== null && tex.offset.x !== u) tex.offset.x = u;
}

/**
 * 一件武器（或盾）上的呼吸发光。生命周期与"那件挂载物"一致：
 * 建立于挂载前（这样镜像克隆会带上叠加层），在换下/丢弃时 `dispose()`。
 */
export class BlinkFx {
  private readonly sourceMats: THREE.MeshPhongMaterial[] = [];
  private readonly overlayMats: THREE.MeshBasicMaterial[] = [];
  private readonly overlayMeshes: THREE.Mesh[] = [];
  private row: BlinkRow | null = null;
  /** 当前叠加通道的键（'' = 无叠加层）；换键才去动贴图 */
  private overlayKey = '';
  private overlayScrollMode = 0;
  private seq = 0;
  private disposed = false;
  private lastNowMs = 0;

  private constructor(
    private readonly group: THREE.Group,
    private readonly anisotropy: number,
  ) {}

  /**
   * 给一个武器/盾牌组建立发光效果。`row = null`（未锻造/未合成）时只建对象不发光 ——
   * 之后仍可用 `setRow()` 点亮（锻造等级是在游戏里涨的）。
   */
  static create(group: THREE.Group | null, row: BlinkRow | null, anisotropy = 1): BlinkFx | null {
    if (!group) return null;
    const fx = new BlinkFx(group, anisotropy);
    fx.collect();
    fx.setRow(row);
    return fx;
  }

  /** 收集网格材质，并为每个网格挂一层"第二通道"叠加网格（默认不可见） */
  private collect(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
      const mat = mesh.material as THREE.Material;
      if (!(mat instanceof THREE.MeshPhongMaterial)) return;
      if (this.sourceMats.includes(mat)) return;
      this.sourceMats.push(mat);
      // 叠加网格挂在**原网格自己**下面：变换/可见性/镜像克隆都自动跟随，不用拷矩阵
      const ovMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,     // 与原网格共面：不写深度、靠 depthTest(LEQUAL) 通过
        side: mat.side,        // 单/双面跟随原材质（叠加层不该反过来只显示一面）
        visible: false,        // 有叠加贴图才开（材质级开关 ⇒ 镜像克隆共享同一份材质也一起开关）
      });
      const ov = new THREE.Mesh(mesh.geometry, ovMat);
      ov.name = (mesh.name || 'weapon_part') + '__blink';
      mesh.add(ov);
      this.overlayMats.push(ovMat);
      this.overlayMeshes.push(ov);
    });
  }

  /** 换发光行（装备变化 / 锻造升级 / 合成完成时调）。传 null = 熄掉。 */
  setRow(row: BlinkRow | null): void {
    if (this.disposed) return;
    this.row = row;
    if (!row) {
      for (const m of this.sourceMats) m.emissive.setRGB(0, 0, 0);
      this.overlayKey = '';
      this.seq++;                    // 作废在途的贴图加载
      this.setOverlayTexture(null, 0);
      return;
    }
    this.applyOverlay(row);
  }

  private applyOverlay(row: BlinkRow): void {
    const key = row.texMixCode >= 0 ? `${row.texMixCode}:${row.texScroll}` : '';
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    const seq = ++this.seq;
    if (!key) {
      this.setOverlayTexture(null, 0);
      return;
    }
    if (overlayScrollU(row.texScroll, 0) === null) {
      // 表里没出现过的滚动模式（NONE/FORMX…/REFLEX/SCROLLSLOW*）：如实上报，别假装成 0
      reportFallback('blink', `TexScroll=${row.texScroll}（非 SCROLL2..10）未实现 ⇒ 该件只有呼吸光、没有叠加贴图`);
      this.setOverlayTexture(null, 0);
      return;
    }
    void overlayTextureOf(row.texMixCode, row.texScroll, this.anisotropy).then((tex) => {
      if (this.disposed || seq !== this.seq) return;   // 过期加载（期间又换了行）
      this.setOverlayTexture(tex, row.texScroll);
    });
  }

  private setOverlayTexture(tex: THREE.DataTexture | null, scrollMode: number): void {
    this.overlayScrollMode = scrollMode;
    for (const m of this.overlayMats) {
      m.map = tex;
      m.visible = !!tex;
      m.needsUpdate = true;          // map 从 null 变有 ⇒ 需要重编译着色器
    }
    if (tex) applyScroll(tex, scrollMode, this.lastNowMs);
  }

  /** 每帧调用一次（原版逐帧跑 SetRenderBlinkColor）。`nowMs` 用世界内单调时钟。 */
  update(nowMs: number): void {
    if (this.disposed) return;
    this.lastNowMs = nowMs;
    const row = this.row;
    if (!row) return;
    const k = blinkWave(nowMs) / 255;              // 表色 0..255 → 材质色 0..511/512
    for (const m of this.sourceMats) {
      if (!m.emissiveMap && m.map) {
        m.emissiveMap = m.map;                     // 发光跟着贴图走（与原版"色乘贴图"一致）
        m.needsUpdate = true;
      }
      m.emissive.setRGB(row.r * k, row.g * k, row.b * k);
    }
    for (const m of this.overlayMats) {
      if (m.map) applyScroll(m.map as THREE.DataTexture, this.overlayScrollMode, nowMs);
    }
  }

  /** 卸下/丢弃时调：熄掉发光、摘掉叠加层、销毁自己造的材质（贴图是共享缓存，**不动**）。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const m of this.sourceMats) m.emissive.setRGB(0, 0, 0);
    for (const mesh of this.overlayMeshes) mesh.parent?.remove(mesh);
    for (const m of this.overlayMats) m.dispose();
    this.overlayMeshes.length = 0;
    this.overlayMats.length = 0;
    this.sourceMats.length = 0;
  }
}
