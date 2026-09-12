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
import { reportFallback } from '../char/fallback-log.js';

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
  // 第 11 职业 = 格斗家（MartialArtist，女性）。资产 2026-09-12 从 11 职业客户端补齐
  // （`npx tsx scripts/diff-tmabcd.ts --copy`，1074 个文件）：体型 f001.inx + TfbF01.*、
  // 头部 tfh-f01.* + TfhF01.*、服装 cf001.inx + CtfbF01.*。
  // 依据：`M8Bip.in` 头部 `*동작모음 "TfbF01.ASE"`（Tfb = t-female-body），
  // 且其 81 条动画全部标注 `*적용직업 MartialArtist`。
  11: { bodyInx: 'char/tmabcd/f001.inx', headPrefix: 'tfh-f', headLetter: 'f', bipInx: 'char/tmabcd/m8bip.inx', bipSmb: 'm8.smb', gender: 'f', bipMeshPrefix: 'tfb' },
};

/**
 * 职业档位后缀 = 头部 `.inx` 的后缀，**共 5 档**：`''`(1档) `a` `b` `c` `d`。
 * 另存在 `t` 后缀（每家族都有 `.inx`，多数也有网格），但**含义未确认**，故**不作为档位暴露**。
 * 曾只有 4 档（`''`,`a`,`b`,`c`）→ 缺第 5 档（用户实测）。
 */
export const TIER_SUFFIXES = ['', 'a', 'b', 'c', 'd'];
/** 职业档位范围（由 `TIER_SUFFIXES` 推导 —— 单一来源，勿在别处再写一遍数字） */
export const TIER_RANGE = { min: 0, max: TIER_SUFFIXES.length - 1 };

/**
 * 脸号范围。实测 11 个玩家头部家族的脸号都是 **01..13 连续**（→ 索引 0..12）；
 * 另有 19/20/…/27 等散号与 `99`（dummy），**不暴露**。
 * 曾为 0..9 → 脸 11~13 选不到（与档位同一类"硬编码范围窄于数据"的缺陷）。
 */
export const FACE_RANGE = { min: 0, max: 12 };

/**
 * 头部 `.inx` 的**候选路径**（按优先级）。取列表而非单值，因为**命名逐家族逐脸不一致**：
 *
 * ① **后缀 `b`（第 2 档）有"正经档"与"大头"两套网格**：
 *    `_` 式（`tmh_c01b.inx` → 声明 `Tmh_C01b.ase`）是**正经的第 2 档**；
 *    `-`/连写式（`tmh-c01b.inx` → 声明 `TmhC01b.ase`）是**大头**（同一张脸的另一套网格）。
 *    实测网格大小：连写式稳定在 **≈35–38 KB**（`tmha01b` 37808 / `tmhc01b` 37792），
 *    而下划线式与 a/c/d 各档都在 **110 KB 以上**（`tmh_a01b` 172500 / `tmh_c01b` 110152 /
 *    `tfh_d01b` 125829）。**Archer(tfh-d) 没有连写式** → 它的第 2 档一直正常；
 *    **Pikeman(tmh-c) 两套都有**，旧版把连写式排前面 → 第 2 档显示成大头（用户实测）。
 *    故 `b` 档 **下划线式优先**。（"大头"是另一套整脸的网格，此处只取正经档，不把它当档位。）
 * ② 其余后缀只有连写式。
 * ③ 末位追加本脸**基础档**兜底：档位变体并非每个 (家族,脸) 都有（新职业只有脸 01~03），
 *    兜底保证换头**永不失败**；实际用了哪条由 `HeadPart.headInxUsed` 回传，界面据此提示。
 */
export function getHeadInxCandidates(jobId: number, faceNum: number, tier = 0): string[] {
  const job = JOB_DATA[jobId];
  if (!job) return [];
  const face = String(faceNum + 1).padStart(2, '0');
  const suffix = TIER_SUFFIXES[tier] ?? '';
  const p = job.headPrefix;
  const lastDash = p.lastIndexOf('-');
  const und = lastDash >= 0 ? `${p.substring(0, lastDash)}_${p.substring(lastDash + 1)}` : p;
  const path = (pre: string, s: string): string => `char/tmabcd/${pre}${face}${s}.inx`;
  // `b` 档：下划线（正经档）优先、连写（大头）次之；其余后缀：连写优先。
  const order = suffix === 'b' ? [und, p] : [p, und];
  return [...new Set([
    ...order.map((pre) => path(pre, suffix)),
    ...(suffix ? [path(p, ''), path(und, '')] : []),
  ])];
}

/** 头部 `.inx` 路径（候选中的第一个；仅用于展示/日志。加载请用 `getHeadInxCandidates`） */
export function getHeadInxPath(jobId: number, faceNum: number, tier = 0): string | null {
  return getHeadInxCandidates(jobId, faceNum, tier)[0] ?? null;
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
  /** 实际命中的 `.inx` 路径。与请求的 tier 不一致 = **该档位没有这张脸，已回退到基础档** */
  headInxUsed: string;
  headInxInfo: InxData;
  result: ReturnType<typeof buildSkinnedMesh>;
  /** 构建诊断（未知骨名 / 网格筛选未命中）—— 见 `SkinnedMeshResult.diag` */
  diag: ReturnType<typeof buildSkinnedMesh>['diag'];
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

  // 头部 .inx 的命名逐家族/逐脸不一致（`-` 与 `_` 两种都有人用）→ 依次尝试候选，
  // 只有全部失败才算失败。曾因只拼一种、且把下划线错当成 tier2 专属，导致 404 后解析越界。
  const cands = getHeadInxCandidates(jobId, faceNum, tier);
  if (!cands.length) throw new Error('未知职业ID: ' + jobId);
  let headInxInfo: InxData | null = null;
  let headInxUsed = '';
  let lastErr: unknown = null;
  for (const c of cands) {
    try { headInxInfo = await loadInx(c); headInxUsed = c; break; } catch (e) { lastErr = e; }
  }
  if (!headInxInfo) {
    throw new Error(`头部 .inx 均不可用（试过 ${cands.join(' , ')}）: ${String(lastErr)}`);
  }
  // 命中的不是"请求档位"那一条 = 该档位没有这张脸，已降级到基础档 → 上报（别让人以为那是该档位的头）
  if (tier > 0 && !/[a-d]\.inx$/i.test(headInxUsed)) {
    reportFallback('head', `job=${jobId} face=${faceNum} tier=${tier} 无该档位头模 → 用基础档 ${headInxUsed.split('/').pop()}`);
  }
  const headModelBase = resolveModelBase(headInxInfo);
  if (!headModelBase) throw new Error('head modelFile 为空');

  const skelData = await getSkeleton(jobId);
  const smd = await loadSmbFromRes(headModelBase + '.smd');
  const headHighNames = headInxInfo.highModel.modelNames.filter(Boolean);
  const headMeshNames = headHighNames.length > 0 ? headHighNames : null;

  const result = buildSkinnedMesh(smd, skelData.animSmb, headMeshNames, false, skelData.skel);
  return { jobId, faceNum, tier, headInxUsed, headInxInfo, result, diag: result.diag };
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
