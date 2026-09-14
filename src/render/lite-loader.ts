/**
 * lite 骨架装载器（客户端侧）—— 选角 / 创建角色预览用。
 *
 * 为什么有它：完整动画包 m1~m8 各 13.6~32.7MB（8 组合计 162MB），而角色选择界面
 * 只需要"一个站着的小人"。lite 包 = 骨架 + 单条 STAND，每组 293~648KB
 * （详见 `client/char/tmabcd/lite/README.md`）。
 *
 * ── 契约（**改任一侧都要同步**）────────────────────────────────────────────
 * lite 包的条目选择规则是 `state=STAND & weapon.unarmed & location=village`（见各
 * `mX.lite.json` 的 `selection`），而选角页的动画状态机正是以"村庄/收械（`getFieldState: () => 1`）
 * + 空手"去查询 —— **它只会选中 lite 里保留的那一条**。所以不需要任何"lite 声明自己有哪些条目"
 * 的过滤机制：这个包就是为这个界面定制的（用户 2026-09-14 定）。
 * 若将来 lite 的提取规则或选角页的查询条件变了，这条对应关系必须一起改 —— 否则会播到
 * "没有关键帧的条目"，而那不是报错，是**回退成绑定姿态**（角色僵住，看起来像资产坏了）。
 *
 * 进游戏**不用** lite（要走/跑/打/技能全套）：进图加载屏里拉完整包 —— 那时本来就要重建角色，
 * 不存在"中途换骨架"的问题（换骨架要重建全部蒙皮网格）。
 */
import { fetchAsset, loadParsedAsset } from '../core/asset-manager.js';
import { parseInx, parseSmb } from '../core/char-parser.js';
import { buildSkeleton, buildSkinnedMesh } from './skinned-builder.js';
import { JOB_DATA, getBodyInxPath, getHeadInxCandidates, resolveModelBase } from './char-loader.js';
import { loadCharTextures } from './char-texture-loader.js';
import type { CharLoadResult } from './char-loader.js';
import type { InxData, SmbData } from '../char/char-format.js';

/** 与 `client/char/tmabcd/lite/` 的部署路径一致（把完整包 `char/tmabcd/mX.smb` 换成 `lite/mX.smb`） */
const LITE_BASE = '/res/char/tmabcd/lite';

export interface LiteSkeleton {
  animSmb: SmbData;
  bipInxInfo: InxData;
  skel: ReturnType<typeof buildSkeleton>;
  /**
   * lite 包里**真实带关键帧**的 .inx 条目号（来自 `mX.lite.json` 的 `selection.inxIndex`）。
   * 选角页据此过滤 motionList —— 不过滤的话，匹配器可能选中同条件的**另一个变体**
   * （如 `stand_unarmed~2.mX.11`），那个条目在 lite 里没有关键帧，播出来是绑定姿态
   * （看着像"站着不动"，且不报错）。用户 2026-09-14 实测过这个症状。
   */
  liteInxIndices: number[];
}

const liteCache = new Map<number, Promise<LiteSkeleton>>();
const metaCache = new Map<number, Promise<number>>();

/** 从 `mX.lite.json`（provenance）取"这条 lite 包保留了哪个 .inx 条目" */
function liteInxIndexOf(group: number): Promise<number> {
  return memo(metaCache, group, async () => {
    const buf = await fetchAsset(`${LITE_BASE}/m${group}.lite.json`, 'misc');
    const meta = JSON.parse(new TextDecoder().decode(buf)) as {
      payload?: string; selection?: { inxIndex?: number };
    };
    const idx = Number(meta.selection?.inxIndex);
    if (!Number.isInteger(idx)) {
      throw new Error(`lite meta 缺 selection.inxIndex: m${group}.lite.json`);
    }
    return idx;
  });
}

/** 某职业所属动画组的组号（m1~m8）：多职业共享同一组（Fighter/Mec/Knight → m1，见 JOB_DATA.bipInx） */
function groupOfJob(jobId: number): number {
  const job = JOB_DATA[jobId];
  if (!job) throw new Error(`未知职业ID: ${jobId}`);
  const gm = /m(\d+)bip\.inx$/i.exec(job.bipInx);
  if (!gm) throw new Error(`job ${jobId} 的 bipInx 无法解析动画组: ${job.bipInx}`);
  return Number(gm[1]);
}

