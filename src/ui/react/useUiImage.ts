import { useEffect, useState } from 'react';
import { loadUiImage } from '../../render/ui-texture.js';

/**
 * `/res` 贴图 → dataURL 的 React hook（PT 的 TGA/BMP 浏览器不能直接解码，走 loadUiImage）。
 * loadUiImage 内部有缓存与并发合并：多个组件请求同一张图只加载一次。
 * 失败返回 null —— 调用方按"贴图缺失"显式处理（不编替代图，AGENTS #12）。
 */
export function useUiImageUrl(path: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadUiImage(path).then((img) => {
      if (alive) setUrl(img ? img.src : null);
    });
    return () => { alive = false; };
  }, [path]);
  return url;
}
