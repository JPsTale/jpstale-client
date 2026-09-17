/**
 * 平面图离线烘焙 —— 大地图（M 键）的数据源。
 *
 * 约定（大地图拼图的前提）：
 *   · **统一比例尺** `scale`：1 像素 = `scale` world 单位。图幅 = `ceil(AABB / scale)`，
 *     即"出图大小就是 AABB 的大小"，与地图本身多大无关 —— 这样所有图的像素坐标
 *     与世界坐标是同一个线性映射，世界图可以直接按各自的 AABB 拼。
 *   · **朝向**：东 = +X 在右，北 = −Z 在上（像素 (0,0) ↔ world (minX, minZ)），
 *     与场内小地图、原版 A 族缩略图同向。
 *   · **观感**：与游戏内一致 —— 复用运行时的 `loadMap` / `loadMapDecor`（同一套几何、
 *     贴图、装饰摆放）；环境光取白天默认值（`uEnvLight` 全 0，即 DarkLevel=0）、
 *     无火把、无场景灯。地图材质是 unlit + 顶点色，所以不需要额外打光。
 *   · **图外透明**：背景 alpha=0，便于界面按需压一层羊皮纸底。
 *
 * 不做任何静默兜底：素材缺失、AABB 与 fields.json 不一致、图幅超出 GPU 上限，
 * 都记进 `_bake.log` 与 `index.json` 的 `notes`，失败的地图**不产出文件**。
 */
import * as THREE from 'three';

import { loadMap } from '../maps/fore1.js';
import { loadMapDecor, unloadDecor } from '../maps/decor-loader.js';
import { mapDecorList } from '../maps/map-decor.js';
import { fieldOf, mapSmdPath } from '../maps/map-data.js';
import { exclusionOf } from './planemap-exclusions.js';

/** 装饰纯色（与运行时 WorldView 一致；装饰材质逆向是后续工作） */
const DECOR_COLOR = 0x88aa44;

/** 单图加载超时（见下面的 Promise.race）：把它变成可见失败，而不是整轮静默卡住 */
const MAP_TIMEOUT_MS = 90000;

export interface BakeRecord {
  id: number;
  shortname: string;
  minimap: string | null;
  smd: string;
  scale: number;
  w: number;
  h: number;
  /** 来自已加载几何（smd bounds × 1/256）的 AABB —— 烘焙取景就用它 */
  aabb: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** fields.json 的同类 AABB，用于交叉核对 */
  aabbFields: { minX: number; minZ: number; maxX: number; maxZ: number } | null;
  /** 两者在各边上的最大偏差（world 单位）；> 1 说明数据不同源，记 note */
  aabbDeltaMax: number | null;
  materials: number;
  tris: number;
  /** 落盘字节数（按 format 编码后），用来算玩家的下载量 */
  bytes: number;
  /** 实际提交的绘制统计（three renderer.info）：0 说明一个面都没画 */
  drawnCalls: number;
  drawnTris: number;
  /** 画面里不透明像素数：0 = 空图，按失败处理（不许静默出一张白图） */
  opaquePixels: number;
  decorTotal: number;
  decorLoaded: number;
  ms: number;
  notes: string[];
}

export interface BakeOptions {
  ids: number[];
  scale: number;
  outDir: string;
  /** 调试：在画面中心放一块红板 —— 用它二分"管线没画出来"还是"地图几何没画出来" */
  debug?: boolean;
  /** 调试：只画一块铺满画面的红板（不画地图），用来判断是帧缓冲还是几何的问题 */
  probeOnly?: boolean;
  /** 调试：全场景换纯白材质（剪影），用来判断"几何/取景"与"材质"谁是问题 */
  override?: boolean;
  /** 调试：保留水面（默认剔除，见水面剔除那段）。用来做"带水/不带水"的 A/B 对照 */
  keepWater?: boolean;
  /** 日志文件名（每轮独立，不与上一轮混）。由脚本传 `_bake-<runId>.log`；默认 `_bake.log` */
  logFile?: string;
  /**
   * 落盘格式。`png` = 无损；`webp` = 有损 + 保留 alpha（地形是高频细节，WebP 通常小 5~10 倍，
   * 对玩家下载量影响最大 —— 尺寸/字节数都记进 index.json，便于按数字决定）。
   */
  format?: 'png' | 'webp';
  /** WebP 质量（0~1），默认 0.9 */
  quality?: number;
  /**
   * 诊断：把每张图的**材质表**写进 _bake.log（贴图名 / 占图幅 / 高度区间 / 混合与水面标志）。
   * 用来回答"这块水面/黑液是哪个材质"——剔除规则就靠它定，别靠猜。
   */
  dumpMaterials?: boolean;
  onProgress?: (msg: string) => void;
}

