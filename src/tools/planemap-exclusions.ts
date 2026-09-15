/**
 * 平面图烘焙的**材质剔除/保留**清单（逐图逐贴图）。
 *
 * 为什么要这张表（都是实测出来的）：
 *   · 引擎的水面标记是 `windMeshBottom & 0x7FF == 0x200`（运行时拿它做水波），
 *     但**一个水面常由多层材质组成，只有其中一层带这个标记** —— 只剔带标记的那层，
 *     图上会留下"残影"（`#17 morion1` 实测：`sea_0.BMP` 两层，mat258 带标记、mat259 不带）。
 *     所以剔除按**贴图名**整组进行。
 *   · 有些整片材质不是水，但在地图上也毫无意义（`#28 iron-2` 周围那片"黑液"= 原版缩略图里
 *     画成青色水纹的那块背景板）—— 这类只能逐图指认，没有可用的通用判据。
 *   · 有些水**必须保留**：沙漠中的水源（`#10 desert2` 的 `wa01.bmp`）、
 *     整张图就是湖（`#34 greedy` 的 `sea_0.BMP`）—— 剔了就看不出是湖。
 *
 * 键取**贴图名**而不是 `matIdx`：matIdx 是材质数组下标，smd 一改版就变；贴图名是数据本身。
 * 每条都必须写 `note`（依据），没写清依据的不要往这里加。
 */
export interface MaterialExclusion {
  mapId: number;
  /** 贴图名（不区分大小写，含扩展名，如 `sea_0.bmp`） */
  texture: string;
  /** hide = 不烘进平面图；keep = 即使是引擎水面也保留 */
  action: 'hide' | 'keep';
  note: string;
}

export const EXCLUSIONS: MaterialExclusion[] = [
  // ── 保留：用户 2026-09-15 看过图后指定 ────────────────────────────
  { mapId: 10, texture: 'wa01.bmp', action: 'keep', note: '沙漠中的水源（绿洲）—— 剔了沙漠中心就是空的（用户 2026-09-15）' },
  { mapId: 34, texture: 'sea_0.bmp', action: 'keep', note: '整张图就是这座湖 —— 剔了看不出是湖（用户 2026-09-15）' },

  // ── 剔除：整片背景板/非水材质 ──────────────────────────────────
  // #28 iron-2 周围那片"黑液"：原版 A 族缩略图里这同一块是青色水纹（见 docs 的对照方法），
  // 没有水面标记，靠贴图名指认。
  { mapId: 28, texture: 'irk036.bmp', action: 'hide', note: '铁矿山周围整片"黑液"背景板（用户 2026-09-15 要求剔除）' },
];

/**
 * 查这张图上某贴图该怎么办：'hide' | 'keep' | null（未指定 → 走默认规则）。
 * ⚠ 比对用**文件名**（basename），因为 smd 里存的是全路径（`field\desert\wa01.bmp`），
 *   而且不同副本的目录大小写/前缀不一致 —— 表里只写文件名最稳。
 */
function baseName(tex: string): string {
  const i = Math.max(tex.lastIndexOf('\\'), tex.lastIndexOf('/'));
  return (i >= 0 ? tex.slice(i + 1) : tex).toLowerCase();
}

export function exclusionOf(mapId: number, texture: string): MaterialExclusion | null {
  const t = baseName(texture);
  return EXCLUSIONS.find((e) => e.mapId === mapId && baseName(e.texture) === t) ?? null;
}
