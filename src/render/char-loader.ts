/**
 * PT 角色模型加载器 — 骨骼 / 身体 / 头部 分离加载
 *
 * 依据 C++ 源码：
 *  - character.cpp:smPATTERN::LoadCharactor — body .inx → model .smd
 *  - character.cpp:SetPattern — head Pattern2 共享骨骼
 *  - fileread.cpp:smModelDecode — linkFile 递归加载动画数据
 *
 * 设计：身体(bip 骨骼+网格) 与 头部 解耦。
 *  - 一个职业的骨骼(**bip** .smb) + 身体网格(.smd) 只加载一次；
 *  - 切换头型只重新加载/复用头部网格，不重载身体与骨骼。
 * 所有 fetch 结果落在 asset-cache.ts（URL 级），parse/build 结果由 model-cache 缓存。
 */

import * as THREE from 'three';
import { parseInx, parseSmb } from '../core/char-parser.js';
import { cachedFetch } from '../core/asset-cache.js';
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
  return cachedFetch(url);
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

/** 一次拉取并解析一个 .inx */
async function loadInx(path: string): Promise<InxData> {
  return parseInx(await fetchAB('/res/' + path));
}

/** 一次拉取并解析一个 .smd / .smb */
async function loadSmbFromRes(path: string): Promise<SmbData> {
  return parseSmb(await fetchAB('/res/' + path));
}

// ===== 拆分加载：骨骼 / 身体 / 头部 =====

export interface SkeletonData {
  jobId: number;
  animSmb: SmbData;     // bip .smb（骨骼+动画）
  bipInxInfo: InxData;  // bip .inx（动画条目）
  skel: ReturnType<typeof buildSkeleton>;
}

export interface BodyPart {
  jobId: number;
  bodyInxInfo: InxData;
  result: ReturnType<typeof buildSkinnedMesh>;
}

export interface HeadPart {
  jobId: number;
  faceNum: number;
  tier: number;
  headInxInfo: InxData;
  result: ReturnType<typeof buildSkinnedMesh>;
}

// ===== 记忆化缓存（promise 防重入）=====

const skelCache = new Map<number, Promise<SkeletonData>>();
const bodyPartCache = new Map<string, Promise<BodyPart>>();
const headPartCache = new Map<string, Promise<HeadPart>>();

function memo<K, V>(map: Map<K, Promise<V>>, key: K, factory: () => Promise<V>): Promise<V> {
  let p = map.get(key);
  if (!p) {
    p = factory().catch((e) => { map.delete(key); throw e; });
    map.set(key, p);
  }
  return p;
}

const bodyKey = (jobId: number, armor: number, override: string | null) => `${jobId}:${armor}:${override ?? ''}`;
const headKey = (jobId: number, face: number, tier: number) => `${jobId}:${face}:${tier}`;

/** 骨架/身体/头部缓存是否已（部分）填充 */
export function isPreloaded(): boolean {
  return skelCache.size > 0 || bodyPartCache.size > 0 || headPartCache.size > 0;
}

/** 缓存版：职业骨骼+动画，全脸共享 */
export function getSkeleton(jobId: number): Promise<SkeletonData> {
  return memo(skelCache, jobId, () => loadSkeleton(jobId));
}

/** 缓存版：职业身体网格，只构建一次 */
export function getBody(jobId: number, armorNum = 1, override: string | null = null): Promise<BodyPart> {
  return memo(bodyPartCache, bodyKey(jobId, armorNum, override), () => loadBody(jobId, armorNum, override));
}

/** 缓存版：职业头部网格，切换头型只构建该头 */
export function getHead(jobId: number, faceNum: number, tier = 0): Promise<HeadPart> {
  return memo(headPartCache, headKey(jobId, faceNum, tier), () => loadHead(jobId, faceNum, tier));
}

