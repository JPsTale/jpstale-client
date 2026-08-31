/**
 * PT 角色模型加载器
 *
 * 加载角色 body + head 两层网格，共享同一副骨骼。
 * 依据 C++ 源码：
 *  - character.cpp:smPATTERN::LoadCharactor — body .inx → model .smd
 *  - character.cpp:SetPattern — head Pattern2 共享骨骼
 *  - fileread.cpp:smModelDecode — linkFile 递归加载动画数据
 */

import * as THREE from 'three';
import { parseInx, parseSmb } from '../core/char-parser.js';
import { buildSkinnedMesh, buildSkeleton } from './skinned-builder.js';
import type { InxData, SmbData } from '../char/char-format.js';

// ===== 职业数据 =====

export interface JobData {
  bodyInx: string;
  headPrefix: string;
  headLetter: string;
  bipInx: string;
  bipSmb: string;
  gender: string;
  bipMeshPrefix: string;
}

export const JOB_DATA: Record<number, JobData> = {
  1: { bodyInx: 'char/tmabcd/b001.inx', headPrefix: 'tmh-b', headLetter: 'b', bipInx: 'char/tmabcd/m1bip.inx', bipSmb: 'm1.smb', gender: 'm', bipMeshPrefix: 'tmb' },
  2: { bodyInx: 'char/tmabcd/a001.inx', headPrefix: 'tmh-a', headLetter: 'a', bipInx: 'char/tmabcd/m1bip.inx', bipSmb: 'm1.smb', gender: 'm', bipMeshPrefix: 'tmb' },
  3: { bodyInx: 'char/tmabcd/d001.inx', headPrefix: 'tfh-d', headLetter: 'd', bipInx: 'char/tmabcd/m2bip.inx', bipSmb: 'm2.smb', gender: 'f', bipMeshPrefix: 'tfb' },
  4: { bodyInx: 'char/tmabcd/c001.inx', headPrefix: 'tmh-c', headLetter: 'c', bipInx: 'char/tmabcd/m4bip.inx', bipSmb: 'm4.smb', gender: 'm', bipMeshPrefix: 'tmb' },
  5: { bodyInx: 'char/tmabcd/mb001.inx', headPrefix: 'mfh-b', headLetter: 'b', bipInx: 'char/tmabcd/m2bip.inx', bipSmb: 'm2.smb', gender: 'f', bipMeshPrefix: 'mfb' },
  6: { bodyInx: 'char/tmabcd/ma001.inx', headPrefix: 'mmh-a', headLetter: 'a', bipInx: 'char/tmabcd/m1bip.inx', bipSmb: 'm1.smb', gender: 'm', bipMeshPrefix: 'mmb' },
  7: { bodyInx: 'char/tmabcd/md001.inx', headPrefix: 'mmh-d', headLetter: 'd', bipInx: 'char/tmabcd/m3bip.inx', bipSmb: 'm3.smb', gender: 'm', bipMeshPrefix: 'mmb' },
  8: { bodyInx: 'char/tmabcd/mc001.inx', headPrefix: 'mfh-c', headLetter: 'c', bipInx: 'char/tmabcd/m5bip.inx', bipSmb: 'm5.smb', gender: 'f', bipMeshPrefix: 'mfb' },
  9: { bodyInx: 'char/tmabcd/e001.inx', headPrefix: 'tfh-e', headLetter: 'e', bipInx: 'char/tmabcd/m6bip.inx', bipSmb: 'm6.smb', gender: 'f', bipMeshPrefix: 'tfb' },
  10: { bodyInx: 'char/tmabcd/me001.inx', headPrefix: 'mmh-e', headLetter: 'e', bipInx: 'char/tmabcd/m7bip.inx', bipSmb: 'm7.smb', gender: 'm', bipMeshPrefix: 'mmb' },
};

const TIER_SUFFIXES = ['', 'a', 'b', 'c'];

export function getHeadInxPath(jobId: number, faceNum: number, tier = 0): string | null {
  const job = JOB_DATA[jobId];
  if (!job) return null;
  const face = String(faceNum + 1).padStart(2, '0');
  const suffix = TIER_SUFFIXES[tier] || '';
  if (tier === 2) {
    const lastDash = job.headPrefix.lastIndexOf('-');
    if (lastDash >= 0) {
      const fixed = job.headPrefix.substring(0, lastDash) + '_' + job.headPrefix.substring(lastDash + 1);
      return `char/tmabcd/${fixed}${face}${suffix}.inx`;
    }
  }
  return `char/tmabcd/${job.headPrefix}${face}${suffix}.inx`;
}

