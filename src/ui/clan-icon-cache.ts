// 公会图标（ClanImage/<编号>.bmp）的**共享加载缓存**。
//
// 两个消费方：WorldView 的名牌（canvas，每帧直读）与 CharStatusPanel（React，
// 需要加载完成的通知）。所以这里只做"字节→HTMLImageElement + 缓存 + 加载完成通知"，
// 不含任何绘制 —— 画法两边各自实现（canvas drawImage / <img>）。
//
// 资产：`/res/image/clanimage/mark/<id>.bmp`（32×32 明文 BMP；2026-09-25 并入资产根
// 353 个，覆盖活库全部在用值）。资产缺（404/解码失败）= 缓存 null = **显式没有**，
// 调用方不画图标即可 —— 不许拿别的图顶（AGENTS #12）。
import { fetchAsset } from '../core/asset-manager.js';
import { decodeTextureAsync } from '../core/texture.js';

export interface ClanIcon {
    el: HTMLImageElement;
    w: number;
    h: number;
}

const cache = new Map<string, ClanIcon | null>();   // markId → 图标；null = 资产缺
const pending = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
    for (const cb of [...listeners]) cb();
}

function load(markId: string): void {
    if (cache.has(markId) || pending.has(markId)) return;
    pending.add(markId);
    void (async () => {
        try {
            const buf = await fetchAsset(`/res/image/clanimage/mark/${markId}.bmp`, 'texture:ui');
            const decoded = await decodeTextureAsync(buf);
            if (!decoded) {
                cache.set(markId, null);
                return;
            }
            const c = document.createElement('canvas');
            c.width = decoded.width;
            c.height = decoded.height;
            c.getContext('2d')!.putImageData(
                new ImageData(new Uint8ClampedArray(decoded.pixels), decoded.width, decoded.height), 0, 0);
            const el = new Image();
            el.src = c.toDataURL();
            await new Promise<void>((r) => { el.onload = () => r(); el.onerror = () => r(); });
            cache.set(markId, { el, w: decoded.width, h: decoded.height });
        } catch {
            cache.set(markId, null);   // 资产缺（404 等）—— 显式记 null
        } finally {
            pending.delete(markId);
            notify();
        }
    })();
}

/**
 * 取公会图标；未加载则**启动加载**并返回 null（调用方下一帧/下一次通知再取）。
 * 返回 null 的两种含义用 `has` 区分：false = 还在加载；true 且 null = 资产缺。
 */
export function getClanIcon(markId: string): { icon: ClanIcon | null; has: boolean } {
    if (!markId) return { icon: null, has: true };
    let v = cache.get(markId);
    if (v === undefined) {
        load(markId);
        return { icon: null, has: false };
    }
    return { icon: v, has: true };
}

/** 加载完成通知（React 侧重渲染用；canvas 侧每帧直读不需要）。 */
export function subscribeClanIcons(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}