/** 加载职业骨骼 + 动画（bip），全脸共享，只加载一次 */
async function loadSkeleton(jobId: number): Promise<SkeletonData> {
  const job = JOB_DATA[jobId];
  if (!job) throw new Error('未知职业ID: ' + jobId);

  const bipInxInfo = await loadInx(job.bipInx);
  const bipMotionBase = resolveMotionBase(bipInxInfo);
  if (!bipMotionBase) throw new Error('bip motionFile 为空');
  const smb = await loadSmbFromRes(bipMotionBase + '.smb');

  const skel = buildSkeleton(smb, false);
  return { jobId, animSmb: smb, bipInxInfo, skel };
}

/** 加载职业身体网格（默认铠甲），只加载一次 */
export async function loadBody(jobId: number, armorNum = 1, bodyInxOverride: string | null = null): Promise<BodyPart> {
  const job = JOB_DATA[jobId];
  if (!job) throw new Error('未知职业ID: ' + jobId);

  const bodyInxPath = bodyInxOverride || getBodyInxPath(jobId, armorNum) || job.bodyInx;
  const bodyInxInfo = await loadInx(bodyInxPath);
  const bodyModelBase = resolveModelBase(bodyInxInfo);
  if (!bodyModelBase) throw new Error('body modelFile 为空');

  const skelData = await getSkeleton(jobId);
  const smd = await loadSmbFromRes(bodyModelBase + '.smd');
  const bodyHighNames = bodyInxInfo.highModel.modelNames.filter(Boolean);

  const result = buildSkinnedMesh(smd, skelData.animSmb, bodyHighNames, false, skelData.skel);
  return { jobId, bodyInxInfo, result };
}

/** 加载职业头部网格（指定头型），切换头型时复用身体/骨骼 */
export async function loadHead(jobId: number, faceNum: number, tier = 0): Promise<HeadPart> {
  const job = JOB_DATA[jobId];
  if (!job) throw new Error('未知职业ID: ' + jobId);

  const headInxPath = getHeadInxPath(jobId, faceNum, tier);
  if (!headInxPath) throw new Error('head .inx 路径为空');
  const headInxInfo = await loadInx(headInxPath);
  const headModelBase = resolveModelBase(headInxInfo);
  if (!headModelBase) throw new Error('head modelFile 为空');

  const skelData = await getSkeleton(jobId);
  const smd = await loadSmbFromRes(headModelBase + '.smd');
  const headHighNames = headInxInfo.highModel.modelNames.filter(Boolean);
  const headMeshNames = headHighNames.length > 0 ? headHighNames : null;

  const result = buildSkinnedMesh(smd, skelData.animSmb, headMeshNames, false, skelData.skel);
  return { jobId, faceNum, tier, headInxInfo, result };
}

// ===== 组合 =====

export interface CharLoadResult {
  jobId: number;
  faceNum: number;
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

/**
 * 组合 身体+头部 为一个角色。身体与头部共享同一副骨骼。
 * jobId 相同 ⇒ body/skeleton/bones 是同一组对象，仅 head 随 face 变化。
 */
export async function loadCharacterModel(
  jobId: number,
  faceNum = 0,
  tier = 0,
  armorNum = 1,
  bodyInxOverride: string | null = null,
): Promise<CharLoadResult> {
  const [body, head, skelData] = await Promise.all([
    getBody(jobId, armorNum, bodyInxOverride),
    getHead(jobId, faceNum, tier),
    getSkeleton(jobId),
  ]);

  return {
    jobId,
    faceNum,
    bodyGroup: body.result.group,
    headGroup: head.result.group,
    bodyMeshes: body.result.meshes,
    headMeshes: head.result.meshes,
    skeleton: skelData.skel.skeleton,
    bones: skelData.skel.bones,
    skeletonGroup: skelData.skel.skeletonGroup,
    animSmb: skelData.animSmb,
    bipInxInfo: skelData.bipInxInfo,
    bodyInxInfo: body.bodyInxInfo,
    headInxInfo: head.headInxInfo,
    bodyTextures: body.result.texturesToLoad,
    headTextures: head.result.texturesToLoad,
  };
}