/** 落盘：POST 给 vite dev 中间件（见 vite.config.ts 的 bakeSink） */
async function putFile(rel: string, blob: Blob): Promise<void> {
  const res = await fetch('/__bake?path=' + encodeURIComponent(rel), { method: 'POST', body: blob });
  if (!res.ok) throw new Error(`写入 ${rel} 失败: HTTP ${res.status} ${await res.text()}`);
}

/**
 * 诊断输出（浏览器控制台在无头模式下拿不到，所以写盘）。
 *
 * ⚠ **不用"逐行 append"**：实测长时间运行下页面侧的多次 append 会**静默丢**
 * （服务端用 curl 直测完全正常），结果日志只剩开头几行 —— 诊断信息丢一半比没有更坏。
 * 改成：内存累积整份文本，**每次整份重写**到 `_bake-<runId>.log`（每轮独立文件名，
 * 不与上一轮混在一起；这也顺带解决"上一次的日志被当成这一次"）。
 */
function makeLogger(logPath: string): { log: (line: string) => Promise<void> } {
  const lines: string[] = [];
  return {
    async log(line: string): Promise<void> {
      lines.push(`${new Date().toISOString()} ${line}`);
      console.log(line);
      try {
        await putFile(logPath, new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }));
      } catch {
        /* 日志本身失败不再上报，避免递归 */
      }
    },
  };
}

/**
 * 冒烟检查：**按游戏默认配置**加载一张图并渲染（不改雾、不补 alpha、视角贴地），
 * 用来确认共享的 map-renderer 改动不会破坏运行时（shader 编译错误会经 console 落到 _bake.log）。
 * 返回可见像素数；0 = 运行时渲染坏了。
 */
export async function smokeTest(mapId: number, outDir: string, logFile = '_bake.log'): Promise<number> {
  const logLine = makeLogger(`${outDir}/${logFile}`).log;
  const scene = new THREE.Scene();
  const smd = mapSmdPath(mapId);
  const field = fieldOf(mapId);
  if (!smd || !field) throw new Error(`[smoke] fields.json 里没有这张图: ${mapId}`);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(640, 360, false);
  const mh = await loadMap(scene, smd);
  if (!mh) throw new Error('[smoke] loadMap 返回 null');
  const b = mh.mapRenderer;
  const cx = (b.worldMin[0] + b.worldMax[0]) / 2;
  const cz = (b.worldMin[2] + b.worldMax[2]) / 2;
  const cam = new THREE.PerspectiveCamera(60, 640 / 360, 1, 4000);
  cam.position.set(cx, b.worldMax[1] + 120, cz);
  cam.lookAt(cx + 600, b.worldMax[1] + 40, cz + 600);
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  b.render(cam);                       // 分格剔除 + 索引打包（每帧入口）
  renderer.render(scene, cam);
  const g = renderer.getContext();
  const raw = new Uint8Array(640 * 360 * 4);
  g.readPixels(0, 0, 640, 360, g.RGBA, g.UNSIGNED_BYTE, raw);
  let visible = 0;
  for (let i = 0; i < raw.length; i += 4) if (raw[i] + raw[i + 1] + raw[i + 2] > 8) visible++;
  await logLine(`[smoke] 图 ${mapId}: 可见像素 ${visible}/230400，draw=${renderer.info.render.triangles}tri`
    + `，glError=${g.getError()}（游戏默认配置：雾 2400/3000 开、无 alpha 补丁）`);
  unloadDecor([], scene);
  b.dispose();
  renderer.dispose();
  return visible;
}

