/**
 * Map Preload — 启动时后台预加载全部地图数据（SMD + 纹理）。
 * 对齐 preloadAllModels 的模式：进图时 loadMap 命中缓存快速构建，无下载等待。
 * 限量并发（CONCURRENCY=3）避免一次性下载 44 张图纹理冲击网络/解码线程。
 */
import { MAP_CATALOG } from './map-catalog.js';
import { preloadMapData } from './fore1.js';

const CONCURRENCY = 3;

export async function preloadAllMaps(onProgress?: (loaded: number, total: number) => void): Promise<void> {
  const ids = Object.keys(MAP_CATALOG).map(Number);
  let count = 0;
  const worker = async (id: number) => {
    const rel = MAP_CATALOG[id];
    try {
      await preloadMapData('/res/field/' + rel);
    } catch (e) {
      console.warn(`[map-preload] failed to preload map ${id} (${rel}):`, e);
    }
    count++;
    onProgress?.(count, ids.length);
  };
  const queue = [...ids];
  const runners: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
    runners.push((async () => {
      while (queue.length) {
        const id = queue.shift()!;
        await worker(id);
      }
    })());
  }
  await Promise.all(runners);
}
