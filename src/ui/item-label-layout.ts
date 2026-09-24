/**
 * 掉落物名牌的防重叠布局（纯函数，**唯一实现**；`WorldView.drawNameplateOverlay` 的掉落物段调用）。
 *
 * 目标（用户 2026-09-24，对齐暗黑2 / POE 的手感）：同一处多个掉落物的名字**永不互相遮挡**，
 * 而是"挤"开 —— 纵向堆叠（同点物品自下而上摞），顶到屏幕上沿放不下时改为向下挤。
 *
 * 确定性：按锚点 (y, x, 输入序) 排序后顺序放置，无随机 —— 同样的输入永远得到同样的布局
 * （与"检查器/诊断不得随机"同一纪律，显示也要可复现）。
 */

export interface LabelCandidate {
  /** 锚点（物品头顶）在 overlay 上的屏幕坐标 */
  x: number;
  y: number;
  /** 名牌块尺寸（调用方用与绘制同一份的测量 `pillBlockSize` 得出） */
  w: number;
  h: number;
}

export interface LabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 挤开后牌子间的垂直缝隙（px） */
export const PILL_STACK_GAP = 2;

/** 锚点上方留白 —— 与 `drawPill` 无条时的 `blockBottom = y - 4` 同式（改要两处一起改） */
export const PILL_ANCHOR_LIFT = 4;

/** 屏幕顶部安全边：向上挤会越过这条线时，改为向下挤 */
const SCREEN_TOP_SAFE = 2;

function rectsOverlap(a: LabelRect, b: LabelRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * 逐个放置候选名牌，**按输入顺序**返回每块的屏幕矩形（x,y = 左上角）。
 * 矩形 x 居中于锚点；默认底边贴锚点上方 {@link PILL_ANCHOR_LIFT}，与被叠块冲突时
 * 抬到其上方（纵向"摞"）；向上会越出屏幕顶时改为**向下**挤：从
 * `max(屏幕顶安全线, 锚点)` 起步，冲突压到被叠矩形下方（锚点在屏幕上部时名牌挂到锚点之下）。
 */
export function layoutItemLabels(items: LabelCandidate[]): LabelRect[] {
  const order = items
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.y - b.c.y || a.c.x - b.c.x || a.i - b.i);
  const placed: LabelRect[] = [];
  const result: LabelRect[] = new Array(items.length);
  for (const { c, i } of order) {
    const rectAt = (top: number): LabelRect => ({ x: c.x - c.w / 2, y: top, w: c.w, h: c.h });
    // 先按默认位（锚点上方）尝试，冲突则抬到被叠矩形上方；单调上移，guard 防御性封顶
    let top = c.y - PILL_ANCHOR_LIFT - c.h;
    for (let guard = 0; guard <= placed.length && placed.some(p => rectsOverlap(rectAt(top), p)); guard++) {
      for (const p of placed) {
        if (rectsOverlap(rectAt(top), p)) {
          top = p.y - PILL_STACK_GAP - c.h;
        }
      }
    }
    if (top < SCREEN_TOP_SAFE) {
      // 向上会被屏幕顶裁掉 → 改为向下挤：起点 = 屏幕顶安全线与锚点的较大者
      //（锚点本身很靠上时名牌挂到锚点之下，不会再产生 <2 的落点），冲突则压到被叠矩形下方
      top = Math.max(SCREEN_TOP_SAFE, c.y);
      for (let guard = 0; guard <= placed.length && placed.some(p => rectsOverlap(rectAt(top), p)); guard++) {
        for (const p of placed) {
          if (rectsOverlap(rectAt(top), p)) {
            top = p.y + p.h + PILL_STACK_GAP;
          }
        }
      }
    }
    const r = rectAt(top);
    placed.push(r);
    result[i] = r;
  }
  return result;
}
