/**
 * Model Cache — 启动时预加载全部职业的 骨架+身体+头部。
 *
 * 实际的 THREE 对象缓存（promise 防重入）在 char-loader.ts 内：
 *  - getSkeleton(jobId)  ：bip 骨骼+动画（全脸共享）
 *  - getBody(jobId)      ：职业身体（只构建一次）
 *  - getHead(jobId,face) ：头部（切换头型只构建头）
 *
 * 这里只负责触发预加载，供 main.ts 在登录后调用。
 * 角色创建/选择页通过 getSkeleton/getBody/getHead 直接命中缓存，
 * 切换头型不再重载身体。
 */
import { getSkeleton, getBody, getHead } from './char-loader.js';

export { isPreloaded } from './char-loader.js';

export function preloadCharacter(jobId: number, onProgress?: () => void): Promise<void> {
  return Promise.all([
    getSkeleton(jobId),
    getBody(jobId),
    getHead(jobId, 0),
    getHead(jobId, 1),
    getHead(jobId, 2),
  ]).then(() => onProgress?.());
}

export async function preloadAllModels(onProgress?: (loaded: number, total: number) => void): Promise<void> {
  const jobIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  let count = 0;
  await Promise.all(jobIds.map(async (jobId) => {
    try {
      await preloadCharacter(jobId);
    } catch (e) {
      console.warn(`[model-cache] failed to preload job ${jobId}:`, e);
    }
    count++;
    onProgress?.(count, jobIds.length);
  }));
}

