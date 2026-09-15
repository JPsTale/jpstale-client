/**
 * 大地图 demo / 验收宿主（`worldmap.html`）。
 *
 * 组件本体在 `src/ui/WorldMap.ts`（游戏与这里**同一份实现**）。这个页面只做三件事：
 *   ① 挂载组件（FF14 风格窗口）；② URL 带状态便于分享/截图；③ `?selftest=1` 走一遍状态机 + 窗口行为。
 *
 * 自检**不调内部函数**（除读取状态的公开 API）：鼠标动作一律派发**真实事件**
 * （pointerdown/pointerup/click/contextmenu），测的是真输入链路。
 */
import { FIELDS } from '../maps/map-data.js';
import {
  WORLD_MAP_IDS, ALL_LAYERS, OFFWORLD_GROUPS, CONTINENT_GROUP, layerOf, groupById, checkGroups,
} from '../maps/planemap-regions.js';
import { createWorldMap, mapLabelOf, shouldDrawMapLabels } from '../ui/WorldMap.js';
import { loadUiImage, tintUiImage } from '../render/ui-texture.js';
import { bringToFront, isTopLayer, layerZIndex, installLayerStack, registerElement, listLayers } from '../ui/layerStack.js';
import { createReactPanels } from '../ui/react/mount.js';
import { openPanel, closePanel, closeAllPanels } from '../app/gameStore.js';
import levelData from '../maps/map-levels.generated.json';

interface Box { minX: number; minZ: number; maxX: number; maxZ: number }

const q = new URLSearchParams(location.search);
const host = document.getElementById('host')!;
const warn = document.getElementById('selftest')!;

// 层栈：验收页没有 `#app`，直接装在 body 上（与游戏内 main.ts 同一套实现）
installLayerStack(document.body);
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

// 无头截图里没有鼠标 → 窗口永远是"非激活"（控件隐藏）。想看"浮着的竖条"长什么样就传 ?focus=1
if (q.get('focus') === '1') {
  bigMap.el.querySelector('.jp-wm-win')?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
}

// ── 真实事件小工具 ────────────────────────────────────────────────
const winEl = (): HTMLElement => bigMap.el.querySelector('.jp-wm-win')!;
const cv = (): HTMLCanvasElement => bigMap.el.querySelector('canvas')!;

function pev(type: string, target: EventTarget, x: number, y: number, button = 0): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button }));
}

/** 在画布上按世界坐标点一下（pointerdown → pointerup → click） */
function clickWorld(x: number, z: number): void {
  const c = cv();
  const r = c.getBoundingClientRect();
  const [sx, sy] = bigMap.worldToScreen(x, z);
  pev('pointerdown', c, r.left + sx, r.top + sy);
  pev('pointerup', window, r.left + sx, r.top + sy);
  c.dispatchEvent(new MouseEvent('click', {
    bubbles: true, clientX: r.left + sx, clientY: r.top + sy, button: 0,
  }));
}

/** 右键 = 上升 */
function rightClick(): void {
  cv().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
}

/** 在某元素上按下并拖动 (dx,dy) */
function dragBy(el: Element, fromX: number, fromY: number, dx: number, dy: number): void {
  const r = el.getBoundingClientRect();
  const x0 = r.left + fromX, y0 = r.top + fromY;
  pev('pointerdown', el, x0, y0);
  pev('pointermove', window, x0 + dx, y0 + dy);
  pev('pointerup', window, x0 + dx, y0 + dy);
}

function btnByText(text: string): HTMLButtonElement | undefined {
  return [...bigMap.el.querySelectorAll<HTMLButtonElement>('.jp-wm-btn')]
    .find((b) => b.textContent === text);
}

/** 大陆层成员应当不重叠且都在野外集合里（自检用的小校验） */
function WEBGL_SAFE(ids: number[]): boolean {
  return ids.every((id) => layerOf(id)?.id === 'continent');
}

