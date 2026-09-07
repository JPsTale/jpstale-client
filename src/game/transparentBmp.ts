// 原版技能/武器图标 BMP 的黑色背景透明化。
// PWM 素材的 bmp 是 24bit 无 alpha：图标本体（六边形/正方形内容）外是纯黑背景。
// PT 渲染管线把黑色当透明色，浏览器 <img> 不会自动这样处理，
// 所以用 canvas 把近似黑的像素置为全透明，返回 dataURL 复用（带缓存）。

const cache = new Map<string, string>();

/** 纯黑背景判据：三个通道的亮部都极低。背景 max≈0；图标暗部如 (22,27,41) max=41 完整保留。 */
const BG_CHANNEL_MAX = 24;

/**
 * 加载 /res bmp → 黑色透明化 → 返回 dataURL（png）。
 * 只把「几乎纯黑」的像素置为全透明，图标本体（含暗部/抗锯齿灰阶）全部保留，
 * 图标六边形轮廓因此由 alpha 直接呈现。需要 Canvas API；失败返回 null。
 */
export function transparentBmp(url: string): Promise<string | null> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w * h > 1_000_000) {
          // 大图不做透明化，保留原样
          resolve(null);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, w, h);
        const data = id.data;
        let changed = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (Math.max(r, g, b) <= BG_CHANNEL_MAX) {
            data[i + 3] = 0;
            changed++;
          }
        }
        if (changed === 0) {
          resolve(null);
          return;
        }
        ctx.putImageData(id, 0, 0);
        let tries = 0;
        const flush = () => {
          try {
            const url2 = canvas.toDataURL('image/png');
            cache.set(url, url2);
            resolve(url2);
          } catch (e) {
            tries++;
            if (tries < 3) {
              setTimeout(flush, 50);
            } else {
              resolve(null);
            }
          }
        };
        flush();
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}