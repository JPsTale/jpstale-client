/**
 * Model Cache — 预加载职业的 骨架+身体+头部。
 *
 * 实际的 THREE 对象缓存（promise 防重入）在 char-loader.ts 内：
 *  - getSkeleton(jobId)  ：bip 骨骼+动画（全脸共享）
 *  - getBody(jobId)      ：职业身体（只构建一次）
 *  - getHead(jobId,face) ：头部（切换头型只构建头）
 *
 * ⚠ **2026-09-14：启动不再调用它**（用户："不要登录之前就加载一堆东西"）。
 * `preloadAllModels` 要把 10 个职业的完整骨架全下完（8 组动画包合计 162MB）才让登录页出现；
 * 现在登录页只等背景图，选角/创建角色预览走 lite 包（`render/lite-loader.ts`，每组 ~300KB），
 * 进图时才拉自机那**一个**职业的完整包。
 * `preloadCharacter` 仍可用于"进图前定向预热某个职业"；`preloadAllModels` 目前**无调用者**，
 * 留作将来"游玩中后台预载"的入口。
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