async function selftest(): Promise<void> {
  const lines: string[] = [];
  const expect = (what: string, ok: boolean): void => { lines.push(`${ok ? 'PASS' : 'FAIL'} ${what}`); };
  // **先等底图**：合成点/读像素都要求底图已解码（否则画布上是占位色，断言会变成掷骰子）
  await bigMap.whenImagesReady();
  const st = (): ReturnType<typeof bigMap.getState> => bigMap.getState();
  const box = (id: number): Box => (FIELDS.find((f) => f.id === id) as unknown as { bounds: Box }).bounds;
  const center = (id: number): [number, number] => {
    const b = box(id);
    return [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  };

  // ── 层级与导航（区域层点图直接进单图）──────────────────────────
  bigMap.goTo({ level: 1, groupId: 'continent', mapId: null });
  clickWorld(...center(2));
  expect('大陆上点 fore-1 → 到地图 #2', st().level === 2 && st().mapId === 2 && st().groupId === 'continent');
  rightClick();
  expect('右键 → 回大陆', st().level === 1 && st().groupId === 'continent');
  expect('区域层已是顶层（右键不再往上）', st().level === 1);
  clickWorld(...center(10));
  expect('大陆上点 desert2 → 到地图 #10', st().level === 2 && st().mapId === 10);

  for (const g of ALL_LAYERS) {
    bigMap.goTo({ level: 1, groupId: g.id, mapId: null });
    expect(`${g.name} 区域层平铺（${g.mapIds.length} 张）`, st().level === 1 && st().groupId === g.id);
    const id = g.mapIds[1] ?? g.mapIds[0];
    clickWorld(...center(id));
    expect(`${g.name} 平铺处点 #${id} → 进该地图`, st().level === 2 && st().mapId === id);
    rightClick();
    expect(`${g.name} 右键 → 回该区域`, st().level === 1 && st().groupId === g.id);
  }


  // ── 图上要不要标名字：单图层不标（名字在左上角面包屑上）──────────
  expect('单图层不在图上标名字（名字在左上角）', shouldDrawMapLabels(1, true) === false);
  expect('区域层（多张）要标名字', shouldDrawMapLabels(24, true) === true);
  expect('文字开关关掉时一律不标', shouldDrawMapLabels(24, false) === false);

  // ── 只画这一层自己的图（单图层只有它自己，不画邻近、不画边框）──────
  bigMap.goTo({ level: 2, groupId: 'continent', mapId: 3 });
  expect('单图层只画自己那一张（不画邻近地图）', bigMap.getDrawnMapIds().join() === '3');
  bigMap.goTo({ level: 2, groupId: 'prison', mapId: 13 });
  expect('副本单图层也只画自己', bigMap.getDrawnMapIds().join() === '13');
  bigMap.goTo({ level: 1, groupId: 'continent', mapId: null });
  expect(`区域层画该区域全部（大陆 ${WORLD_MAP_IDS.length} 张）`,
    bigMap.getDrawnMapIds().length === WORLD_MAP_IDS.length);

  // ── 窗口：拖动 / 改大小 / 关闭 ──────────────────────────────────
  bigMap.goTo({ level: 1, groupId: 'continent', mapId: null });
  const r0 = bigMap.getWindowRect();
  dragBy(bigMap.el.querySelector('.jp-wm-title')!, 40, 10, 60, 40);
  const r1 = bigMap.getWindowRect();
  expect(`窗口可拖动（标题栏 x ${r0.x}→${r1.x}）`,
    Math.abs(r1.x - (r0.x + 60)) <= 2 && Math.abs(r1.y - (r0.y + 40)) <= 2);
  dragBy(bigMap.el.querySelector('.jp-wm-grip')!, 8, 8, 80, 50);
  const r2 = bigMap.getWindowRect();
  expect(`窗口可改大小（右下角 w ${r1.w}→${r2.w}）`, r2.w >= r1.w + 70 && r2.h >= r1.h + 40);
  bigMap.setWindowRect(r0);   // 复位

  const closeBtn = btnByText('×');
  expect('关闭按钮存在', !!closeBtn);
  closeBtn?.click();
  expect('× → 关闭窗口', !bigMap.visible);
  bigMap.show();
  expect('重新打开', bigMap.visible);

  // ── 竖条：上级 / 复位 / 半透明 / 图标 / 文字 / 比例尺 ───────────
  bigMap.setDimUnfocused(true);
  bigMap.redraw();
  expect('竖条 3：非激活半透明默认开着', bigMap.isDimUnfocused() === true);
  // ⚠ 读 `style.opacity`（我设的内联值）而不是 getComputedStyle —— 后者在 CSS 过渡期间
  //   会返回中间值（0.62 之类），断言必假失败。
  expect(`半透明生效于窗口（opacity=${winEl().style.opacity}）`, Number(winEl().style.opacity) < 1);
  const stripEl = bigMap.el.querySelector<HTMLElement>('.jp-wm-strip')!;
  expect('非激活时左侧控件隐藏（visibility: hidden）',
    getComputedStyle(stripEl).visibility === 'hidden');
  expect('非激活时右下角拉伸手柄也隐藏',
    getComputedStyle(bigMap.el.querySelector<HTMLElement>('.jp-wm-grip')!).visibility === 'hidden');
  // 鼠标进窗口 = 激活 → 控件回来
  winEl().dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
  expect('激活后左侧控件回来', getComputedStyle(stripEl).visibility === 'visible');
  expect('激活后不透明', winEl().style.opacity === '1');
  winEl().dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
  expect('再次失焦 → 又隐藏', getComputedStyle(stripEl).visibility === 'hidden');
  bigMap.setDimUnfocused(false);
  expect('关掉后 100% 不透明', winEl().style.opacity === '1');
  expect('关掉后控件常驻（失焦也不隐藏）', getComputedStyle(stripEl).visibility === 'visible');

  bigMap.setLabels(false);
  expect('竖条 5：文字开关生效（关）', bigMap.isLabelsOn() === false);
  bigMap.setLabels(true);
  expect('文字开关生效（开）', bigMap.isLabelsOn() === true);

  bigMap.setPoiMode('off');
  expect('竖条 4：图标开关（关 → 0 个）', bigMap.getPois().length === 0);
  bigMap.setPoiMode('gates');

  // 上级地图：野外图 → 它的家族/大陆；副本 → 无作用
  bigMap.goTo({ level: 2, groupId: 'continent', mapId: 3 });   // 里查顿（大陆）
  expect('竖条 1：里查顿 → 大陆（层级，不是世界）',
    bigMap.getParentTarget()?.level === 1 && bigMap.getParentTarget()?.groupId === 'continent');
  bigMap.goTo({ level: 2, groupId: 'federation', mapId: 45 }); // 亚特兰蒂斯
  expect('竖条 1：亚特兰蒂斯 → 神秘联邦',
    bigMap.getParentTarget()?.level === 1 && bigMap.getParentTarget()?.groupId === 'federation');
  bigMap.goTo({ level: 2, groupId: 'lostisle', mapId: 37 });   // 迷失岛
  expect('竖条 1：迷失岛 → 迷失岛',
    bigMap.getParentTarget()?.level === 1 && bigMap.getParentTarget()?.groupId === 'lostisle');
  bigMap.goTo({ level: 2, groupId: 'prison', mapId: 13 });     // 副本
  expect('竖条 1：在副本里 → 无作用（按钮禁用）', bigMap.getParentTarget() === null);
  expect('竖条 1：副本里那颗按钮确实 disabled', btnByText('↑')?.disabled === true);
  bigMap.goTo({ level: 1, groupId: 'continent', mapId: null });
  expect('竖条 1：区域层已是顶层 → 无作用', bigMap.getParentTarget() === null);
  expect('竖条 1：区域层那颗按钮也 disabled', btnByText('↑')?.disabled === true);
  bigMap.goTo({ level: 2, groupId: 'continent', mapId: 3 });
  expect('竖条 1：大陆上的图 → 大陆（按钮可用）',
    bigMap.getParentTarget()?.groupId === 'continent' && btnByText('↑')?.disabled === false);

  // 复位到我：位置居中，**缩放不变**
  bigMap.goTo({ level: 2, groupId: 'continent', mapId: 3 });
  const zoomBefore = bigMap.getZoom();
  dragBy(cv(), 20, 20, 120, 90);            // 先把画面拖走
  bigMap.centerOnPlayer();
  const p3 = (FIELDS.find((f) => f.id === 3) as unknown as { bounds: Box }).bounds;
  const [pcx, pcy] = bigMap.worldToScreen((p3.minX + p3.maxX) / 2, (p3.minZ + p3.maxZ) / 2);
  const cw = cv().clientWidth, ch = cv().clientHeight;
  expect(`竖条 2：复位把我放到画面中央（${Math.round(pcx)},${Math.round(pcy)} vs ${Math.round(cw / 2)},${Math.round(ch / 2)}）`,
    Math.abs(pcx - cw / 2) < 3 && Math.abs(pcy - ch / 2) < 3);
  expect('竖条 2：同一张图内复位**不改缩放**', Math.abs(bigMap.getZoom() - zoomBefore) < 1e-6);
  // 玩家在别的图上 → 复位要**连图一起切过去**（不是只移坐标）
  bigMap.goTo({ level: 2, groupId: 'continent', mapId: 10 });   // 打开的是 desert2
  bigMap.centerOnPlayer();                                      // 玩家在 #3（里查顿城）
  expect('竖条 2：打开 A 图时复位 → 切到玩家所在的 #3',
    st().level === 2 && st().mapId === 3 && st().groupId === 'continent');
  bigMap.goTo({ level: 2, groupId: 'prison', mapId: 13 });       // 打开副本
  bigMap.centerOnPlayer();                                       // 玩家仍在 #3
  expect('竖条 2：在副本里复位 → 切回玩家所在的 #3（区域也换回大陆）',
    st().level === 2 && st().mapId === 3 && st().groupId === 'continent');
  bigMap.goTo({ level: 1, groupId: 'federation', mapId: null }); // 打开神秘联邦区域
  bigMap.centerOnPlayer();
  expect('竖条 2：在别的区域复位 → 也切回玩家所在的 #3',
    st().level === 2 && st().mapId === 3);

  // 比例尺范围：4 ~ 128 单位/px（用户定），滑块顶/底分别触到两端
  bigMap.focusMap(3);
  const trk0 = bigMap.el.querySelector<HTMLElement>('.jp-wm-track')!;
  const rt = trk0.getBoundingClientRect();
  pev('pointerdown', trk0, rt.left + 3, rt.top + 2);
  expect(`滑块顶端 = 8 单位/px（实测 ${Math.round(bigMap.getZoom())}）`, Math.round(bigMap.getZoom()) === 8);
  pev('pointerdown', trk0, rt.left + 3, rt.bottom - 2);
  expect(`滑块底端 = 128 单位/px（实测 ${Math.round(bigMap.getZoom())}）`, Math.round(bigMap.getZoom()) === 128);
  bigMap.focusMap(3);   // 复位到取景缩放：后面的滑块断言假设起始不在两端

  // 比例尺滑块：拖动改变缩放，+ / − 按钮也改
  const track = bigMap.el.querySelector<HTMLElement>('.jp-wm-track')!;
  const tr = track.getBoundingClientRect();
  const z0 = bigMap.getZoom();
  pev('pointerdown', track, tr.left + 3, tr.top + 4);           // 拖到最上端 = 最大
  const zTop = bigMap.getZoom();
  expect(`竖条 6：滑块拖到顶端 → 放大（rect ${Math.round(tr.left)},${Math.round(tr.top)} ${Math.round(tr.width)}x${Math.round(tr.height)}；zoom ${z0.toFixed(2)}→${zTop.toFixed(2)}）`,
    zTop < z0);
  pev('pointerdown', track, tr.left + 3, tr.bottom - 4);        // 拖到最下端 = 最小
  expect('竖条 6：滑块拖到底端 → 缩小', bigMap.getZoom() > z0);
  // 滑块上的比例读数：文字 = 当前 zoom（单位/像素），且随缩放更新
  const valEl = bigMap.el.querySelector<HTMLElement>('.jp-wm-scaleval')!;
  expect('滑块上显示当前比例（xx 单位/px）', /^\d+ 单位\/px$/.test(valEl.textContent ?? ''));
  bigMap.focusMap(3);
  const zRead = bigMap.getZoom();
  expect(`读数与当前缩放一致（${valEl.textContent} vs ${zRead.toFixed(1)}）`,
    valEl.textContent === `${Math.round(zRead)} 单位/px`);
  btnByText('+')?.click();
  expect(`缩放后读数跟着变（${valEl.textContent}）`,
    valEl.textContent === `${Math.round(bigMap.getZoom())} 单位/px`);
  btnByText('−')?.click();

  bigMap.focusMap(3);
  const z1 = bigMap.getZoom();
  btnByText('+')?.click();
  expect('竖条 6：+ 按钮放大', bigMap.getZoom() < z1);
  btnByText('−')?.click();
  expect('竖条 6：− 按钮缩小', Math.abs(bigMap.getZoom() - z1) < 1e-6);

  // 坐标：右下 = 玩家，右上 = 鼠标
  const selfTxt = bigMap.el.querySelector('.jp-wm-coord.self')!.textContent ?? '';
  expect(`右下角显示玩家坐标 ${selfTxt}`, /^\(-?\d+, -?\d+\)$/.test(selfTxt));
  const cr = cv().getBoundingClientRect();
  pev('pointermove', cv(), cr.left + 40, cr.top + 40);
  const mouseTxt = bigMap.el.querySelector('.jp-wm-coord.mouse')!.textContent ?? '';
  expect(`右上角显示鼠标世界坐标 ${mouseTxt}`, /^\(-?\d+, -?\d+\)$/.test(mouseTxt));

  // 左侧那列地图名字已删
  expect('左侧地图名字列表已删除（没有 .jp-wm-side）', !bigMap.el.querySelector('.jp-wm-side'));

  // ── 点位：传送门 / 出生点 ──────────────────────────────────────
  bigMap.setPoiMode('off');
  expect('点位=关 → 0 个', bigMap.getPois().length === 0);
  bigMap.goTo({ level: 2, groupId: 'continent', mapId: 3 });
  bigMap.setPoiMode('gates');
  const gates = bigMap.getPois();
  expect(`点位=传送门 → 单图层 ${gates.length} 个（只含传送门）`,
    gates.length > 0 && gates.every((p) => p.kind === 'gate'));
  expect('传送门带目的地信息（悬停提示用）', gates.some((p) => (p.to?.length ?? 0) > 0));
  bigMap.setPoiMode('all');
  const all = bigMap.getPois();
  expect(`点位=全部 → 多出出生点（${gates.length} → ${all.length}）`,
    all.length > gates.length && all.some((p) => p.kind === 'start'));
  // 区域层（多图）= "世界地图"那一层：**任何图例都不画**，只留地图名字与角色位置
  bigMap.setPoiMode('all');
  bigMap.goTo({ level: 1, groupId: 'continent', mapId: null });
  expect('区域层不画任何图例（传送门/出生点都不画）', bigMap.getPois().length === 0);
  expect('区域层图例也不显示',
    getComputedStyle(bigMap.el.querySelector<HTMLElement>('.jp-wm-legend')!).display === 'none');
  bigMap.goTo({ level: 1, groupId: 'prison', mapId: null });
  expect('副本的区域层同样不画图例', bigMap.getPois().length === 0);
  bigMap.setPoiMode('gates');
  bigMap.goTo({ level: 2, groupId: 'continent', mapId: 3 });
  expect('回到单图层才画点位', bigMap.getPois().length > 0);

  // ── 等级门显示规则 ─────────────────────────────────────────────
  expect('等级门显示：#13 古代监狱F1（40）', mapLabelOf(13, '古代监狱F1').endsWith('（40）'));
  expect('等级门显示：#35 冰封圣殿（90）', mapLabelOf(35, '冰封圣殿').endsWith('（90）'));
  expect('等级门显示：无限制的图不加括号', !mapLabelOf(3, '里查顿城').includes('（'));
  const levels = levelData.levels as Record<string, number>;
  expect('等级门数据覆盖 63 张', FIELDS.every((f) => levels[String(f.id)] !== undefined));

  // ── 可见性：只有野外层级 + 玩家当前所在的副本 ──────────────────
  // 用一个**独立的**组件实例（不干扰上面那个 revealAll 的），测真实游戏侧配置
  {
    const probeHost = document.createElement('div');
    document.body.appendChild(probeHost);
    const eb3 = (FIELDS.find((f) => f.id === 3) as unknown as { bounds: Box }).bounds;
    const mk = (mapId: number) => createWorldMap(probeHost, {
      getPlayer: () => ({ mapId }), revealAll: false, openAtPlayer: true,
    });
    /** 同 mk，但玩家位置由外部闭包给（测"跟随换图"要能改 mapId） */
    const mkWith = (get: () => { mapId: number; x: number; z: number }) => createWorldMap(probeHost, {
      getPlayer: get, revealAll: false, openAtPlayer: true,
    });
    const wildIds = ALL_LAYERS.filter((g) => g.wild).map((g) => g.id);
    expect(`野外层级 = 大陆 + 迷失岛 + 神秘联邦（共 ${wildIds.length} 个）`,
      wildIds.length === 3 && wildIds.includes('continent') && wildIds.includes('lostisle') && wildIds.includes('federation'));

    // 游戏侧口径（revealAll=false）：世界图只有野外图 —— 点在副本坐标上不该进副本
    const probe = mk(3);
    probe.goTo({ level: 1, groupId: 'continent', mapId: null });
    const b36 = (FIELDS.find((f) => f.id === 36) as unknown as { bounds: Box }).bounds;
    const c36: [number, number] = [(b36.minX + b36.maxX) / 2, (b36.minZ + b36.maxZ) / 2];
    const pc = probe.el.querySelector('canvas')!;
    const [sx36, sy36] = probe.worldToScreen(...c36);
    const rr = pc.getBoundingClientRect();
    const ev = { bubbles: true, cancelable: true, clientX: rr.left + sx36, clientY: rr.top + sy36, button: 0 };
    pc.dispatchEvent(new PointerEvent('pointerdown', ev));
    window.dispatchEvent(new PointerEvent('pointerup', ev));
    pc.dispatchEvent(new MouseEvent('click', ev));
    expect('世界图不含非野外地图（点 #36 坐标不会进 #36）', probe.getState().mapId !== 36);
    probe.destroy();

    const onField = mk(3);   // 站在里查顿城（大陆野外）
    expect('在野外时：副本层级不出现（只有野外层级可见）',
      onField.getVisibleGroups().every((g) => g.wild));
    onField.show();
    expect('M 一打开就在"我在的地方"（#3 单图，区域=大陆）',
      onField.getState().level === 2 && onField.getState().mapId === 3 && onField.getState().groupId === 'continent');
    onField.destroy();

    const inDungeon = mk(13);   // 站在古代监狱F1
    const vis = inDungeon.getVisibleGroups();
    expect('在副本里时：所属层级出现', vis.some((g) => g.id === 'prison'));
    expect('在副本里时：别的副本仍不出现',
      !vis.some((g) => ['cursedtemple', 'darktemple', 'endlesstower', 'kelvezu', 'blessedcastle', 'battlefields', 'newworlds', 'misc'].includes(g.id)));
    expect('在副本里时：大陆/迷失岛/神秘联邦照常可见',
      ['continent', 'lostisle', 'federation'].every((id2) => vis.some((g) => g.id === id2)));
    inDungeon.show();
    expect('M 一打开就在该副本（#13 单图，且带所属层级）',
      inDungeon.getState().level === 2 && inDungeon.getState().mapId === 13 && inDungeon.getState().groupId === 'prison');
    inDungeon.destroy();

    // ── 跟随换图：玩家跑到别的地图 → 显示切过去（用户 2026-09-15 报的 bug）──
    {
      let pid = 3;
      const follow = mkWith(() => ({ mapId: pid, x: (eb3.minX + eb3.maxX) / 2, z: (eb3.minZ + eb3.maxZ) / 2 }));
      follow.show();
      expect('跟随：刚打开时在玩家所在的 #3', follow.getState().mapId === 3);
      pid = 4;   // 玩家走到另一张图（客户端判图 / 服务端 mapSwitched 都会改这个值）
      expect('跟随：玩家换图 → syncToPlayer 切过去（返回 true）', follow.syncToPlayer() === true);
      expect('跟随：切到新图 #4（不是停在上一张）',
        follow.getState().level === 2 && follow.getState().mapId === 4);
      expect('跟随：同一张图内跑动不打扰（重复调用返回 false）', follow.syncToPlayer() === false);
      // 玩家手动翻去别处看：不换图就不该被拉回
      follow.goTo({ level: 2, groupId: 'continent', mapId: 2 });
      expect('跟随：手动翻图后（玩家没换图）不被拉回', follow.syncToPlayer() === false && follow.getState().mapId === 2);
      pid = 5;
      expect('跟随：玩家再换图 → 再次跟随', follow.syncToPlayer() === true && follow.getState().mapId === 5);
      follow.destroy();
    }
    probeHost.remove();
  }

  // ── 图标：玩家箭头 / NPC / 队友 / 怪物 ─────────────────────────
  // 合成实体（**不碰真实数据**），只验证"该画的画、该滤的滤、颜色按规则分"。
  {
    const eb = (id: number): Box => (FIELDS.find((f) => f.id === id) as unknown as { bounds: Box }).bounds;
    const b3 = eb(3), b4 = eb(4);
    const self = { mapId: 3, x: (b3.minX + b3.maxX) / 2 + 300, z: (b3.minZ + b3.maxZ) / 2 + 300 };
    const npcIn = { kind: 'npc' as const, x: self.x + 1500, z: self.z + 900 };
    const monIn = { kind: 'monster' as const, x: self.x - 1500, z: self.z - 900 };
    // 队友两个：一个在"17 格内"（原版 PARTY_GETTING_DIST2 = (17*64)^2 = 1088），一个在**图内但远超**该距离
    const partyNear = { kind: 'party' as const, x: self.x, z: self.z + 800 };
    const partyFar = { kind: 'party' as const, x: self.x, z: self.z - 3000 };
    // 图外实体：坐标在 #3 的 AABB 之外（借用 #4 的中心，两图不重叠）
    const out1 = { kind: 'monster' as const, x: (b4.minX + b4.maxX) / 2, z: (b4.minZ + b4.maxZ) / 2 };

    const ehost = document.createElement('div');
    document.body.appendChild(ehost);
    const emap = createWorldMap(ehost, {
      getPlayer: () => ({ ...self, angle: 0.6 }),
      getEntities: () => [npcIn, monIn, partyNear, partyFar, out1],
      revealAll: true, openAtPlayer: true,
    });
    emap.show();
    emap.goTo({ level: 2, groupId: 'continent', mapId: 3 });
    expect('实体：单图层只画落在本图范围内的（5 个实体 → 4 个）', emap.getDrawnEntities().length === 4);
    expect('实体：图外的那个被滤掉（不进绘制集）',
      !emap.getDrawnEntities().some((e) => e.kind === 'monster' && e.x === out1.x));
    emap.goTo({ level: 1, groupId: 'continent', mapId: null });
    expect('实体：区域层一个都不画（与图例同一条规则）', emap.getDrawnEntities().length === 0);

    // 真画没画：从画布取像素。
    // ⚠ 别拿"单个像素 == 参考色"来判：sprite 经浏览器缩放是**重采样**过的，落在半透明边上
    //   就会与地形混色（曾据此误判"图标没画"）。判据取**等价但稳**的说法：
    //   该处最近的那个像素，与"这个实体该用的图标"（由**渲染同一份** `tintUiImage` 造出的参考图）
    //   距离足够近 ⇒ 画的就是它。
    emap.goTo({ level: 2, groupId: 'continent', mapId: 3 });
    const ec = emap.el.querySelector('canvas')!;
    const mm = emap.el.querySelector<HTMLElement>('.jp-wm-win')!;   // 缩放窗口会让画布重排，量之前固定一次
    mm.style.width = '900px'; mm.style.height = '640px';
    emap.setWindowRect({ x: 20, y: 20, w: 900, h: 640 });
    emap.redraw();

    // 图标参考色：npc 原色 / 染红；party 原色 / 染红（tint 是**共用实现**，见 `render/ui-texture.ts`）
    // ⚠ `Image` 的 `naturalWidth` 有值 ≠ 已解码：不 await decode() 直接 drawImage 会画成空白
    //   （参考色会全 0）。染色图标现在是 canvas（同步可用），这里两种情况都兜住。
    const refOf = async (src: CanvasImageSource): Promise<[number, number, number]> => {
      if (src instanceof HTMLImageElement) { try { await src.decode(); } catch { /* 见下 */ } }
      const w = src instanceof HTMLCanvasElement ? src.width
        : src instanceof HTMLImageElement ? src.naturalWidth : 0;
      const h = src instanceof HTMLCanvasElement ? src.height
        : src instanceof HTMLImageElement ? src.naturalHeight : 0;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d')!;
      g.drawImage(src, 0, 0);
      const d = g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const npcImg = (await loadUiImage('/res/image/npc.tga'))!;
    const partyImg = (await loadUiImage('/res/image/party.tga'))!;
    const arrowImg = (await loadUiImage('/res/image/arrow.tga'))!;
    const [refNpc, refMon, refParty, refPartyFar, refArrow] = await Promise.all([
      refOf(npcImg), refOf(tintUiImage(npcImg, '#ff5252')),
      refOf(partyImg), refOf(tintUiImage(partyImg, '#ff5252')),
      refOf(arrowImg),
    ]);
    const REF = { npc: refNpc, monster: refMon, party: refParty, partyFar: refPartyFar, arrow: refArrow };
    /** 实体屏幕点周围 9×9 里，与"它该用的图标色"最接近的那个像素 */
    const probe = (wx: number, wz: number, ref: [number, number, number]): { rgb: number[]; dist: number } => {
      const g = ec.getContext('2d')!;
      const [cxs, cys] = emap.worldToScreen(wx, wz);
      const img = g.getImageData(Math.round(cxs) - 4, Math.round(cys) - 4, 9, 9).data;
      let best: number[] = [0, 0, 0], bestD = Infinity;
      for (let i = 0; i < img.length; i += 4) {
        const dd = (img[i] - ref[0]) ** 2 + (img[i + 1] - ref[1]) ** 2 + (img[i + 2] - ref[2]) ** 2;
        if (dd < bestD) { bestD = dd; best = [img[i], img[i + 1], img[i + 2]]; }
      }
      return { rgb: best, dist: Math.sqrt(bestD) };
    };
    const r3 = (v: number[]): string => 'rgba(' + v.join(',') + ')';
    /** 诊断：某世界点周围 24×24 里，与参考色距离 < 40 的像素数（图标在不在那儿，一目了然） */
    const countNear = (wx: number, wz: number, ref: [number, number, number]): string => {
      const g = ec.getContext('2d')!;
      const [cxs, cys] = emap.worldToScreen(wx, wz);
      const img = g.getImageData(Math.round(cxs) - 12, Math.round(cys) - 12, 24, 24).data;
      let n = 0;
      for (let i = 0; i < img.length; i += 4) {
        if ((img[i] - ref[0]) ** 2 + (img[i + 1] - ref[1]) ** 2 + (img[i + 2] - ref[2]) ** 2 < 1600) n++;
      }
      return `${Math.round(cxs)},${Math.round(cys)}→${n}`;
    };
    // 证据行：每个实体屏幕点 24×24 内命中"它该用的图标色"的像素数（>0 = 图标确实画在那儿）。
    // 参考色由**渲染同一份** `tintUiImage` 造出，所以这里既证明"画了"也证明"颜色对"。
    lines.push(`  · 图标命中像素数（24×24 内）：arrow ${countNear(self.x, self.z, REF.arrow)} npc ${countNear(npcIn.x, npcIn.z, REF.npc)}`
      + ` monster ${countNear(monIn.x, monIn.z, REF.monster)} party ${countNear(partyNear.x, partyNear.z, REF.party)}`
      + ` partyFar ${countNear(partyFar.x, partyFar.z, REF.partyFar)}`);

    const selfP = probe(self.x, self.z, REF.arrow);
    expect(`实体：玩家箭头 = arrow 图标（最近像素 ${r3(selfP.rgb)} / 参考 ${r3(REF.arrow)}，dist ${selfP.dist.toFixed(1)}）`,
      selfP.dist < 60);
    const npcP = probe(npcIn.x, npcIn.z, REF.npc);
    expect(`实体：NPC = 原色绿点（最近像素 ${r3(npcP.rgb)} / 参考 ${r3(REF.npc)}，dist ${npcP.dist.toFixed(1)}）`,
      npcP.dist < 60);
    const monP = probe(monIn.x, monIn.z, REF.monster);
    expect(`实体：怪物 = 同张点图染红（最近像素 ${r3(monP.rgb)} / 参考 ${r3(REF.monster)}，dist ${monP.dist.toFixed(1)}）`,
      monP.dist < 60);
    const nearP = probe(partyNear.x, partyNear.z, REF.party);
    expect(`实体：17 格内的队友 = 原色点（最近像素 ${r3(nearP.rgb)} / 参考 ${r3(REF.party)}，dist ${nearP.dist.toFixed(1)}）`,
      nearP.dist < 60);
    const farP = probe(partyFar.x, partyFar.z, REF.partyFar);
    expect(`实体：17 格外的队友 = 染红点（最近像素 ${r3(farP.rgb)} / 参考 ${r3(REF.partyFar)}，dist ${farP.dist.toFixed(1)}）`,
      farP.dist < 60);
    emap.destroy();
    ehost.remove();
  }

  // ── ESC：直接关闭（不再逐级回退）＋ 激活栈（谁激活谁最上）────────────
  {
    // ESC：单图层时按一下直接关（原来是"回区域"，那让玩家要多按一次）
    bigMap.goTo({ level: 2, groupId: 'continent', mapId: 3 });
    expect('ESC：先打开着', bigMap.visible);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect('ESC：单图层 → 直接关闭（不回区域）', !bigMap.visible);
    // 区域层按 ESC 同样是关闭
    bigMap.show();
    bigMap.goTo({ level: 1, groupId: 'continent', mapId: null });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect('ESC：区域层 → 也是关闭', !bigMap.visible);
    // 非栈顶不响应：别的窗口被激活（z 更高）时，ESC 不该把地图也关掉
    {
      const other = document.createElement('div');
      other.dataset.layer = 'panel:skills';       // 声明即参与
      other.dataset.layerHost = 'panels';
      document.body.appendChild(other);
      registerElement(other);
      bigMap.show();
      bringToFront('worldmap');
      bringToFront('panel:skills');               // 技能面板后激活 → 在最上
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect('ESC：地图不在栈顶时不响应（技能面板在最上，ESC 该关它）', bigMap.visible);
      bringToFront('worldmap');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect('ESC：把它激活到栈顶后又能关掉', !bigMap.visible);
      other.remove();
    }
    // 激活栈本身：后激活的 z 更高
    {
      const a = document.createElement('div'), b = document.createElement('div');
      a.dataset.layer = 'panel:inventory'; a.dataset.layerHost = 'panels';
      b.dataset.layer = 'systemMenu'; b.dataset.layerHost = 'panels';
      document.body.append(a, b);
      registerElement(a); registerElement(b);
      bringToFront('panel:inventory');
      const z1 = layerZIndex('panel:inventory'), z2 = layerZIndex('systemMenu');
      expect(`激活栈：后激活的在上（背包 ${z1} > 系统菜单 ${z2}）`, z1 > z2);
      bringToFront('systemMenu');
      expect(`激活栈：换成系统菜单在上（${layerZIndex('systemMenu')} > ${layerZIndex('panel:inventory')}）`,
        layerZIndex('systemMenu') > layerZIndex('panel:inventory'));
      expect('激活栈：isTopLayer 与 z 一致',
        isTopLayer('systemMenu') && !isTopLayer('panel:inventory'));
      a.remove(); b.remove();
    }
  }

  // ── 真实面板各自入栈（用户场景：背包 + 角色 + 技能 + 地图 同开）────────────
  // 用户 2026-09-15 纠正的那一版做法：**不能把整个面板层当成一层升降** ——
  // 那样"关掉角色面板再打开"会连带把背包一起顶到地图上面。要的是**每个窗口各自入栈**。
  {
    const hostEl = document.createElement('div');
    document.body.appendChild(hostEl);
    const panels = createReactPanels(hostEl);
    openPanel('inventory');
    openPanel('charStatus');
    openPanel('skills');
    // 让 React 提交 DOM：`openPanel` 改的是 store，要等一次渲染循环（宏任务最稳，别用微任务）
    await new Promise<void>((r) => setTimeout(r, 60));

    // 用 `data-panel`（PanelShell 上的稳定钩子）定位 —— 别拿标题文本找，翻译一改就断
    const elOf = (id: string): HTMLElement | null =>
      hostEl.querySelector<HTMLElement>(`.jp-panel[data-panel="${id}"]`);
    const bagEl = elOf('inventory');
    const charEl = elOf('charStatus');
    const skillEl = elOf('skills');
    lines.push(`  · 面板层 DOM：${hostEl.innerHTML.slice(0, 160)}`);
    expect('面板层：三个面板都渲染出来了（背包/角色/技能）', !!bagEl && !!charEl && !!skillEl);
    expect('面板层：每个面板各有独立层（z 都有值）',
      layerZIndex('panel:inventory') > 0 && layerZIndex('panel:charStatus') > 0 && layerZIndex('panel:skills') > 0);
    lines.push(`  · 面板 z：背包 ${layerZIndex('panel:inventory')} / 角色 ${layerZIndex('panel:charStatus')}`
      + ` / 技能 ${layerZIndex('panel:skills')} / 地图 ${layerZIndex('worldmap')}`);
    if (bagEl && charEl && skillEl) {
      // 点地图 → 地图在上
      bigMap.show();
      bringToFront('worldmap');
      // 点背包 → **只有背包**升到最上
      bagEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      expect(`用户场景：点背包 → 背包在最上（${layerZIndex('panel:inventory')} > 地图 ${layerZIndex('worldmap')}）`,
        layerZIndex('panel:inventory') > layerZIndex('worldmap'));
      // ★ 关键回归：点角色面板，只有它上来，**背包不该被连带顶到最上**
      // ⚠ 断言比的是**相对顺序**，不是 z 的绝对值：层栈每次激活后会把序号重排成 1..N
      //   （用户 2026-09-16 定的做法），"背包的 z 没变"这个说法本身已不成立。
      //   真正要保证的是：角色在最上、背包仍在角色之下（且仍高于世界层）。
      const bagZ0 = layerZIndex('panel:inventory');
      charEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      expect(`用户场景：点角色面板 → 角色在最上，背包仍在其下（角色 ${layerZIndex('panel:charStatus')} > 背包 ${layerZIndex('panel:inventory')}）`,
        layerZIndex('panel:charStatus') > layerZIndex('panel:inventory'));
      expect(`用户场景：背包没被连带顶到最上（背包 ${layerZIndex('panel:inventory')} < 角色 ${layerZIndex('panel:charStatus')}，且层栈非空）`,
        bagZ0 > 0 && layerZIndex('panel:inventory') > 0);
      // 序号重排后 z 值应仍是连续小整数（用户要求：每次激活后重排 1..N）
      const zs = listLayers().map((l) => l.z).sort((a, b) => a - b);
      expect(`层栈：激活后重排成连续序号（${zs.join(',')}）`,
        zs.every((v, i) => i === 0 || v === zs[i - 1] + 1));
      // 此时地图是被点击激活过的（它在最上），这没问题 —— 再点背包就该回到最上
      bagEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      expect(`用户场景：再点背包 → 背包回到最上（${layerZIndex('panel:inventory')} > 地图 ${layerZIndex('worldmap')}）`,
        layerZIndex('panel:inventory') > layerZIndex('worldmap'));
      // 点技能 → 技能最上，其余不动
      skillEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      expect('用户场景：点技能 → 技能在最上',
        layerZIndex('panel:skills') > layerZIndex('panel:charStatus')
        && layerZIndex('panel:skills') > layerZIndex('panel:inventory'));
      // 关掉技能 → 它的层注销，其余**保持不动**
      closePanel('skills');
      await new Promise<void>((r) => setTimeout(r, 60));
      expect('用户场景：关掉一个面板 → 它的层注销', layerZIndex('panel:skills') === 0);
      expect('用户场景：关掉它不影响别的面板（背包/角色都还在栈里）',
        layerZIndex('panel:inventory') > 0 && layerZIndex('panel:charStatus') > 0);
    }
    closeAllPanels();
    await new Promise<void>((r) => setTimeout(r, 60));
    expect('面板层：全部关掉后各自的层都注销了（不留僵尸层）',
      layerZIndex('panel:inventory') === 0 && layerZIndex('panel:charStatus') === 0
      && layerZIndex('panel:skills') === 0);
    panels.dispose();
    hostEl.remove();
    bigMap.hide();
  }

  const bad = checkGroups(FIELDS.map((f) => f.id));
  expect('大陆/分组不重不漏地覆盖 63 张', bad.length === 0);
  if (bad.length > 0) for (const b of bad) lines.push('  · ' + b);
  expect(`大陆区域 = ${CONTINENT_GROUP.mapIds.length} 张（顶层只有区域层，没有"世界"这一层）`,
    CONTINENT_GROUP.mapIds.length === WORLD_MAP_IDS.length && WEBGL_SAFE(CONTINENT_GROUP.mapIds));
  expect(`层级总数 = 大陆 + ${OFFWORLD_GROUPS.length} 个家族（不硬编码，随分组表走）`,
    ALL_LAYERS.length === 1 + OFFWORLD_GROUPS.length && ALL_LAYERS[0]?.id === 'continent');

  warn.style.display = 'block';
  warn.textContent = lines.join(' | ');
  for (const l of lines) (l.startsWith('FAIL') ? console.error : console.log)('[selftest] ' + l);
  const fails = lines.filter((l) => l.startsWith('FAIL')).length;
  document.title = fails > 0 ? `SELFTEST FAIL ${fails}` : `SELFTEST OK ${lines.length}`;
  // **落盘**：`--dump-dom` 抓不到 rAF 之后的内容（Chrome 的 dump 时机），控制台也不总是刷出来。
  // 复用 dev 落盘端点（见 vite.config.ts 的 bakeSink），验收脚本直接读这个文件 —— 不依赖浏览器时序。
  void fetch(`/__bake?path=${encodeURIComponent((q.get('out') ?? 'image/planemap') + '/_selftest.log')}`,
    { method: 'POST', body: `title: ${document.title}\n` + lines.join('\n') + '\n' }).catch(() => {});
}

if (q.get('selftest') === '1') {
  // **同步跑**，不等 rAF：窗口是固定定位 + 显式像素尺寸，append 后布局立即可读
  // （`--dump-dom` / `--virtual-time-budget` 下 rAF 偶发不触发，等它会让验收偶发"什么都没跑"）。
  try {
    const cw = cv().clientWidth;
    if (cw === 0) throw new Error('画布尺寸为 0（布局还没完成？）—— 自检的点位换算会全错');
    void selftest().catch((err) => { throw err; });
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}
${err.stack ?? ''}` : String(err);
    warn.style.display = 'block';
    warn.textContent = 'SELFTEST CRASH: ' + msg;
    document.title = 'SELFTEST CRASH';
    console.error('[selftest] crash', err);
  }
}
