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
import { cachedFetch } from '../core/asset-cache.js';
import { parseSMD } from '../core/smd-parser.js';

interface ParseRequest {
  id: number;
  url: string;
}

const post = (msg: unknown, transfer?: Transferable[]): void => {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
};

self.onmessage = async (e: MessageEvent<ParseRequest>) => {
  const { id, url } = e.data;
  try {
    const buf = await cachedFetch(url);
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
