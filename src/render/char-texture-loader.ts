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
/**
 * @param opts.linear 遮罩烘焙路径（亮度烘 alpha）——与原样路径一样**打 SRGBColorSpace**
 *   （2026-09-19 裁定 B，见下）。
 *
 * 颜色管线（2026-09-19 裁定 B，取代 2026-09-16 的"特效两侧都不转换"旧方案）：
 *   · 旧判断"quarks 片元着色器不做输出编码"**已被证伪**：`particle_physics_frag.glsl.ts:162`
 *     含 `#include <colorspace_fragment>`（three.quarks 当前版），输出端会按 renderer 的
 *     outputColorSpace 做 sRGB 编码 ⇒ 旧方案（贴图 NoColorSpace 不解码 + 输出编码）
 *     实为**单端编码**，低 alpha 雾被凭空提亮 ~3.9 倍（0.086→0.33）——
 *     lab 实测：particlemeteo1_blue 渲染成可见灰色方块（应为黑心蓝环）。
 *   · 裁定 B（协调者 2026-09-19）：贴图**统一打 SRGBColorSpace**——采样端 sRGB→线性解码、
 *     输出端线性→sRGB 编码，rgb 一来一回 ≈ 美术原样；加法混合改在线性空间进行
 *     （低 alpha 亮雾仍比原版 8bit 直算亮 ~3 倍——线性/γ 空间乘法的固有差异，已接受）。
 *     alpha 通道不做解码（规范如此），按线性直用。
 *   · 遮罩烘焙（亮度烘 alpha）仍在 **sRGB 8bit 数据上**进行（烘焙在解码前，与本裁定无冲突）。
 */
export async function fetchAndDecodeTexture(
  url: string,
  anisotropy = 1,
  opts: { linear?: boolean } = {},
): Promise<THREE.DataTexture | null> {
  // 取字节 + 解码都交给 AssetManager：① 同一张贴图被多个材质用时只解码一次；
  // ② **纳入 LRU 的字节预算** —— 贴图像素是内存大头（实测：解析缓存 2.3MB 时 JS 堆已 525MB，
  // 也就是说大头一直在 AssetManager 管不到的地方）。
  // ⚠ 共享 DataTexture：调用方只读，**不要 dispose**（别处可能还在用同一份）。
  return loadParsedAsset(url, 'texture:char', async (buf) => {
    const decoded = await decodeTextureAsync(buf);
    if (!decoded) throw new Error('纹理解码失败: ' + url);   // 下面 catch 成 null（保持原签名）
    // **特效贴图：把"亮度"烘进 alpha**（`opts.linear` = 特效那条路）—— 遮罩来自**贴图本身**，
    // 与粒子颜色无关 ⇒ 任意色相都能出光（蓝/青/紫都不会被抠掉），且没有阈值、没有方框。
    // ⚠ 烘的条件：**没有 alpha 通道**（多为 24 位 BMP）**或 alpha 通道退化（恒为不透明）**。
    //   后一条是 2026-09-18 实测补的：`m_spark06.tga`（MultiSpark 的爆闪）**有** alpha 通道
    //   但 min=max=mean=255（68.7% 像素是黑底）、alpha 与亮度平均差 214 ⇒ 遮罩等于不存在，
    //   加色混合下整块矩形都参与 ⇒ 用户实测"爆闪是一大片方形"。
    //   ⇒ 判据改为"**alpha 通道能不能当遮罩用**"，不能就烘亮度（真遮罩的 TGA 不动）。
    let alphaUseful = decoded.hasAlpha === true;
    if (opts.linear && alphaUseful) {
      const px = decoded.pixels;
      let allOpaque = true;
      for (let i = 3; i < px.length; i += 4) if (px[i]! !== 255) { allOpaque = false; break; }
      alphaUseful = !allOpaque;
    }
    if (opts.linear && !alphaUseful) {
      const px = decoded.pixels;
      for (let i = 0; i < px.length; i += 4) {
        // Rec.601 亮度（0.299/0.587/0.114），整数近似避免逐像素浮点
        px[i + 3] = (px[i]! * 77 + px[i + 1]! * 150 + px[i + 2]! * 29) >> 8;
      }
    }
    const tex = new THREE.DataTexture(
      new Uint8Array(decoded.pixels), decoded.width, decoded.height, THREE.RGBAFormat,
    );
    tex.flipY = true;
    // 特效贴图按线性（见函数头的说明）；角色/地图仍 sRGB
    tex.colorSpace = THREE.SRGBColorSpace;                     // 裁定 B：特效/角色统一 sRGB 管线
    // 与地图纹理（texture-loader）同一滤波策略：mipmap 线性，避免降采样"马赛克/颗粒"
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
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
