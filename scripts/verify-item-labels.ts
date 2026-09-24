/**
 * verify-item-labels —— 掉落物名牌防重叠布局（src/ui/item-label-layout.ts）的机器验收。
 *
 * 验的是**真模块**（import 后真调用），不是读源码字符串。断言四件事：
 *  1. 永不重叠（同点堆叠 / 大规模散布两套场景）；
 *  2. 同点物品纵向"摞"（D2/POE 手感）：自下而上、缝隙恒为 PILL_STACK_GAP；
 *  3. 顶部放不下时改为向下挤，仍不重叠、不出屏幕顶；
 *  4. 确定性：同输入两次调用逐字段相等（显示要可复现，同 AGENTS #12 纪律）。
 */

import {
  layoutItemLabels, PILL_STACK_GAP, PILL_ANCHOR_LIFT,
  type LabelCandidate, type LabelRect,
} from '../src/ui/item-label-layout.js';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) { pass++; console.log('  ok   ' + msg); }
  else { fail++; console.error('  FAIL ' + msg); }
}

function pairwiseNoOverlap(rects: LabelRect[], label: string): void {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      if (overlap) {
        ok(false, `${label}: #${i} 与 #${j} 重叠 a=${JSON.stringify(a)} b=${JSON.stringify(b)}`);
        return;
      }
    }
  }
  ok(true, `${label}: ${rects.length} 块两两不重叠`);
}

const W = 120, H = 18; // 典型掉落物名牌块尺寸

// ---- 场景 1：同锚点 8 个候选 → 纵向堆叠 ----
{
  const n = 8;
  const cands: LabelCandidate[] = Array.from({ length: n }, (_, i) => ({ x: 640, y: 400, w: W, h: H }));
  const rects = layoutItemLabels(cands);
  pairwiseNoOverlap(rects, '同点堆叠');
  // 自下而上"摞"：输入顺序 = 放置顺序（锚点相同按输入序），第 i 块在默认位上方 i 层
  const lift = PILL_ANCHOR_LIFT;
  ok(Math.abs(rects[0].y - (400 - lift - H)) < 1e-9, '同点堆叠: 第 1 块在默认位（底边贴锚点上方 lift）');
  let stacked = true;
  for (let i = 1; i < n; i++) {
    if (Math.abs(rects[i].y - (rects[i - 1].y - H - PILL_STACK_GAP)) > 1e-9) { stacked = false; break; }
  }
  ok(stacked, `同点堆叠: 其余块逐层抬升，层间距 = h + ${PILL_STACK_GAP}px`);
  ok(rects.every(r => Math.abs(r.x - (640 - W / 2)) < 1e-9), '同点堆叠: x 居中于锚点不变（只纵向挤）');
}

// ---- 场景 2：确定性伪随机散布 400 个候选（含近距/同点/边缘）→ 全体不重叠 ----
{
  let seed = 20260924;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  const cands: LabelCandidate[] = Array.from({ length: 400 }, () => ({
    x: Math.round(rnd() * 1280),
    y: Math.round(rnd() * 720),
    w: 60 + Math.round(rnd() * 120),
    h: H,
  }));
  const rects = layoutItemLabels(cands);
  pairwiseNoOverlap(rects, '大规模散布(400)');
  ok(rects.every(r => r.y >= 2 - 1e-9), '大规模散布: 无一块越出屏幕顶（y >= 2）');
  // 确定性：同输入再跑一遍逐字段相等
  seed = 20260924;
  const cands2: LabelCandidate[] = Array.from({ length: 400 }, () => ({
    x: Math.round(rnd() * 1280),
    y: Math.round(rnd() * 720),
    w: 60 + Math.round(rnd() * 120),
    h: H,
  }));
  const rects2 = layoutItemLabels(cands2);
  ok(rects.every((r, i) => r.x === rects2[i].x && r.y === rects2[i].y && r.w === rects2[i].w && r.h === rects2[i].h),
    '确定性: 同输入两次调用布局完全一致');
}

// ---- 场景 3：锚点贴屏幕顶（y 很小）→ 改为向下挤，仍不重叠、不出顶 ----
{
  const cands: LabelCandidate[] = Array.from({ length: 6 }, () => ({ x: 300, y: 12, w: W, h: H }));
  const rects = layoutItemLabels(cands);
  pairwiseNoOverlap(rects, '贴顶向下挤');
  ok(rects.every(r => r.y >= 2 - 1e-9), '贴顶向下挤: 无一块越出屏幕顶');
  // 默认位 12-4-18=-10 < 2 ⇒ 触发向下分支：第 1 块从锚点处起（y=12），其余依次向下摞
  ok(rects[0].y === 12, '贴顶向下挤: 第 1 块从锚点处起（挂到锚点之下）');
  let down = true;
  for (let i = 1; i < rects.length; i++) {
    if (Math.abs(rects[i].y - (rects[i - 1].y + H + PILL_STACK_GAP)) > 1e-9) { down = false; break; }
  }
  ok(down, `贴顶向下挤: 其余块逐层下摞，层间距 = h + ${PILL_STACK_GAP}px`);
}

// ---- 场景 4：单候选 → 默认位 ----
{
  const rects = layoutItemLabels([{ x: 100, y: 200, w: W, h: H }]);
  ok(rects.length === 1
    && Math.abs(rects[0].x - (100 - W / 2)) < 1e-9
    && Math.abs(rects[0].y - (200 - PILL_ANCHOR_LIFT - H)) < 1e-9,
    '单候选: 落默认位（x 居中、底边贴锚点上方 lift）');
}

// ---- 场景 5：水平相邻但实际不重叠的两块 → 互不干扰（不瞎挤） ----
{
  const rects = layoutItemLabels([
    { x: 100, y: 200, w: W, h: H },
    { x: 100 + W + 20, y: 200, w: W, h: H }, // 水平间距 20 > 0，矩形不相交
  ]);
  ok(Math.abs(rects[0].y - rects[1].y) < 1e-9 && Math.abs(rects[1].y - (200 - PILL_ANCHOR_LIFT - H)) < 1e-9,
    '水平不重叠的两块: 都在默认位（只挤真冲突）');
}

console.log(`\n掉落物名牌布局：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
