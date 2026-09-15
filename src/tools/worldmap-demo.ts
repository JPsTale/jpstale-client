/**
 * 大地图 demo 宿主（`worldmap.html`）—— 不进游戏就能看/调地图组件。
 *
 * 组件本体在 `src/ui/WorldMap.ts`（游戏与这里**同一份实现**）。这个页面只做两件事：
 *   ① 挂载组件；② URL 带状态便于分享/截图
 *      （`?level=1&region=kelvezu` / `?level=2&map=3`、`?focus=1`、`?revealAll=1`、`?playerMap=`）。
 *
 * ⚠ **这里不再有自检**（原来有 147 条断言）。删掉的理由（用户 2026-09-16：
 *   "删掉那些破自检，你什么都没检出来"）：它每条都过，却漏掉了"地图被世界层盖住、
 *   屏幕上一个像素都看不见"。两个原因，都不是"覆盖不够"能补的：
 *   · 它比的是**组件自己记账的 z-index 数字**（当时是正常的 103），而故障出在
 *     "容器 `z-index:auto` → 整层被 `#world-root{z-index:50}` 盖住"这一层，数字上看不出来；
 *   · 它跑在这个 demo 页里，而**这里没有世界层** —— "被世界层盖住"这个场景在它的世界里
 *     根本不存在。在一个简化世界里验证正确性，回到真实游戏就失效。
 *   要验证就用**真实游戏环境**（临时无头脚本 / 实机），别再养这种给人假安全感的东西。
 */
import { FIELDS } from '../maps/map-data.js';
import { layerOf, groupById } from '../maps/planemap-regions.js';
import { createWorldMap } from '../ui/WorldMap.js';
import { installLayerStack } from '../ui/layerStack.js';

interface Box { minX: number; minZ: number; maxX: number; maxZ: number }

const q = new URLSearchParams(location.search);
const host = document.getElementById('host')!;

// demo 页没有 `#app`，层栈直接装在 body 上（与游戏内 main.ts 同一套实现）
installLayerStack(document.body);

// 给 host 一个"窗口般"的盒子：地图内容根是 `position:absolute; inset:0`，
// 需要一个有定位、有尺寸的父级才铺得开。
// ⚠ 游戏里这层盒子由 `PanelShell` 提供（地图现在是普通面板 `panel:worldmap`）；
//   demo 页**只渲染内容**，所以这里手工摆一个等价盒子 —— 不是第二套窗口实现，只是 demo 的容器。
host.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);'
  + ' width:min(1280px,92vw); height:min(860px,88vh); overflow:hidden;'
  + ' background:#0d1117f2; border:1px solid #2b3542; border-radius:6px; box-shadow:0 10px 34px #0009;';
const bigMap = createWorldMap(host, {
  assetDir: q.get('out') ?? 'image/planemap',
  // 默认与**游戏侧一致**（副本/战场不上世界图、也不列出来）；验收要看全部 63 张才传 ?revealAll=1
  revealAll: q.get('revealAll') === '1',
  openAtPlayer: q.get('openAtPlayer') === '1',
  // 玩家标记：默认放在 #3 里查顿城中心（演示"你在这"）；?player=0 关掉、playerX/Z/Angle= 指定
  getPlayer: q.get('player') === '0' ? undefined : () => {
    const pid = Number(q.get('playerMap') ?? 3);
    const b = (FIELDS.find((f) => f.id === pid) as unknown as { bounds?: Box } | undefined)?.bounds;
    return {
      mapId: pid,
      x: q.get('playerX') !== null ? Number(q.get('playerX')) : b ? (b.minX + b.maxX) / 2 : undefined,
      z: q.get('playerZ') !== null ? Number(q.get('playerZ')) : b ? (b.minZ + b.maxZ) / 2 : undefined,
      angle: q.get('playerAngle') !== null ? Number(q.get('playerAngle')) : 0.6,
    };
  },
});
bigMap.show();

// URL 初始状态：?level=1&region=kelvezu、?level=2&map=3
const lv = Number(q.get('level') ?? '0');
const rid = q.get('region');
const mid = Number(q.get('map') ?? '');
if (lv === 1 && rid && groupById(rid)) bigMap.goTo({ level: 1, groupId: rid, mapId: null });
else if (lv === 2 && Number.isInteger(mid)) {
  const g = layerOf(mid);
  bigMap.goTo({ level: 2, groupId: (g?.id ?? 'continent'), mapId: mid });
}
