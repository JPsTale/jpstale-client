/**
 * 怪物模型加载器 — 单模型（一格网格组 + 共享骨骼/动画 .smb）通用加载
 *
 * 依据 C++/pviewer 已验证路径（monster 与 npc 同构，区别于玩家 body+head 两段式）：
 *  - .inx 给出 modelFile(.smd 网格)、motionFile(.smb 骨骼+动画)、可选 szLinkFile(共享动画模板)
 *  - 动画条目可能在本 inx 或 link inx 中（CHRMOTION_EXT 起），配合 animSmb.tmFrame 帧偏移
 *  - 所有资源路径统一小写（Linux 大小写敏感）
 *
 * 复用既有底层：parseInx/parseSmb + buildSkeleton/buildSkinnedMesh（rawMode=false）。
 * 返回的纹理通过 caller 的 loadTextures 加载（与玩家远端一致）。
 */

import { parseInx, parseSmb } from '../core/char-parser.js';
import { cachedFetch } from '../core/asset-cache.js';
import { buildSkeleton, buildSkinnedMesh } from './skinned-builder.js';
import type { InxData, MotionInfo, SmbData } from '../char/char-format.js';
import { CHRMOTION_EXT } from '../char/char-format.js';
import type * as THREE from 'three';

async function fetchAB(url: string): Promise<ArrayBuffer> {
  return cachedFetch(url);
}

/** 归一化资源 basename：反斜杠→斜杠、小写、去扩展名 */
function lowerBase(raw: string): string {
  const mf = raw.replace(/\\/g, '/').toLowerCase();
  const slash = mf.lastIndexOf('/');
  const name = mf.substring(slash + 1).replace(/\.[^.]+$/, '');
  const dir = slash >= 0 ? mf.substring(0, slash) : '';
  return dir ? dir + '/' + name : name;
}

/** 逐一尝试候选 basename + .smd，返回第一个解析成功的网格数据 */
async function loadMesh(baseCandidates: string[]): Promise<SmbData | null> {
  for (const base of baseCandidates) {
    try {
      const buf = await fetchAB('/res/' + base + '.smd');
      if (buf.byteLength > 0) return parseSmb(buf);
    } catch {
      // next candidate
    }
  }
  return null;
}

/** 逐一尝试候选 basename + .smb，返回第一个解析成功的骨骼/动画数据 */
async function loadAnim(baseCandidates: string[]): Promise<SmbData | null> {
  for (const base of baseCandidates) {
    try {
      const buf = await fetchAB('/res/' + base + '.smb');
      if (buf.byteLength > 0) return parseSmb(buf);
    } catch {
      // next candidate
    }
  }
  return null;
}

/** 解析一个 .inx（可能 .in 实际为 .inx 文件，两种路径都试） */
async function loadInxWithFallback(link: string): Promise<InxData | null> {
  const lc = link.replace(/\\/g, '/').toLowerCase();
  const candidates = [lc, lc.replace(/\.in$/, '.inx'), lc + '.inx'];
  for (const c of candidates) {
    try {
      const buf = await fetchAB('/res/' + c);
      if (buf.byteLength > 0) return parseInx(buf);
    } catch {
      // next candidate
    }
  }
  return null;
}

/** 由动画 .smb + 动画条目源 .inx 构建 MotionInfo[]（同玩家 buildMotionListFor 语义） */
function buildMotionList(animSmb: SmbData, inx: InxData): MotionInfo[] {
  const list: MotionInfo[] = [];
  const tmFrame = animSmb.tmFrame;
  for (let i = CHRMOTION_EXT; i < inx.motionCount; i++) {
    const mi = inx.motions[i];
    if (!mi.state && !mi.startFrame && !mi.endFrame) continue;
    let startFrame = mi.startFrame;
    let endFrame = mi.endFrame;
    if (tmFrame && mi.motionFrame > 0 && tmFrame[mi.motionFrame - 1]) {
      const off = tmFrame[mi.motionFrame - 1].startFrame / 160;
      startFrame += off;
      endFrame += off;
    }
    list.push({ ...mi, startFrame, endFrame });
  }
  return list;
}

