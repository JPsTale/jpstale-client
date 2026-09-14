/// <reference lib="webworker" />
/**
 * SMD 解析 Worker —— 把"取二进制 + 解析"整段搬出主线程。
 *
 * 为什么值得：`parseSMD` 是纯 CPU 工作（实测一张 5.6MB 地图 14.5ms），而它原先跑在**切图那一刻**
 * 的主线程上 —— 玩家感受到的就是"切图后头几帧发涩"。这里连同 `cachedFetch`（内存 + IndexedDB 缓存）
 * 一起搬过来，主线程在弱网下也不会因为等 IO 而卡渲染。
 *
 * 产出：`SMDData`（TypedArray 走 transfer 零拷贝；materials/lights/bounds 走结构化克隆）。
 * 不做的：`CollisionMesh` / `MapRenderer` —— 前者依赖对象数组、后者产出 three 对象，都留在主线程
 * （构建过程已分帧，见 `buildAsync` / `buildFromSMDAsync`）。
 */
import { cachedFetch, assetProgress } from '../core/asset-cache.js';
import { parseSMD } from '../core/smd-parser.js';

interface ParseRequest {
  id: number;
  url: string;
}

const post = (msg: unknown, transfer?: Transferable[]): void => {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
};

/**
 * 把本 Worker 已加载的字节上报给主线程。
 *
 * 为什么需要：Worker 有**自己的模块实例**，这里的 `cachedFetch` 与主线程那份统计互不相通 ——
 * 而进图的大头（SMD）恰好都在这里下载。不上报的话，主线程那行"已加载"会长期偏低
 * （用户 2026-09-14 实测：Network 显示已传输 48.1MB，加载页只显示 3.7MB）。
 * 只上报**增量**，用主线程现成的 `noteCacheHitBytes` 累加即可（那边只管加进"已加载总量"）。
 */
let reportedBytes = 0;
function reportLoadedBytes(): void {
  const loaded = assetProgress().bytesLoaded;
  if (loaded <= reportedBytes) return;
  post({ id: -1, bytes: loaded - reportedBytes });
  reportedBytes = loaded;
}

self.onmessage = async (e: MessageEvent<ParseRequest>) => {
  const { id, url } = e.data;
  try {
    const buf = await cachedFetch(url);
    reportLoadedBytes();
    const data = parseSMD(buf);
    post({ id, ok: true, data }, [
      data.verts.buffer,
      data.vertColors.buffer,
      data.triIdx.buffer,
      data.faceMat.buffer,
      data.faceTexLink.buffer,
      data.texUVs.buffer,
      data.faceLightmapUV.buffer,
    ]);
  } catch (err) {
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
