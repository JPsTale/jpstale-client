/**
 * fore-1 单图加载与帧动画更新。
 * 迁移自 maps/index.html loadMap 的地图渲染部分(资产 /res + getMatConfig + build + 帧动画)。
 * 资产走 vite devAssets /res → E:\JPsTale\client。
 */
import * as THREE from 'three';
import { parseSMD } from '../core/smd-parser';
import { loadGameTexture } from '../render/texture-loader';
import { MapRenderer, type MatConfig } from '../render/map-renderer';

const SMD_PATH = '/res/field/forest/fore-1.smd';

export interface Fore1Map {
  mapRenderer: MapRenderer;
  /** 帧动画材质对应的 mesh(每帧按 RendStatTime 切 map) */
  animatedMeshes: THREE.Mesh[];
  /** 供调试/跳转 */
  data: ReturnType<typeof parseSMD>;
}

function assetUrl(raw: string): string {
  return '/res/' + raw.replace(/\\/g, '/').toLowerCase();
}

export async function loadFore1(scene: THREE.Scene): Promise<Fore1Map> {
  const r = await fetch(SMD_PATH);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + SMD_PATH);
  const buf = await r.arrayBuffer();
  const data = parseSMD(buf);

  // 收集纹理 URL(跳过不可见材质 useState & 0x0400)
  const texUrls = new Map<number, string>();
  const lmTexUrls = new Map<number, string>();
  const animTexUrls = new Map<number, string[]>();
  for (let i = 0; i < data.materials.length; i++) {
    const mat = data.materials[i];
    if (mat.useState & 0x0400) continue;
    if (mat.tex.length > 0) texUrls.set(i, assetUrl(mat.tex[0]));
    if (mat.tex.length > 1) lmTexUrls.set(i, assetUrl(mat.tex[1]));
    if (mat.animTexCounter > 0 && mat.animTextures.length > 0) {
      animTexUrls.set(i, mat.animTextures.map(assetUrl));
    }
  }
  const allUrls = [...new Set([...texUrls.values(), ...lmTexUrls.values(), ...[...animTexUrls.values()].flat()])];
  const texMap = new Map<string, THREE.Texture>();
  await Promise.all(allUrls.map(async (url) => {
    const tex = await loadGameTexture(url);
    if (tex) texMap.set(url, tex);
  }));

  const mr = new MapRenderer(scene);
  mr.build(data, texMap, (matIdx, mat): MatConfig | null => {
    if (mat && (mat.useState & 0x0400)) return null;
    const hasTex = texUrls.has(matIdx);
    if (!hasTex && !(mat && mat.animTexCounter > 0)) return null;

    const hasTex1 = lmTexUrls.has(matIdx);
    const fso1 = mat && mat.textureFormState ? mat.textureFormState[1] : 0;
    const isLM = hasTex1 && fso1 === 0;
    const isSecondTex = hasTex1 && fso1 !== 0;

    const diffuseTex = hasTex ? (texMap.get(texUrls.get(matIdx)! ) || null) : null;
    const tex1Url = hasTex1 ? lmTexUrls.get(matIdx) : null;
    const lightmapTex = isLM ? (texMap.get(tex1Url! ) || null) : null;
    const secondTex = isSecondTex ? (texMap.get(tex1Url! ) || null) : null;

    const hasAlphaBlend = mat.blendType === 1;
    const hasMapOpacity = !!(diffuseTex && diffuseTex.userData && diffuseTex.userData.hasAlpha);
    const blendNeedsTransparent = mat.blendType !== 0;
    const isTransparent =
      (hasAlphaBlend && (hasMapOpacity || mat.transparency > 0)) ||
      (blendNeedsTransparent && mat.blendType !== 1 && mat.blendType !== 0);
    const isRendLatter = mat && (mat.meshState & 0x2000) !== 0;

    return {
      hasTex, hasLM: isLM, diffuseTex, lightmapTex,
      hasSecondTex: isSecondTex, secondTex,
      twoSide: !!mat.twoSide,
      isTransparent, isRendLatter,
      blendType: mat ? mat.blendType : 0,
      hasAnimation: mat.animTexCounter > 0,
    };
  });

  // 帧动画 mesh 绑定
  const animatedMeshes: THREE.Mesh[] = [];
  for (const mrd of mr.materials) {
    const animUrls = animTexUrls.get(mrd.matIdx);
    if (animUrls && animUrls.length > 0) {
      const frames = animUrls.map((u) => texMap.get(u)).filter((t): t is THREE.Texture => !!t);
      if (frames.length > 0) {
        mrd.mesh.userData.animFrames = frames;
        mrd.mesh.userData.animMask = frames.length - 1;
        mrd.mesh.userData.animShift = 6;
        animatedMeshes.push(mrd.mesh);
      }
    }
  }

  return { mapRenderer: mr, animatedMeshes, data };
}

/** 每帧帧动画: frameIdx = (time_ms >> Shift_FrameSpeed) & FrameMask(默认 64ms/帧) */
export function updateFrameAnimations(animatedMeshes: THREE.Mesh[], animMs: number): void {
  for (const m of animatedMeshes) {
    const u = m.userData;
    const frames = u.animFrames as THREE.Texture[] | undefined;
    if (!frames || frames.length < 2) continue;
    const mask = u.animMask !== undefined ? (u.animMask as number) : frames.length - 1;
    const shift = u.animShift !== undefined ? (u.animShift as number) : 6;
    const idx = (animMs >> shift) & mask;
    if (idx !== u.animIdx) {
      u.animIdx = idx;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map = frames[idx % frames.length];
      mat.needsUpdate = true;
    }
  }
}
