/**
 * 地图纹理智造组：二级制 → THREE.DataTexture。
 * 迁移自 maps/index.html loadGameTexture。翻转、mipmap、colorSpace、alpha 语义复刻原引擎。
 */
import * as THREE from 'three';
import { decodeTextureAsync } from '../core/texture';
import { loadParsedAsset } from '../core/asset-manager.js';

// 本模块原先自带一个 `Map<string, DataTexture>` 缓存 —— **已移除**：它没有上限（等于没有门槛），
// 而地图贴图恰是内存最大的一块。现在解码结果统一由 AssetManager 缓存并纳入 LRU 字节预算。

/** 各向异性过滤级数（renderer 创建后由 setMaxAnisotropy 注入；1=关闭）。 */
let maxAnisotropy = 1;

/** 设置各向异性过滤（renderer.capabilities.getMaxAnisotropy()）。 */
export function setMaxAnisotropy(v: number): void {
  if (Number.isFinite(v) && v > 1) maxAnisotropy = v;
}

/** 资产 URL 是否为 TGA(bmp 永不 alpha,原引擎 MapOpacity 仅 TGA) */
function detectAlpha(url: string, decodedHasAlpha: boolean): boolean {
  if (/\.tga$/i.test(url)) return true;
  if (/\.bmp$/i.test(url)) return false;
  return !!decodedHasAlpha;
}

/** 加载并解码一个游戏纹理（resolve null 当缺失/解析失败） */
export function loadGameTexture(url: string): Promise<THREE.DataTexture | null> {
  // 取字节 + 解码都交给 AssetManager：① 命中判定与 LRU 统一在这一层；
  // ② **纳入字节预算** —— 地图贴图是资产里最大的一块，实测 JS 堆里的大头就是这类像素数据，
  //    原来由本模块一个**无上限**的 Map 持有（等于没有任何门槛）。
  // 原先这里还裸 fetch（只靠浏览器 HTTP 缓存），刷新/换图都会重新下载 + 重新解码。
  // ⚠ 共享 DataTexture：调用方只读，**不要 dispose**（别处可能还在用同一份）。
  // ⚠ anisotropy 取自模块级 `maxAnisotropy`，所以缓存的结果会带"首次解码时"的级别 ——
  //   同一 renderer 下它恒定，可接受。
  return loadParsedAsset(url, 'texture:map', async (buf) => {
    const decoded = await decodeTextureAsync(buf);
    if (!decoded) throw new Error('纹理解码失败: ' + url);   // 下面 catch 成 null（保持原签名）

    const hasAlpha = detectAlpha(url, !!decoded.hasAlpha);
    const tex = new THREE.DataTexture(decoded.pixels as Uint8Array<ArrayBuffer>, decoded.width, decoded.height, THREE.RGBAFormat);
    // flipY=false: 解码器输出 top-down,GL v=0 首行 → 匹配原 dun-1 diffuse/lightmap 朝向
    tex.flipY = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAnisotropy;
    tex.needsUpdate = true;
    tex.userData.hasAlpha = hasAlpha;
    return tex;
  }, true).catch(() => null);
}