interface ExistingIndex {
  scale?: number;
  format?: string;
  maps?: { id: number }[];
}

/** 读该目录已有的 index.json（它描述的是**整个集合**：统一比例尺 + 统一格式） */
async function readExistingIndex(outDir: string, log: (m: string) => Promise<void>): Promise<ExistingIndex | null> {
  const url = `/res/${outDir}/index.json`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      await log(`[bake] 读现有 index.json 失败: HTTP ${res.status}（按"空目录"处理）`);
      return null;
    }
    return await res.json() as ExistingIndex;
  } catch (err) {
    await log(`[bake] 读现有 index.json 异常: ${String(err)}（按"空目录"处理）`);
    return null;
  }
}

export async function runBake(opts: BakeOptions): Promise<BakeRecord[]> {
  const { ids, scale, outDir } = opts;
  const logPath = `${outDir}/${opts.logFile ?? '_bake.log'}`;
  const logger = makeLogger(logPath);
  const logLine = logger.log;
  const say = opts.onProgress ?? (() => {});
  const format = opts.format ?? 'png';

  // ⚠ 一致性闸门：index.json 是整个集合的元数据（统一比例尺 + 统一格式）。
  // 单张重烘**覆盖**它，会让页面按错的 scale/format 去读，表现成"图全没了"
  // （2026-09-15 实测：一次 ?maps=0&scale=8&format=png 把 63 张 webp 的 index 覆盖成 1 条）。
  // 所以：要么参数与现有一致（下面合并记录），要么**拒绝并说清**，绝不静默写坏。
  const existing = await readExistingIndex(outDir, logLine);
  await logLine(`[bake] 现有 index.json: ${existing?.maps?.length
    ? `${existing.maps.length} 张 1px/${existing.scale} ${existing.format ?? 'png'}`
    : '无/空'}；本次 ${ids.length} 张 1px/${scale} ${format}`);
  if (existing?.maps?.length && (existing.scale !== scale || (existing.format ?? 'png') !== format)) {
    throw new Error(`该目录已有 ${existing.maps.length} 张、1px/${existing.scale} 单位 ${existing.format ?? 'png'}；`
      + `本次是 1px/${scale} 单位 ${format} —— 混合比例尺/格式会破坏大地图的统一坐标，已拒绝写入。`
      + `要么用相同参数，要么换 --out 目录（若这个 index.json 本身已过期，删掉它再跑即可重来）。`);
  }

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    // toBlob 需要在同一帧读到后备缓冲；不开这个会拿到全透明图
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  const maxSide = renderer.capabilities.maxTextureSize;

  const records: BakeRecord[] = [];
  await logLine(`bake 开始：${ids.length} 张，scale=1px/${scale} 单位，GPU 单边上限 ${maxSide}`);

  // 管线自检：清成绿色 → 读回。读回的若是绿的，说明 GPU/上下文/readPixels 这一路是通的，
  // 后面出空图就只能是取景或几何的问题；否则是环境问题（软件 WebGL/无头上下文）。
  {
    const g = renderer.getContext();
    renderer.setSize(8, 8, false);
    renderer.setClearColor(0x00ff00, 1);
    renderer.clear();
    const one = new Uint8Array(4);
    g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, one);
    const err = g.getError();
    await logLine(`自检: 清屏读回=(${one[0]},${one[1]},${one[2]},${one[3]})`
      + ` drawingBuffer=${g.drawingBufferWidth}x${g.drawingBufferHeight} glError=${err}`
      + (one[1] > 200 ? ' ✓ 管线正常' : ' ✗ 帧缓冲读不到内容'));
    renderer.setClearColor(0x000000, 0);
  }

  for (const id of ids) {
    const t0 = performance.now();
    const notes: string[] = [];
    const field = fieldOf(id);
    const smd = mapSmdPath(id);
    if (!field || !smd) {
      await logLine(`[${id}] 跳过：fields.json 里没有这张图（smd=${smd}）`);
      continue;
    }

    const scene = new THREE.Scene();
    let mh: Awaited<ReturnType<typeof loadMap>> = null;
    let decorGroups: THREE.Group[] = [];
    try {
      // 取景用的 AABB 由几何本身给出（不依赖外部表）；先加载再量。
      // ⚠ 单图超时：无头下偶发"worker 解析不返回"（间歇、不可复现），先前表现为整轮静默停在这里
      //   —— 超时把它变成一条**可见的失败**，而不是让整轮装作没发生。
      mh = await Promise.race([
        loadMap(scene, smd),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`加载超时 ${MAP_TIMEOUT_MS}ms（无头下 worker 解析偶发不返回）`)), MAP_TIMEOUT_MS)),
      ]);
      if (!mh) throw new Error('loadMap 返回 null（构建被取消或素材缺失）');

      const decors = mapDecorList(id);
      if (decors.length > 0) {
        decorGroups = await loadMapDecor(scene, id, decors, DECOR_COLOR);
        if (decorGroups.length !== decors.length) {
          notes.push(`装饰 ${decorGroups.length}/${decors.length} 个加载成功（其余缺失，见控制台 [decor] 警告）`);
        }
      }

      const b = mh.mapRenderer;
      // 关距离雾：它是第三人称用的（2400~3000 world 单位就全黑），俯视正交相机必然在 2km 外，
      // 不关整张图就是黑的。见 map-renderer.setFogRange。
      b.setFogRange(0, 0);
      // 贴图/顶点色的 alpha 在原引擎里不参与合成（游戏画布不透明，alpha 被忽略，所以那里无害）。
      // 烘图要 alpha 通道（图外透明），就必须显式把片元 alpha 置满 —— 否则读到的是"有颜色但全透明"。
      // 首次 render 才 compile shader，所以这里改 onBeforeCompile 还来得及。
      for (const mrd of b.materials) {
        const mat = mrd.mesh.material as THREE.MeshBasicMaterial;
        const orig = mat.onBeforeCompile.bind(mat);
        mat.onBeforeCompile = (shader, r): void => {
          orig(shader, r);
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            '#include <opaque_fragment>\n  gl_FragColor.a = 1.0;',
          );
        };
        mat.needsUpdate = true;
      }
      if (opts.dumpMaterials) {
        const foot = (b.worldMax[0] - b.worldMin[0]) * (b.worldMax[2] - b.worldMin[2]);
        const lines: string[] = [];
        for (let mi = 0; mi < b.materials.length; mi++) {
          const mrd = b.materials[mi];
          const sm = mh.data.materials[mrd.matIdx];
          const size = mrd.aabb.getSize(new THREE.Vector3());
          const pct = foot > 0 ? (size.x * size.z) / foot * 100 : 0;
          if (pct < 0.5 && !mrd.isWater) continue;   // 只看大块/水面
          lines.push(`mat${mrd.matIdx} ${(sm?.tex?.[0] ?? '(无)').padEnd(34)}`
            + ` 占${pct.toFixed(1).padStart(5)}% y=${mrd.aabb.min.y.toFixed(0)}..${mrd.aabb.max.y.toFixed(0)}`
            + ` blend=${sm?.blendType ?? '?'} transp=${sm?.transparency ?? '?'}`
            + ` wind=0x${((sm?.windMeshBottom ?? 0) >>> 0).toString(16)}`
            + `${mrd.isWater ? ' **水面**' : ''}${mrd.isTransparent ? ' 半透' : ''}`);
        }
        await logLine(`[${id}] 材质表（占图幅≥0.5% 或水面）:\n    ` + lines.join('\n    '));
      }

      // 材质剔除/保留（见 `planemap-exclusions.ts` 顶部说明）：
      //   ① 默认剔**引擎水面**（`isWater` = `windMeshBottom & 0x7FF == 0x200`）；
      //   ② **按贴图名整组剔** —— 一个水面常有多层材质、只有一层带标记，只剔带标记的会留残影；
      //   ③ 逐图逐贴图的显式覆盖表优先（这湖水要保留 / 这块背景板要剔除）。
      const mapFoot = (b.worldMax[0] - b.worldMin[0]) * (b.worldMax[2] - b.worldMin[2]);
      const byTex = new Map<string, { idxs: number[]; flagged: boolean; pct: number; y0: number; y1: number }>();
      for (const mrd of b.materials) {
        const tex = (mh.data.materials[mrd.matIdx]?.tex?.[0] ?? '(无贴图)').toLowerCase();
        const size = mrd.aabb.getSize(new THREE.Vector3());
        const pct = mapFoot > 0 ? (size.x * size.z) / mapFoot * 100 : 0;
        const g = byTex.get(tex);
        if (g) {
          g.idxs.push(mrd.matIdx);
          g.flagged ||= mrd.isWater;
          g.pct = Math.max(g.pct, pct);
          g.y0 = Math.min(g.y0, mrd.aabb.min.y);
          g.y1 = Math.max(g.y1, mrd.aabb.max.y);
        } else {
          byTex.set(tex, { idxs: [mrd.matIdx], flagged: mrd.isWater, pct, y0: mrd.aabb.min.y, y1: mrd.aabb.max.y });
        }
      }
      const hiddenInfo: string[] = [];
      const keptInfo: string[] = [];
      for (const [tex, g] of byTex) {
        const over = exclusionOf(id, tex);
        const action = opts.keepWater ? 'keep' : (over?.action ?? (g.flagged ? 'hide' : 'skip'));
        const desc = `${tex} 占图幅${g.pct.toFixed(1)}% y=${g.y0.toFixed(0)}..${g.y1.toFixed(0)} ${g.idxs.length}层`;
        if (action === 'hide') {
          for (const matIdx of g.idxs) {
            const mrd = b.materials.find((m) => m.matIdx === matIdx);
            if (mrd) scene.remove(mrd.mesh);
          }
          hiddenInfo.push(`${desc}${over ? `（覆盖表:${over.note}）` : g.flagged ? '（引擎水面）' : ''}`);
        } else if (action === 'keep' && over) {
          keptInfo.push(`${desc}（覆盖表:${over.note}）`);
        }
      }
      await logLine(`[${id}] 材质策略: 剔除 ${hiddenInfo.length} 组`
        + `${hiddenInfo.length ? ' → ' + hiddenInfo.join(' | ') : ''}`
        + `${keptInfo.length ? ' ；显式保留 → ' + keptInfo.join(' | ') : ''}`);
      if (hiddenInfo.length > 0 || keptInfo.length > 0) {
        if (hiddenInfo.length > 0) notes.push(`剔除 ${hiddenInfo.length} 组整片材质（不烘入）`);
        if (keptInfo.length > 0) notes.push(`保留 ${keptInfo.length} 组水面（覆盖表）`);
      }

      const minX = Math.min(b.worldMin[0], b.worldMax[0]);
      const maxX = Math.max(b.worldMin[0], b.worldMax[0]);
      const minZ = Math.min(b.worldMin[2], b.worldMax[2]);
      const maxZ = Math.max(b.worldMin[2], b.worldMax[2]);
      const minY = Math.min(b.worldMin[1], b.worldMax[1]);

      const w = Math.ceil((maxX - minX) / scale);
      const h = Math.ceil((maxZ - minZ) / scale);
      if (w <= 0 || h <= 0) throw new Error(`AABB 为空: ${maxX - minX} x ${maxZ - minZ}`);
      if (w > maxSide || h > maxSide) {
        throw new Error(`图幅 ${w}x${h} 超出 GPU 单边上限 ${maxSide} —— 请调大 scale`);
      }

      // 取景框取"整像素"边界：像素 (0,0) ↔ (minX, minZ)，比例尺严格等于 scale，
      // 不走样（AABB 比整像素略小的一点点留在图外，不进画面）。
      const fx0 = minX;
      const fz0 = minZ;
      const fx1 = minX + w * scale;
      const fz1 = minZ + h * scale;

      // 相机：俯视 −Y；up = −Z 让北朝上（与像素 (0,0)=西北角一致）。
      // 相机空间 X = world X（东在右），相机空间 Y = −world Z（北在上）。
      // ⚠ left/right/top/bottom 是**相对相机位置**的，不是世界坐标：相机放在取景框中心，
      //   所以这里必须给对称的半宽高（先前给绝对坐标 = 偏移算两次，整张图被推出画面）。
      const cx = (fx0 + fx1) / 2;
      const cz = (fz0 + fz1) / 2;
      const halfW = (fx1 - fx0) / 2;
      const halfD = (fz1 - fz0) / 2;
      const cam = new THREE.OrthographicCamera(-halfW, halfW, halfD, -halfD, 1, 1);
      const margin = 200000;   // world 单位（1 单位 = 1cm → 2km 余量，避免裁到高处的几何）
      cam.position.set(cx, mh.mapRenderer.worldMax[1] + margin, cz);
      cam.up.set(0, 0, -1);
      cam.lookAt(cx, 0, cz);
      cam.near = 1;
      cam.far = margin + (mh.mapRenderer.worldMax[1] - minY) + 4000;
      cam.updateProjectionMatrix();

      renderer.setSize(w, h, false);
      // 尺寸自检：整幅尺寸下清屏→读回。8×8 能读不代表 1021×1113 能读
      // （无头软件光栅在大尺寸下的帧缓冲分配是另一回事）。
      {
        const g = renderer.getContext();
        renderer.setClearColor(0x0000ff, 1);
        renderer.clear();
        const one = new Uint8Array(4);
        g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, one);
        await logLine(`[${id}] 整幅自检 ${w}x${h}: 清屏读回=(${one[0]},${one[1]},${one[2]},${one[3]})`
          + ` drawingBuffer=${g.drawingBufferWidth}x${g.drawingBufferHeight} glError=${g.getError()}`);
        renderer.setClearColor(0x000000, 0);
      }

      if (opts.debug) {
        // 红板：贴在地图中心、略高于最高几何。它若也没出现 → 问题在管线/读回，不在几何。
        const s = Math.min(fx1 - fx0, fz1 - fz0) * 0.2;
        const probe = new THREE.Mesh(
          new THREE.PlaneGeometry(s, s),
          new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide }),
        );
        probe.rotation.x = -Math.PI / 2;
        probe.position.set((fx0 + fx1) / 2, mh.mapRenderer.worldMax[1] + 500, (fz0 + fz1) / 2);
        scene.add(probe);
      }
      if (opts.probeOnly) {
        // 只画红板：把地图网格从场景摘掉（保留相机与尺寸），与上一种模式二分
        for (const mrd of mh.mapRenderer.materials) scene.remove(mrd.mesh);
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(fx1 - fx0, fz1 - fz0),
          new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide }),
        );
        plane.rotation.x = -Math.PI / 2;
        plane.position.set((fx0 + fx1) / 2, 0, (fz0 + fz1) / 2);
        scene.add(plane);
      }
      if (opts.override) {
        // 剪影模式：全场景换成纯白材质 —— 它有轮廓 = 几何/取景没问题，问题在材质；
        // 它也没有 = 问题在几何或深度。
        scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      }
      // ⚠ 必须先让 MapRenderer 跑一次"分格剔除 + 索引打包"（运行时是每帧做的，见 WorldView 渲染循环）：
      //   几何索引缓冲初始是空/全 0（退化三角形），只有它填完才真正画出面。
      //   它读 camera.matrixWorldInverse，所以先把相机矩阵算好。
      cam.updateMatrixWorld(true);
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      b.render(cam);
      renderer.render(scene, cam);
      const drawnCalls = renderer.info.render.calls;
      const drawnTris = renderer.info.render.triangles;

      // 读回用 gl.readPixels（不是 drawImage/toBlob 直接取 WebGL canvas）：
      // 无头模式下这个 canvas 从不进 DOM，合成路径拿不到像素 —— 实测读到的是全 0
      // （而 renderer.info 明明有 282 次 draw call）。readPixels 直接读帧缓冲，可靠。
      const gl = renderer.getContext();
      const raw = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);

      // OpenGL 原点在左下 → 翻成自上而下；同时统计不透明像素（0 = 空图 = 失败）
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const octx = out.getContext('2d', { willReadFrequently: true })!;
      const img = octx.createImageData(w, h);
      const rowBytes = w * 4;
      for (let y = 0; y < h; y++) {
        const src = (h - 1 - y) * rowBytes;
        img.data.set(raw.subarray(src, src + rowBytes), y * rowBytes);
      }
      let opaquePixels = 0;
      for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 8) opaquePixels++;
      let nonBlack = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i] + img.data[i + 1] + img.data[i + 2] > 8) nonBlack++;
      }
      // 判据用 RGB（不是 alpha）：PT 的贴图/顶点 alpha 在原引擎里不参与合成，
      // 只有"一个可见像素都没有"才是失败。
      if (nonBlack === 0) {
        throw new Error(`渲染结果全透明（drawCalls=${drawnCalls} tris=${drawnTris} 场景三角=${mh.mapRenderer.totalTriangleCount}）`
          + ` 相机 pos=(${cam.position.x.toFixed(0)},${cam.position.y.toFixed(0)},${cam.position.z.toFixed(0)})`
          + ` box=[${fx0.toFixed(0)},${fx1.toFixed(0)}]x[${fz0.toFixed(0)},${fz1.toFixed(0)}]`
          + ` y=[${minY.toFixed(0)},${mh.mapRenderer.worldMax[1].toFixed(0)}]`);
      }
      octx.putImageData(img, 0, 0);

      const fmt = opts.format ?? 'png';
      const mime = fmt === 'webp' ? 'image/webp' : 'image/png';
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, mime, opts.quality ?? 0.9));
      if (!blob) throw new Error(`toBlob 返回 null（format=${fmt}）`);
      await putFile(`${outDir}/${id}.${fmt}`, blob);

      // 交叉核对：烘焙取景的 AABB 与 fields.json 的 bounds 是否同源
      let aabbFields: BakeRecord['aabbFields'] = null;
      let aabbDeltaMax: number | null = null;
      const fb = (field as unknown as { bounds?: { minX: number; maxX: number; minZ: number; maxZ: number } }).bounds;
      if (fb) {
        aabbFields = { minX: fb.minX, minZ: fb.minZ, maxX: fb.maxX, maxZ: fb.maxZ };
        aabbDeltaMax = Math.max(
          Math.abs(fb.minX - minX), Math.abs(fb.maxX - maxX),
          Math.abs(fb.minZ - minZ), Math.abs(fb.maxZ - maxZ),
        );
        if (aabbDeltaMax > 1) {
          notes.push(`AABB 与 fields.json 相差 ${aabbDeltaMax.toFixed(1)} world 单位（取景按几何实际范围）`);
        }
      } else {
        notes.push('fields.json 没有 bounds，未做交叉核对');
      }

      const rec: BakeRecord = {
        id,
        shortname: field.shortname,
        minimap: field.minimap,
        smd,
        scale,
        w,
        h,
        aabb: { minX, minZ, maxX, maxZ },
        aabbFields,
        aabbDeltaMax,
        materials: mh.mapRenderer.materials.length,
        tris: mh.mapRenderer.totalTriangleCount,
        bytes: blob.size,
        drawnCalls,
        drawnTris,
        opaquePixels,
        decorTotal: mapDecorList(id).length,
        decorLoaded: decorGroups.length,
        ms: Math.round(performance.now() - t0),
        notes,
      };
      records.push(rec);
      say(`[${id}] ${field.shortname} ${w}x${h} tris=${rec.tris} 画出=${drawnTris}/${drawnCalls}call 可见=${nonBlack}px 不透明=${opaquePixels}px decor=${rec.decorLoaded}/${rec.decorTotal} ${rec.ms}ms`);
      await logLine(`[${id}] ${field.shortname} ${w}x${h} 完成 (${rec.ms}ms)`
        + ` draw=${drawnTris}tri/${drawnCalls}call 可见=${nonBlack}px 不透明=${opaquePixels}px`
        + (notes.length ? ` notes=${JSON.stringify(notes)}` : ''));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logLine(`[${id}] **失败** ${msg}`);
      say(`[${id}] 失败：${msg}`);
      records.push({
        id,
        shortname: field.shortname,
        minimap: field.minimap,
        smd,
        scale,
        w: 0,
        h: 0,
        aabb: { minX: 0, minZ: 0, maxX: 0, maxZ: 0 },
        aabbFields: null,
        aabbDeltaMax: null,
        materials: 0,
        tris: 0,
        bytes: 0,
        drawnCalls: 0,
        drawnTris: 0,
        opaquePixels: 0,
        decorTotal: mapDecorList(id).length,
        decorLoaded: 0,
        ms: Math.round(performance.now() - t0),
        notes: [`烘焙失败：${msg}`],
      });
    } finally {
      unloadDecor(decorGroups, scene);
      mh?.mapRenderer.dispose();
      scene.clear();
    }
  }

  // index.json = 大地图运行时的元数据（比例尺 / 图幅 / AABB / 备注）
  // 合并：本次没跑到的图保留原记录 —— index.json 描述的是**整个集合**，不能被单张重烘截断
  const ranIds = new Set(records.map((r) => r.id));
  const kept = (existing?.maps ?? []).filter((m) => !ranIds.has(m.id));
  const merged = [...kept, ...records].sort((a, b) => (a.id as number) - (b.id as number)) as BakeRecord[];
  const totalBytes = merged.reduce((s, r) => s + (r.bytes ?? 0), 0);
  const index = {
    note: '由 npm run bake-maps 生成；像素 (0,0) ↔ AABB 西北角(minX,minZ)，东=+X、北=−Z；1px = scale world 单位',
    scale,
    format,
    quality: opts.quality ?? 0.9,
    totalBytes,
    generatedAt: new Date().toISOString(),
    maps: merged,
  };
  await putFile(`${outDir}/index.json`, new Blob([JSON.stringify(index, null, 2)], { type: 'application/json' }));

  const failed = records.filter((r) => r.w === 0).length;
  // 每轮独立的完成标记：脚本按它验收（**不要**拿 index.json 当"本轮完成"信号 ——
  // 它开跑前就存在，会把上一轮的记录当成本轮结果，静默报"成功"）。
  const marker = {
    runId: opts.logFile ?? '',
    ok: records.length - failed,
    failed,
    requested: ids.length,
    bakedIds: records.filter((r) => r.w > 0).map((r) => r.id).sort((a, b) => a - b),
    failedIds: records.filter((r) => r.w === 0).map((r) => r.id).sort((a, b) => a - b),
    finishedAt: new Date().toISOString(),
  };
  await putFile(`${outDir}/${(opts.logFile ?? '_bake.log').replace(/\.log$/, '')}.done.json`,
    new Blob([JSON.stringify(marker, null, 2)], { type: 'application/json' }));
  await logLine(`bake 结束：本次成功 ${records.length - failed} / 失败 ${failed}`
    + `；index.json 现有 ${merged.length} 张（本次新增/更新 ${records.length}，保留 ${kept.length}）`
    + `；合计 ${(totalBytes / 1048576).toFixed(1)} MB（scale=1px/${scale} 单位，format=${format}）`);
  renderer.dispose();
  return records;
}
