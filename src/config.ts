/**
 * 运行环境配置。
 * <p>
 * 从 .env / .env.local 读取（VITE_ 前缀），供应用各处引用。
 * 单一入口：不要到处散落 import.meta.env 读取，统一走这里。
 */

export interface Env {
  /** HTTP API base（pt-web-server，含 context-path /pt，不含 /api） */
  apiBase: string;
  /** 资产 URL base（dev 由 vite 中间件映射 /res，生产指向部署位置） */
  assetBase: string;
}

/** 拼接完整 API 路径，如 api('/api/user/me') -> http://192.168.31.10:8080/pt/api/user/me */
export function api(path: string): string {
  return env.apiBase + path;
}

export const env: Env = {
  apiBase: import.meta.env.VITE_API_BASE as string,
  assetBase: import.meta.env.VITE_ASSET_BASE as string,
};
