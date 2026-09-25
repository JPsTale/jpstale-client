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
import { loadParsedAsset } from '../core/asset-manager.js';
import { buildSkeleton, buildSkinnedMesh } from './skinned-builder.js';
import { reportFallback } from '../char/fallback-log.js';
import type { InxData, MotionInfo, SmbData } from '../char/char-format.js';
import { CHRMOTION_EXT } from '../char/char-format.js';
import type * as THREE from 'three';

/**
 * 取资产 + 解析，走 AssetManager 的统一入口（见 core/asset-manager.ts）。
 *
 * 对怪物来说这一层有实打实的收益：**同一模型被 N 只怪复用时只解析一次**。
 * 原来每只怪 spawn 都要 `parseSmb` 一遍（222 只怪 = 222 次重复解析 smd/smb，
 * 每次都重新建一套关键帧数组）。
 */
async function parseRes<T>(
  url: string, kind: 'model' | 'anim', parse: (buf: ArrayBuffer) => T, cacheParsed: boolean,
): Promise<T> {
  return loadParsedAsset(url, kind, (buf) => {
    if (buf.byteLength === 0) throw new Error('空文件: ' + url);   // 与原来 `byteLength > 0` 的候选跳过语义一致
    return parse(buf);
  }, cacheParsed);
}

/** 归一化资源 basename：反斜杠→斜杠、小写、去扩展名 */
function lowerBase(raw: string): string {
  const mf = raw.replace(/\\/g, '/').toLowerCase();
  const slash = mf.lastIndexOf('/');
  const name = mf.substring(slash + 1).replace(/\.[^.]+$/, '');
  const dir = slash >= 0 ? mf.substring(0, slash) : '';
  return dir ? dir + '/' + name : name;
}

/** 逐一尝试候选 basename + .smd，返回第一个解析成功的网格数据（**解析结果按 URL 缓存**） */
async function loadMesh(baseCandidates: string[]): Promise<SmbData | null> {
  for (const base of baseCandidates) {
    try {
      return await parseRes('/res/' + base + '.smd', 'model', parseSmb, true);
    } catch {
      // next candidate
    }
  }
  return null;
}

/** 逐一尝试候选 basename + .smb，返回第一个解析成功的骨骼/动画数据（**只缓存字节，不缓存解析结果**） */
async function loadAnim(baseCandidates: string[]): Promise<SmbData | null> {
  for (const base of baseCandidates) {
    try {
      return await parseRes('/res/' + base + '.smb', 'anim', parseSmb, false);
    } catch {
      // next candidate
    }
  }
  return null;
}

/** 解析一个 .inx（可能 .in/.ini 实际为 .inx 文件，几种路径都试） */
async function loadInxWithFallback(link: string): Promise<InxData | null> {
  const lc = link.replace(/\\/g, '/').toLowerCase();
  const candidates = [lc, lc.replace(/\.ini$/, '.inx'), lc.replace(/\.in$/, '.inx'), lc + '.inx'];
  for (const c of candidates) {
    try {
      return await parseRes('/res/' + c, 'model', parseInx, true);
    } catch {
      // next candidate
    }
  }
  return null;
}

/** 由动画 .smb + 动画条目源 .inx 构建 MotionInfo[]（同玩家 buildMotionListFor 语义） */
export function buildMotionList(animSmb: SmbData, inx: InxData): MotionInfo[] {
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
    // ⚠ **不要**给死亡动作扣帧。曾在 `fileread.cpp` 里看到
    // `if (State == DEAD) EndFrame -= 8;` 而在这里跟着扣了 8，那是**用错了分支**：
    // 那两处（ex-machina `fileread.cpp:394`、NewSourcePT `:446`）都在 `AddModelDecode()` 里
    // —— 它是**INI 文本兜底解析器**，只在二进制模型文件缺失/打不开时才走
    //（`smModelDecode()`：`if (lpFile && dwFileLen == sizeof(smMODELINFO))` 走二进制主路径，
    //  else 才 `AddModelDecode`）。主路径按结构体读 + `MotionKeyWordDecode` 解包，
    // **全仓没有任何减 8**。我们读的就是二进制 `.inx`，属于主路径 ⇒ 死亡动画**播到声明末帧**
    // 再冻住（原版客户端同样如此），扣掉这 8 帧会让尸体停在还没躺稳的姿势上。
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
  /**
   * 副模型（`subModelFile`）—— 一整具模型，与主体**各有各的网格与骨架**。
   *
   * 何时显示：当前播放的动作条目带 `subModel: true` 时（见 `MotionInfo.subModel`）。
   * 典型用途是**独立死亡模型**（主模型没有 DEAD、副模型才有）。`motionList` 已并入总表，
   * 这里保存的是渲染所需的另一套网格/骨架/动画。
   */
  sub?: MonsterSubModel;
}

