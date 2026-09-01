/**
 * Asset Cache — 缓存已下载的 ArrayBuffers，避免重复网络请求
 */
const cache = new Map<string, ArrayBuffer>();

export async function cachedFetch(url: string): Promise<ArrayBuffer> {
  const cached = cache.get(url);
  if (cached) return cached.slice(0); // 返回副本，防止外部修改
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  const buf = (await resp.arrayBuffer()).slice(0);
  cache.set(url, buf);
  return buf;
}

export function preloadAssets(urls: string[]): Promise<void[]> {
  return Promise.all(urls.map(async (url) => {
    try { await cachedFetch(url); } catch {}
  }));
}

export function cacheSize(): number { return cache.size; }
