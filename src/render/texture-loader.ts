/**
 * 地图纹理智造组：二级制 → THREE.DataTexture。
 * 迁移自 maps/index.html loadGameTexture。翻转、mipmap、colorSpace、alpha 语义复刻原引擎。
 */
import * as THREE from 'three';
import { decodeTextureAsync } from '../core/texture';

const cache = new Map<string, THREE.DataTexture>();

/** 资产 URL 是否为 TGA(bmp 永不 alpha,原引擎 MapOpacity 仅 TGA) */
function detectAlpha(url: string, decodedHasAlpha: boolean): boolean {
  if (/\.tga$/i.test(url)) return true;
  if (/\.bmp$/i.test(url)) return false;
  return !!decodedHasAlpha;
}

/** 加载并解码一个游戏纹理（resolve null 当缺失/解析失败） */
export async function loadGameTexture(url: string): Promise<THREE.DataTexture | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const decoded = await decodeTextureAsync(buf);
    if (!decoded) return null;

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
    tex.needsUpdate = true;
    tex.userData.hasAlpha = hasAlpha;
    cache.set(url, tex);
    return tex;
  } catch {
    return null;
  }
}
