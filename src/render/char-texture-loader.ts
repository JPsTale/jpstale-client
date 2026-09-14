/**
 * 角色/武器纹理加载。
 *
 * 与地图纹理（render/texture-loader.ts）语义不同，故独立成模块：
 * 地图 flipY=false（解码器 top-down 对齐 GL 首行），角色 flipY=true（复刻 CharSelect/WorldView）。
 * 复刻自 WorldView 的同名实现；此前 WorldView / CharSelect / 资产检查器
 * 各有（或曾各有）一份拷贝，现统一到这里，避免"改了一处漏了另一处"。
 */
import * as THREE from 'three';
import { decodeTextureAsync } from '../core/texture';
import { loadParsedAsset } from '../core/asset-manager.js';

/** 待绑定纹理：{ url, mat } —— mat 来自 .inx/.smd 解析结果 */
export interface TextureTarget {
  url: string;
  mat: THREE.MeshPhongMaterial;
}

export interface TextureLoadResult {
  /** 成功绑定数 */
  loaded: number;
  /** 解析/下载失败的资源路径（相对 /res，已小写） */
  failed: string[];
}

/** 单张：解码 → DataTexture（失败返回 null，不抛） */
export async function fetchAndDecodeTexture(
  url: string,
  anisotropy = 1,
): Promise<THREE.DataTexture | null> {
  // 取字节 + 解码都交给 AssetManager：① 同一张贴图被多个材质用时只解码一次；
  // ② **纳入 LRU 的字节预算** —— 贴图像素是内存大头（实测：解析缓存 2.3MB 时 JS 堆已 525MB，
  // 也就是说大头一直在 AssetManager 管不到的地方）。
  // ⚠ 共享 DataTexture：调用方只读，**不要 dispose**（别处可能还在用同一份）。
  return loadParsedAsset(url, 'texture:char', async (buf) => {
    const decoded = await decodeTextureAsync(buf);
    if (!decoded) throw new Error('纹理解码失败: ' + url);   // 下面 catch 成 null（保持原签名）
    const tex = new THREE.DataTexture(
      new Uint8Array(decoded.pixels), decoded.width, decoded.height, THREE.RGBAFormat,
    );
    tex.flipY = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    if (anisotropy > 1) tex.anisotropy = anisotropy;
    tex.needsUpdate = true;
    return tex;
  }, true).catch(() => null);
}

/** 批量绑定到材质。失败的路径会返回，供检查器诊断面板高亮。 */
export async function loadCharTextures(
  targets: TextureTarget[],
  anisotropy = 1,
): Promise<TextureLoadResult> {
  let loaded = 0;
  const failed: string[] = [];
  await Promise.allSettled(targets.map(async (t) => {
    const texPath = t.url.replace(/\\/g, '/').toLowerCase();
    const tex = await fetchAndDecodeTexture('/res/' + texPath, anisotropy);
    if (!tex) { failed.push(texPath); return; }
    t.mat.map = tex;
    t.mat.color.set(0xffffff);
    t.mat.alphaTest = 0.5;
    t.mat.transparent = true;
    t.mat.needsUpdate = true;
    loaded++;
  }));
  return { loaded, failed };
}
