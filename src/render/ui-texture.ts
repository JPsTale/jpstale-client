/**
 * 界面纹理加载（PT 加密 TGA/BMP → 可直接 `drawImage` 的 `HTMLImageElement`）。
 *
 * 为什么需要它：界面用的图标（`image/arrow.tga`、`npc.tga`、`party.tga`、`mapbox.tga`…）都是
 * **PT 自己的加密格式**，浏览器解不了 —— 必须先 `fetchAsset` 拿字节、`decodeTextureAsync` 解码、
 * 贴进 canvas、再转成 `Image`。
 *
 * ⚠ 这套流程原先**只写在 `WorldView` 的 `ensureMMImg` 里**（场内小地图用）。大地图也要画同一批图标，
 * 就地再抄一份 = 两份实现必然漂移（AGENTS #15）。所以抽到这里，两边共用。
 *
 * 带缓存（同一 URL 只解一次）与并发合并（同一 URL 同时请求只跑一趟）。
 */
import { fetchAsset } from '../core/asset-manager.js';
import { decodeTextureAsync } from '../core/texture.js';

const cache = new Map<string, HTMLImageElement | null>();   // null = 试过且失败（不重复试）
const inflight = new Map<string, Promise<HTMLImageElement | null>>();

/** 取一张界面纹理；拿不到/解不开返回 null（由调用方决定怎么上报，这里不静默兜底画东西） */
export function loadUiImage(url: string): Promise<HTMLImageElement | null> {
    if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null);
    const running = inflight.get(url);
    if (running) return running;
    const p = (async (): Promise<HTMLImageElement | null> => {
        try {
            // 走 AssetManager（缓存 + 按 kind 统计）
            const buf = await fetchAsset(url, 'texture:ui');
            // dev 服务器对缺失文件回退成 index.html(200)；按魔数排除
            if (buf.byteLength === 0 || new Uint8Array(buf)[0] === 0x3c /* '<' */) return null;
            const dec = await decodeTextureAsync(buf);
            if (!dec) return null;
            const c = document.createElement('canvas');
            c.width = dec.width;
            c.height = dec.height;
            c.getContext('2d')!.putImageData(
                new ImageData(new Uint8ClampedArray(dec.pixels), dec.width, dec.height), 0, 0);
            const img = new Image();
            img.src = c.toDataURL();
            await new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); });
            return img.naturalWidth > 0 ? img : null;
        } catch {
            return null;
        }
    })();
    inflight.set(url, p);
    return p.then((img) => {
        cache.set(url, img);
        inflight.delete(url);
        return img;
    });
}

/**
 * 把一张图**染色**（保留形状的 alpha，颜色换成 `color`）。
 *
 * 用途：怪物标记 —— 原版小地图**不画怪物**（`DrawMapNPC` 只遍历 `smCHAR_STATE_NPC`），
 * 也没有怪物专用的图标资产；我们沿用同一张 8×8 点图染红来区分（"染红"这个做法在
 * 原版源码里有先例：队友过远时 `D3DCOLOR_RGBA(255,0,0,255)`）。
 *
 * ⚠ 返回的是 **canvas 而不是 Image**，这是有意的：`Image` 走 `src=` 就得**异步解码**，
 * 在解码完成前 `drawImage` 画上去是**空的**（不报错、不抛异常）。实战症状：染色过的怪物/队友
 * 标记在某些帧上"看不见"，而原色图标（经 `loadUiImage` 等过 onload）正常；诊断时随手加一句
 * `getImageData` 读取就"好了"——那是同步读取顺带把解码推完了，纯属时序假象。
 * canvas 作为 `drawImage` 的源是**同步可用**的，一次消掉整类问题。
 */
export function tintUiImage(img: HTMLImageElement, color: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-in';   // 只保留原形状，颜色换成 fill
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
}
