/**
 * SMD 解析入口（主线程侧）—— Worker 优先，不可用则主线程兜底。
 *
 * 调用方只管 `await parseSMDAsync(url)`，不关心解析在哪跑。
 * 降级**必须可见**（纠错 #12）：Worker 起不来时会 `reportFallback` 说明"退回主线程解析"，
 * 否则弱网/低端机上的卡顿会被误当成"本来就该卡"。
 */
import { parseSMD, type SMDData } from '../core/smd-parser.js';
import { cachedFetch } from '../core/asset-cache.js';
import { reportFallback } from '../char/fallback-log.js';

interface Pending {
  resolve: (d: SMDData) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, Pending>();

function failAll(err: Error): void {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function ensureWorker(): Worker | null {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./smd-parse.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; data?: SMDData; error?: string }>) => {
      const { id, ok, data, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok && data) p.resolve(data);
      else p.reject(new Error(error || 'worker parse failed'));
    };
    worker.onerror = (e) => {
      // Worker 整体挂了（打包路径不对/CSP/浏览器不支持）→ 标记并回退，别反复起
      workerBroken = true;
      worker = null;
      reportFallback('asset', `SMD 解析 Worker 不可用（${e.message || 'onerror'}）→ 退回主线程解析（地图加载会占用主线程）`);
      failAll(new Error('worker unavailable'));
    };
  } catch (err) {
    workerBroken = true;
    worker = null;
    reportFallback('asset', `SMD 解析 Worker 创建失败（${err instanceof Error ? err.message : String(err)}）→ 退回主线程解析`);
  }
  return worker;
}

/** 主线程兜底（Worker 不可用时） */
async function parseOnMainThread(url: string): Promise<SMDData> {
  return parseSMD(await cachedFetch(url));
}

/**
 * 解析一张 SMD（带缓存：Worker 侧命中 IndexedDB 时不起网络请求）。
 * @param url 形如 `/res/field/desert/de-3.smd`
 */
export async function parseSMDAsync(url: string): Promise<SMDData> {
  const w = ensureWorker();
  if (!w) return parseOnMainThread(url);
  const id = ++seq;
  return new Promise<SMDData>((resolve, reject) => {
    pending.set(id, {
      resolve,
      // 单张图解析失败（网络/格式）→ 让调用方决定；不静默换成主线程重试（那会掩盖真正的原因）
      reject,
    });
    w.postMessage({ id, url });
  });
}