export function getSkeletonLite(jobId: number): Promise<LiteSkeleton> {
  return memo(liteCache, jobId, async () => {
    const job = JOB_DATA[jobId]!;
    const group = groupOfJob(jobId);
    // lite 骨架包：**只缓存字节、不缓存解析结果**（anim 的策略，见 asset-manager 文件头）；
    // bip 条目表（.inx）走 model 类并缓存解析结果。
    // 体模/头模的 .smd 也走 model 类 ⇒ 与进图（完整包路径）共用同一份解析结果与几何原料。
    const [animSmb, bipInxInfo, inxIndex] = await Promise.all([
      loadParsedAsset(`${LITE_BASE}/m${group}.smb`, 'anim', parseSmb, false),
      loadParsedAsset('/res/' + job.bipInx, 'model', parseInx, true),
      liteInxIndexOf(group),
    ]);
    return { animSmb, bipInxInfo, skel: buildSkeleton(animSmb, false), liteInxIndices: [inxIndex] };
  });
}

/**
 * 选角/创建角色预览的角色装配。**返回形状与 `loadCharacterModel` 一致** ——
 * 骨架/动画换成了 lite 包，其余（体模、头模、纹理、蒙皮装配）完全相同，
 * 所以调用方（CharSelect.loadPreview）除了一行加载调用之外一处都不用改。
 */
export async function loadCharacterModelLite(
  jobId: number,
  faceNum = 0,
  armorNum = 1,
  bodyInxOverride: string | null = null,
): Promise<CharLoadResult> {
  const job = JOB_DATA[jobId];
  if (!job) throw new Error(`未知职业ID: ${jobId}`);
  const lite = await getSkeletonLite(jobId);

  // ---- 身体：体模 smd 蒙皮到 lite 骨架（与 loadBody 同一装配方式）----
  // override（时装）优先于按防具档位推导的路径 —— 与 loadBody 的优先级一致
  const bodyPath = bodyInxOverride || getBodyInxPath(jobId, armorNum) || job.bodyInx;
  const bodyInxInfo = await loadParsedAsset('/res/' + bodyPath, 'model', parseInx, true);
  const bodyBase = resolveModelBase(bodyInxInfo);
  if (!bodyBase) throw new Error(`job ${jobId} body modelFile 为空`);
  const bodySmd = await loadParsedAsset('/res/' + bodyBase + '.smd', 'model', parseSmb, true);
  const bodyHigh = bodyInxInfo.highModel.modelNames.filter(Boolean);
  const body = buildSkinnedMesh(bodySmd, lite.animSmb, bodyHigh.length > 0 ? bodyHigh : null, false, lite.skel);

  // ---- 头部：候选链逐个试（与 loadHead 同一策略，换头不回退到"没头"）----
  const cands = getHeadInxCandidates(jobId, faceNum, 0);
  let head: ReturnType<typeof buildSkinnedMesh> | null = null;
  let headInxInfo: InxData | null = null;
  let lastErr: unknown = null;
  for (const c of cands) {
    try {
      const inx = await loadParsedAsset('/res/' + c, 'model', parseInx, true);
      const base = resolveModelBase(inx);
      if (!base) throw new Error('head modelFile 为空');
      const smd = await loadParsedAsset('/res/' + base + '.smd', 'model', parseSmb, true);
      const high = inx.highModel.modelNames.filter(Boolean);
      head = buildSkinnedMesh(smd, lite.animSmb, high.length > 0 ? high : null, false, lite.skel);
      headInxInfo = inx;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!head || !headInxInfo) {
    throw new Error(`job ${jobId} 头模不可用（试过 ${cands.join(', ')}）: ${String(lastErr)}`);
  }

  return {
    jobId,
    faceNum,
    bodyGroup: body.group,
    headGroup: head.group,
    bodyMeshes: body.meshes,
    headMeshes: head.meshes,
    skeleton: lite.skel.skeleton,
    bones: lite.skel.bones,
    skeletonGroup: lite.skel.skeletonGroup,
    animSmb: lite.animSmb,
    bipInxInfo: lite.bipInxInfo,
    bodyInxInfo,
    headInxInfo,
    bodyTextures: body.texturesToLoad,
    headTextures: head.texturesToLoad,
    // 告诉调用方"这个骨架包里只有这一个条目真有数据"（见 CharLoadResult.liteInxIndices 的说明）
    liteInxIndices: lite.liteInxIndices,
  };
}

export { loadCharTextures };

function memo<K, V>(map: Map<K, Promise<V>>, key: K, factory: () => Promise<V>): Promise<V> {
  let v = map.get(key);
  if (!v) {
    v = factory();
    map.set(key, v);
  }
  return v;
}