export function getBodyInxPath(jobId: number, armorNum = 1): string | null {
  const job = JOB_DATA[jobId];
  if (!job) return null;
  const baseName = job.bodyInx.split('/').pop()!.replace(/\d+\.inx$/, '');
  const num = String(armorNum).padStart(3, '0');
  return `char/tmabcd/${baseName}${num}.inx`;
}

// ===== 加载 =====

async function fetchAB(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return (await resp.arrayBuffer()).slice(0);
}

function resolveModelBase(inxInfo: InxData): string | null {
  if (!inxInfo || !inxInfo.modelFile) return null;
  const mf = inxInfo.modelFile.replace(/\\/g, '/').toLowerCase();
  const slash = mf.lastIndexOf('/');
  const name = mf.substring(slash + 1).replace(/\.[^.]+$/, '');
  const dir = slash >= 0 ? mf.substring(0, slash) : '';
  return dir + '/' + name;
}

function resolveMotionBase(inxInfo: InxData): string | null {
  if (!inxInfo || !inxInfo.motionFile) return null;
  const mf = inxInfo.motionFile.replace(/\\/g, '/').toLowerCase();
  const slash = mf.lastIndexOf('/');
  const name = mf.substring(slash + 1).replace(/\.[^.]+$/, '');
  const dir = slash >= 0 ? mf.substring(0, slash) : '';
  return dir + '/' + name;
}

export interface CharLoadResult {
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  bodyMeshes: THREE.SkinnedMesh[];
  headMeshes: THREE.SkinnedMesh[];
  skeleton: THREE.Skeleton;
  bones: THREE.Bone[];
  skeletonGroup: THREE.Group;
  animSmb: SmbData;
  bipInxInfo: InxData;
  bodyInxInfo: InxData;
  headInxInfo: InxData;
  bodyTextures: { url: string; mat: THREE.MeshPhongMaterial; nodeName: string }[];
  headTextures: { url: string; mat: THREE.MeshPhongMaterial; nodeName: string }[];
}

export async function loadCharacterModel(
  jobId: number,
  faceNum = 0,
  tier = 0,
  armorNum = 1,
  bodyInxOverride: string | null = null,
): Promise<CharLoadResult> {
  const job = JOB_DATA[jobId];
  if (!job) throw new Error('未知职业ID: ' + jobId);

  const bodyInxPath = bodyInxOverride || getBodyInxPath(jobId, armorNum) || job.bodyInx;
  const headInxPath = getHeadInxPath(jobId, faceNum, tier);

  const [bodyInxInfo, headInxInfo, bipInxInfo] = await Promise.all([
    fetchAB('/res/' + bodyInxPath).then(buf => parseInx(buf)),
    fetchAB('/res/' + headInxPath!).then(buf => parseInx(buf)),
    fetchAB('/res/' + job.bipInx).then(buf => parseInx(buf)),
  ]);

  const bodyModelBase = resolveModelBase(bodyInxInfo);
  const headModelBase = resolveModelBase(headInxInfo);
  if (!bodyModelBase) throw new Error('body modelFile 为空');
  if (!headModelBase) throw new Error('head modelFile 为空');

  const bipMotionBase = resolveMotionBase(bipInxInfo);
  if (!bipMotionBase) throw new Error('bip motionFile 为空');
  const smbUrl = '/res/' + bipMotionBase + '.smb';

  const smb = parseSmb(await fetchAB(smbUrl));

  const bodyHighNames = bodyInxInfo.highModel.modelNames.filter(Boolean);
  const headHighNames = headInxInfo.highModel.modelNames.filter(Boolean);
  const headMeshNames = headHighNames.length > 0 ? headHighNames : null;

  const loadSmd = async (basePath: string) => {
    const url = '/res/' + basePath + '.smd';
    const buf = await fetchAB(url);
    return parseSmb(buf);
  };

  const [bodySmd, headSmd] = await Promise.all([
    loadSmd(bodyModelBase),
    loadSmd(headModelBase),
  ]);

  const skel = buildSkeleton(smb, false);
  const bodyResult = buildSkinnedMesh(bodySmd, smb, bodyHighNames, false, skel);
  const headResult = buildSkinnedMesh(headSmd, smb, headMeshNames, false, skel);

  return {
    bodyGroup: bodyResult.group,
    headGroup: headResult.group,
    bodyMeshes: bodyResult.meshes,
    headMeshes: headResult.meshes,
    skeleton: skel.skeleton,
    bones: skel.bones,
    skeletonGroup: skel.skeletonGroup,
    animSmb: smb,
    bipInxInfo,
    bodyInxInfo,
    headInxInfo,
    bodyTextures: bodyResult.texturesToLoad,
    headTextures: headResult.texturesToLoad,
  };
}