export interface MonsterModelResult {
  inxPath: string;
  /** 实际加载到的网格 .smd basename */
  modelBase: string;
  /** 实际加载到的骨骼/动画 .smb basename */
  animBase: string;
  /** 动画条目的来源 .inx（自身或 link） */
  motionInx: InxData;
  animSmb: SmbData;
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  skeletonGroup: THREE.Group;
  group: THREE.Group;
  meshes: THREE.SkinnedMesh[];
  texturesToLoad: { url: string; mat: THREE.MeshPhongMaterial; nodeName: string }[];
  motionList: MotionInfo[];
}

/**
 * 加载单个怪物模型。
 * @param inxPath 资产相对路径（如 char/monster/monimp/monimp-a.inx）
 */
export async function loadMonsterModel(inxPath: string): Promise<MonsterModelResult> {
  const inxInfo = await parseInx(await fetchAB('/res/' + inxPath.replace(/\\/g, '/').toLowerCase()));
  if (!inxInfo.modelFile) throw new Error('monster .inx modelFile 为空: ' + inxPath);

  const modelBase = lowerBase(inxInfo.modelFile);
  const inxBase = inxPath.replace(/\.inx$/i, '').replace(/\\/g, '/').toLowerCase();
  const inxDir = inxBase.substring(0, inxBase.lastIndexOf('/') + 1);
  const modelName = modelBase.substring(modelBase.lastIndexOf('/') + 1);

  // LOD 网格名：高 → 中 → 低 → 全量
  const high = inxInfo.highModel.modelNames.filter(Boolean);
  const def = inxInfo.defaultModel.modelNames.filter(Boolean);
  const low = inxInfo.lowModel.modelNames.filter(Boolean);
  const meshNames = high.length > 0 ? high : def.length > 0 ? def : low.length > 0 ? low : null;

  // 网格 .smd：优先 modelFile 推断，回退 inx 同名 / inx 目录+model 名
  const mesh = await loadFirst([modelBase, inxBase, inxDir + modelName]);
  if (!mesh) throw new Error('monster .smd 加载失败: ' + inxPath);

  // 动画源：motionFile → linkFile(共享模板) → 同名 .smb
  let animBase: string | null = null;
  let motionInx: InxData = inxInfo;
  if (inxInfo.motionFile && inxInfo.motionFile.trim().length > 0) {
    animBase = lowerBase(inxInfo.motionFile);
  } else if (inxInfo.szLinkFile && inxInfo.szLinkFile.trim().length > 0) {
    const linkInx = await loadInxWithFallback(inxInfo.szLinkFile);
    if (linkInx) {
      if (linkInx.motionFile && linkInx.motionFile.trim().length > 0) {
        animBase = lowerBase(linkInx.motionFile);
      }
      if (linkInx.motionCount > inxInfo.motionCount) {
        motionInx = linkInx;
      }
    }
  }
  if (!animBase) animBase = modelBase;

  let animSmb: SmbData | null = null;
  const animCandidates = [animBase, animBase !== modelBase ? modelBase : ''].filter(Boolean) as string[];
  for (const base of animCandidates) {
    try {
      animSmb = parseSmb(await fetchAB('/res/' + base + '.smb'));
      if (animSmb) { animBase = base; break; }
    } catch {
      // next
    }
  }
  if (!animSmb) throw new Error('monster .smb 加载失败: ' + inxPath + ' base=' + animBase);

  const skel = buildSkeleton(animSmb, false);
  const built = buildSkinnedMesh(mesh, animSmb, meshNames, false, skel);

  return {
    inxPath,
    modelBase,
    animBase: animBase!,
    motionInx,
    animSmb,
    bones: skel.bones,
    skeleton: skel.skeleton,
    skeletonGroup: skel.skeletonGroup,
    group: built.group,
    meshes: built.meshes,
    texturesToLoad: built.texturesToLoad,
    motionList: buildMotionList(animSmb, motionInx),
  };
}