/** 副模型的渲染部件（与主体同构，但不含 texturesToLoad —— 已并入主体的加载列表） */
export interface MonsterSubModel {
  modelBase: string;
  animSmb: SmbData;
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  skeletonGroup: THREE.Group;
  group: THREE.Group;
  meshes: THREE.SkinnedMesh[];
  motionList: MotionInfo[];
}

/**
 * 加载单个怪物模型。
 * @param inxPath 资产相对路径（如 char/monster/monimp/monimp-a.inx）
 */
export async function loadMonsterModel(inxPath: string): Promise<MonsterModelResult> {
  // 传进来的**必须是资产路径**。实测过一次收发字段串位：客户端把 `name_key`（i18n 键，
  // 形如 `4_hopy`）当模型路径传进来，于是去请求 `/res/4_hopy`，最后炸在一个与病因无关的
  // 解析错误上（`RangeError: Invalid typed array length`）。这里点名判死 ——
  // 真实的模型路径一定带目录（`char/monster/...`），裸词干/裸文件名都不是。
  if (!/[\\/]/.test(inxPath)) {
    throw new Error(`怪物模型路径不是资产路径（收到 "${inxPath}"）`
      + ' —— 检查 S2C_MonsterAppear 的 model_file 与 name_key 是否串位');
  }
  // 归一化:小写 + 反斜杠→斜杠 + .ini→.inx(服务端已规范,双保险)
  const path = inxPath.replace(/\\/g, '/').toLowerCase().replace(/\.ini$/, '.inx');
  const inxInfo = await parseRes('/res/' + path, 'model', parseInx, true);
  if (!inxInfo.modelFile) throw new Error('monster .inx modelFile 为空: ' + path);

  const modelBase = lowerBase(inxInfo.modelFile);
  const inxBase = path.replace(/\.inx$/i, '');
  const inxDir = inxBase.substring(0, inxBase.lastIndexOf('/') + 1);
  const modelName = modelBase.substring(modelBase.lastIndexOf('/') + 1);

  // LOD 网格名：高 → 中 → 低 → 全量
  const high = inxInfo.highModel.modelNames.filter(Boolean);
  const def = inxInfo.defaultModel.modelNames.filter(Boolean);
  const low = inxInfo.lowModel.modelNames.filter(Boolean);
  const meshNames = high.length > 0 ? high : def.length > 0 ? def : low.length > 0 ? low : null;

  // 网格 .smd：优先 modelFile 推断，回退 inx 同名 / inx 目录+model 名
  const mesh = await loadMesh([modelBase, inxBase, inxDir + modelName]);
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

  const animCandidates = [animBase, animBase !== modelBase ? modelBase : ''].filter(Boolean) as string[];
  let animSmb: SmbData | null = await loadAnim(animCandidates);
  if (!animSmb) throw new Error('monster .smb 加载失败: ' + inxPath + ' base=' + animBase);

  const skel = buildSkeleton(animSmb, false);
  const built = buildSkinnedMesh(mesh, animSmb, meshNames, false, skel);

  // 副模型（`subModelFile`，即 `*-die.INI` 那类）：原版 `SetMotionFromCode` 先查主模型动作表，
  // **查不到才查副模型**（`if (FindCnt == 0 && AnimDispMode && lpDinaPattern2)`），
  // 查到就 `MotionSelectFrame = 1` 并用副模型渲染（`PatDispMode & DISP_MODE_PATSUB` → `Pattern2`）。
  // 两种用途都在这条路上：
  //   · **独立死亡模型**：主模型没有 DEAD，副模型（尸体模型）才有 —— 实测 66 个这样的副模型；
  //   · **另一套动作**：如 MonminiG a1 只有 RUN/WALK/STAND，a2 才有 ATTACK/DAMAGE（9 个，无 DEAD）。
  // 故副模型要**当成一整具模型装配**（网格+骨架+动作表），不能只把动作条目并进来了事 ——
  // 实测带 DEAD 的 66 个副模型里 **63 个骨架与主模型完全不同**，动作套错骨架会错位。
  let motionList = buildMotionList(animSmb, motionInx);
  let sub: MonsterSubModel | undefined;
  if (inxInfo.subModelFile && inxInfo.subModelFile.trim().length > 0) {
    try {
      const subInx = await loadInxWithFallback(inxInfo.subModelFile);
      if (!subInx) throw new Error('副模型 .inx 解析失败');
      const subModelBase = lowerBase(subInx.modelFile);
      const subInxBase = lowerBase(inxInfo.subModelFile).replace(/\.(ini|in)$/, '');
      const subName = subModelBase.substring(subModelBase.lastIndexOf('/') + 1);
      const subMesh = await loadMesh([subModelBase, subInxBase, subInxBase.substring(0, subInxBase.lastIndexOf('/') + 1) + subName]);
      if (!subMesh) throw new Error('副模型 .smd 加载失败: ' + subModelBase);
      const subAnimBase = subInx.motionFile && subInx.motionFile.trim().length > 0
        ? lowerBase(subInx.motionFile)
        : subModelBase;
      const subSmb = await loadAnim([subAnimBase, subModelBase].filter(Boolean) as string[]);
      if (!subSmb) throw new Error('副模型 .smb 加载失败: base=' + subAnimBase);

      const subHigh = subInx.highModel.modelNames.filter(Boolean);
      const subDef = subInx.defaultModel.modelNames.filter(Boolean);
      const subLow = subInx.lowModel.modelNames.filter(Boolean);
      const subMeshNames = subHigh.length > 0 ? subHigh : subDef.length > 0 ? subDef : subLow.length > 0 ? subLow : null;

      const subSkel = buildSkeleton(subSmb, false);
      const subBuilt = buildSkinnedMesh(subMesh, subSmb, subMeshNames, false, subSkel);
      sub = {
        modelBase: subModelBase,
        animSmb: subSmb,
        bones: subSkel.bones,
        skeleton: subSkel.skeleton,
        skeletonGroup: subSkel.skeletonGroup,
        group: subBuilt.group,
        meshes: subBuilt.meshes,
        motionList: buildMotionList(subSmb, subInx),
      };
      // 副模型的动作条目并进总表供**选条**用，但只并入**主模型没有的状态** ——
      // 原版是"先查主表，`FindCnt == 0` 才查副表"（见上），所以主模型已有的状态永远轮不到副模型。
      // 每条打上 `subModel` 标记：渲染时按当前条目切到副模型的网格+骨架（见 WorldView.updateMonsters）。
      const mainStates = new Set(
        motionList.filter(m => m.state && m.endFrame > m.startFrame).map(m => m.state),
      );
      const extra = sub.motionList.filter(m => m.state && m.endFrame > m.startFrame && !mainStates.has(m.state));
      motionList = motionList.concat(extra.map(m => ({ ...m, animSmb: subSmb, subModel: true })));
      built.texturesToLoad.push(...subBuilt.texturesToLoad);
    } catch (e) {
      // 不静默（AGENTS #12）：声明了副模型却装不起来 = 这只怪死后不会躺下，
      // 而现象（"它死了但站着"）与"这个模型本来就没有死亡动作"完全是两回事
      reportFallback('anim', `怪物 ${inxPath} 声明了副模型 ${inxInfo.subModelFile}，但装载失败`
        + ` → 该怪死后不会换尸体模型（停在死亡那一刻的姿势）：${(e as Error).message}`);
      console.warn('[monster-loader] 副模型装载失败', inxPath, inxInfo.subModelFile, e);
    }
  }

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
    motionList,
    sub,
  };
}
