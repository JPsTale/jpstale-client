/**
 * PT 加密 TGA 图标的 React 装载钩子（`/res/**` → cachedFetch → decodeTextureAsync → DataTexture
 * → 转 data-URL 给 `<img>`）。与 `useItemImg`（未加密 PNG/BMP 走 transparentBmp）互补：
 * `keep/` 下的技能 buff 图标是**加密 TGA**（如 `Pr3_V_LIFE.tga`），必须走纹理解码器。
 *
 * 失败显式（控制台 warn + 返回 null，调用方不渲染该图标）—— 不放破图。
 */
import { useEffect, useState } from 'react';
import { cachedFetch } from '../../core/asset-cache.js';
import { decodeTextureAsync } from '../../core/texture.js';

const cache = new Map<string, string>();

export function useTextureImg(url: string | null): string | null {
  const [src, setSrc] = useState<string | null>((url && cache.get(url)) ?? null);
  useEffect(() => {
    if (!url) { setSrc(null); return; }
    const hit = cache.get(url);
    if (hit) { setSrc(hit); return; }
    let alive = true;
    void (async () => {
      try {
        const buf = await cachedFetch(url, 'texture');
        const d = await decodeTextureAsync(buf);
        if (!d) { console.warn('[useTextureImg] 解码失败', url); return; }
        const canvas = document.createElement('canvas');
        canvas.width = d.width;
        canvas.height = d.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(d.pixels), d.width, d.height), 0, 0);
        const dataUrl = canvas.toDataURL();
        cache.set(url, dataUrl);
        if (alive) setSrc(dataUrl);
      } catch (e) {
        console.warn('[useTextureImg] 加载失败', url, e);
      }
    })();
    return () => { alive = false; };
  }, [url]);
  return src;
}
