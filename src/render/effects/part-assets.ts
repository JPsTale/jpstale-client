/**
 * `.part` 粒子资产加载 —— 脚本解析 + 纹理解码，带缓存与诊断。
 *
 * 纹理路径直接写在脚本里（如 "effect\\particle\\flare.tga"），按资产根解析即可。
 * 与 INI 特效的链路不同：`.part` 自带发射参数，不需要 ImageData 那一层。
 */
import type * as THREE from 'three';
import { cachedFetch } from '../../core/asset-cache.js';
import { fetchAndDecodeTexture } from '../char-texture-loader.js';
import { parsePart, type PartSystem } from '../../core/effect/part-script.js';

export interface LoadedPart {
  name: string;
  system: PartSystem;
  /** 各 emitter 的纹理（按 emitter 下标；解码失败为 null） */
  textures: Array<THREE.DataTexture | null>;
  diag: {
    scriptPath: string;
    emitterCount: number;
    textures: Array<string | null>;
    missing: string[];
  };
}

/**
 * `.part` 脚本有两处、且名字集合不同，两处都要找：
 *   1. `effect/particle/script/`  经典脚本（401 个，如 aging / blood1 / power1）
 *   2. `game/scripts/particles/`  较新脚本（106 个，如 ac5fiercewind / ks5holyconviction）
 */
export function partScriptPaths(name: string): string[] {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
  const n = base.replace(/\.part$/i, '').toLowerCase();
  return [`effect/particle/script/${n}.part`, `game/scripts/particles/${n}.part`];
}

function normalizeTexturePath(raw: string): string {
  return raw.replace(/\\+/g, '/').replace(/^\/+/, '').toLowerCase();
}

async function fetchText(url: string): Promise<string | null> {
  try {
    return new TextDecoder('utf-8').decode(await cachedFetch(url));
  } catch {
    return null;
  }
}

const cache = new Map<string, Promise<LoadedPart | null>>();

export function loadPart(name: string): Promise<LoadedPart | null> {
  const key = partScriptPaths(name)[0]!;
  const hit = cache.get(key);
  if (hit) return hit;
  const job = loadPartUncached(name).catch(() => null);
  cache.set(key, job);
  return job;
}

async function loadPartUncached(name: string): Promise<LoadedPart | null> {
  for (const scriptPath of partScriptPaths(name)) {
    const text = await fetchText('/res/' + scriptPath);
    if (text === null) continue;
    const system = parsePart(text);
    // 文件不存在时 dev server 会落到 SPA 兜底返回 200 + HTML（不是 404），
    // 解析出来是空系统 —— 视为"此处没有"，继续找下一处。
    if (system.emitters.length === 0) continue;

    const textures: Array<THREE.DataTexture | null> = [];
    const paths: Array<string | null> = [];
    const missing: string[] = [];
    for (const em of system.emitters) {
      if (!em.texture) { textures.push(null); paths.push(null); continue; }
      const p = normalizeTexturePath(em.texture);
      paths.push(p);
      const tex = await fetchAndDecodeTexture('/res/' + p);
      if (!tex) missing.push(p);
      textures.push(tex);
    }

    return {
      name,
      system,
      textures,
      diag: { scriptPath, emitterCount: system.emitters.length, textures: paths, missing },
    };
  }
  return null;
}
