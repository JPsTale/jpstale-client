/**
 * 大地图组件 —— **FF14 风格的地图窗口**（用户 2026-09-15 照 FF14 定稿）。
 *
 * 形态（用户逐条列过，别自己发挥）：
 *   · 窗口：标题栏可拖（面包屑 + `×`）、右下角可拉大小、几何持久化；不是全屏页、也不是对话框。
 *   · **canvas 左侧一条竖排功能按钮**（原来那列地图名字**已删掉** —— FF14 没有，靠点击与"上级"导航）：
 *       1. **上级地图**：里查顿 → 大陆；亚特兰蒂斯 → 神秘联邦；迷失岛 → 迷失岛；**在副本里无作用**（它不在世界上）。
 *       2. **复位到我**：把玩家位置放到画面中央，**不改缩放**（不是重新 fit）。
 *       3. **非激活时半透明**（默认开，透明度 50%，见 `ui-prefs.worldMapDimAlpha`）——不是"钉住"。
 *       4. **图标开关**（传送门/出生点）。
 *       5. **文字开关**（区域名/等级门）。
 *       6. **竖排比例尺滑块**，上下两端分别为 **+ / −**。
 *   · **右下角显示玩家坐标** `(x, z)`；**右上角显示鼠标指向的世界坐标** `(x, z)`（忽略 y，地图是平面）。
 *   · 地图区：滚轮缩放（以光标为锚）、拖拽平移；玩家位置 = 红点 + 朝向箭头。
 *
 * 层级与分组判据见 `src/maps/planemap-regions.ts` 顶部；平面图由 `npm run bake-maps` 生成
 * （比例尺/扩展名从 `index.json` 读，不写死）；等级门见 `map-levels.generated.json`。
 * 调试/验收宿主：`worldmap.html` + `src/tools/worldmap-demo.ts`（组件本身不含 dev-only 代码）。
 */
import { FIELDS } from '../maps/map-data.js';
import {
  ALL_LAYERS, groupById, layerOf, checkGroups, type OffworldGroup,
} from '../maps/planemap-regions.js';
import levelData from '../maps/map-levels.generated.json';
import { t } from '../i18n/index.js';
import { loadUiPrefs, saveUiPrefs } from './ui-prefs.js';
import { setCursorMode } from './cursor.js';
import './worldmap.css';   // 地图内容的样式（不再是 TS 里的模板字符串 —— 见该文件头部注释）
import { loadUiImage } from '../render/ui-texture.js';

interface Box { minX: number; minZ: number; maxX: number; maxZ: number }
interface MapEntry { id: number; name: string; box: Box; img: HTMLImageElement | null; failed: boolean }

/** 点位（传送门 / 出生点）—— 位置来自 `fields.json`；图标是我们画的（原版世界图上没有这些图标） */
export interface Poi {
  kind: 'gate' | 'start';
  mapId: number;
  x: number;
  z: number;
  /** gate：传送目的地（地图名 + 等级门槛），供悬停提示 */
  to?: { mapId: number; name: string; level: number }[];
}

/** 大地图上要画的实体（图标与小地图同源：`image/arrow.tga` / `npc.tga`；队友画蓝方块+名字） */
export interface WorldMapEntity {
  kind: 'npc' | 'monster' | 'party';
  x: number;
  z: number;
  /**
   * 队友标记的**显示名**（D6：蓝色正方形旁渲染名字——原版大地图只画点不画名，这是超出原版的增强）。
   * 只对 kind='party' 有意义。
   */
  name?: string;
  /**
   * 队友**所在图**（服务端权威 mapId，S2C_PartyPlayUpdate 下发）。
   * 大地图显示规则（用户 2026-09-25 定）：只画**当前可见地图集**（layerMapIds）内的队友——
   * 单图层 = 本图队友；区域（大陆）层 = 本组各图上的队友；不在可见地图的不显示。
   */
  mapId?: number;
  /**
   * 朝向（弧度，与 three 的 `rotation.y` 同义：0 = 朝世界 +z）。
   * 地图上的**怪物画成三角形，尖指向它**（用户 2026-09-16 要求）。
   * 缺省时三角尖朝下（+z）—— 只是没角度，不是"面朝北"。
   */
  angle?: number;
}

export interface WorldMapPlayer {
  mapId: number;
  x?: number;
  z?: number;
  /** 朝向（弧度）；给了就画箭头，否则只画点 */
  angle?: number;
}

export interface WorldMapOptions {
  assetDir?: string;
  onVisibility?: (visible: boolean) => void;
  onLevelChange?: (s: WorldMapState) => void;
  /** 点中某张地图（浏览下钻之外，游戏侧要的动作，比如"看详情/传送"） */
  onPick?: (mapId: number) => void;
  getPlayer?: () => WorldMapPlayer | null;
  /**
   * 地图上的其他实体（NPC / 怪物 / 队友）。**只在单图层（区域层不画，见点位那条规则）**，
   * 且只画坐标落在该图范围内的。图标与小地图同源，见 `drawEntities`。
   */
  getEntities?: () => WorldMapEntity[];
  /** 点地图是否自动下钻（默认 true） */
  browse?: boolean;
  /**
   * 显示**全部**层级（含副本/战场）。默认 false = 只显示野外层级 + 玩家当前所在的那个层级
   * —— 副本/战场不该让玩家在没进去过的时候就在地图上看到（用户 2026-09-15 定，见 docs/worldmap.md）。
   * 调试/验收宿主传 true。
   */
  revealAll?: boolean;
  /** 打开时是否直接定位到玩家所在地图（默认 true，像 FF14 那样"一开就是我在的地方"） */
  openAtPlayer?: boolean;
  /**
   * 标题栏内容变化（面包屑 / 当前图名 / "非激活半透明"开关）→ 推给 React 渲染。
   *
   * 为什么是回调：窗口标题栏现在由 `PanelShell` 渲染，地图只负责**内容**。
   * 地图改 `state`（进/退层级）时通过它通知 React 重画标题栏 —— 地图不再自己动 DOM 外壳。
   */
  onChrome?: (c: WorldMapChrome) => void;
}

/** 地图推给窗口外壳的标题栏信息（见 `WorldMapOptions.onChrome`） */
export interface WorldMapChrome {
  /** 面包屑：第一段可点（回上级区域），后面若干段只读 */
  crumbs: { text: string; go: (() => void) | null }[];
  /** "非激活时半透明"开关是否打开（竖条上那颗 ◐ 按钮驱动） */
  dim: boolean;
}

/**
 * **两级**（用户 2026-09-15 纠正：不要再搞"世界→区域→地图"三层）：
 *   · `level: 1` = **区域**（顶层）：`大陆` / `迷失岛` / `神秘联邦` / 副本家族
 *   · `level: 2` = **地图**
 * `groupId` 始终是当前所在的区域 id（1 层就是它自己，2 层是该图所属的区域）。
 */
export interface WorldMapState {
  level: 1 | 2;
  groupId: string;
  mapId: number | null;
}

export type PoiMode = 'off' | 'gates' | 'all';

export interface WorldMapHandle {
  /** 内容根元素（不是窗口 —— 窗口由 `PanelShell` 渲染） */
  readonly el: HTMLElement;
  /** 挂载初始化（`WorldMapPanel` 的 useEffect 调） */
  show(): void;
  /** 卸载收尾（`WorldMapPanel` 的 useEffect cleanup 调） */
  hide(): void;
  /** 直接跳到某一层（URL 状态 / 自检用） */
  goTo(s: Partial<WorldMapState>): void;
  getState(): WorldMapState;
  focusMap(mapId: number): void;
  /** 把玩家位置放到画面中央（**不改缩放**）——竖条第 2 个按钮就是它 */
  centerOnPlayer(): void;
  /**
   * 跟随玩家**换图**：玩家跑到别的地图时，把显示切到那张图（用户 2026-09-15：
   * "角色跑到另一个地图后不会触发切换地图（而是始终显示上一个地图）"）。
   * 返回是否真的切了图（供自检断言）。
   */
  syncToPlayer(): boolean;
  worldToScreen(x: number, z: number): [number, number];
  screenToWorld(sx: number, sy: number): [number, number];
  redraw(): void;
  destroy(): void;
  /** 窗口几何（宿主/自检用；改动也会落进 ui-prefs） */
  /** 竖条第 3 个按钮：非激活时半透明 */
  isDimUnfocused(): boolean;
  setDimUnfocused(v: boolean): void;
  /** 竖条第 5 个按钮：地图上的文字 */
  isLabelsOn(): boolean;
  setLabels(v: boolean): void;
  getPoiMode(): PoiMode;
  setPoiMode(m: PoiMode): void;
  /** 当前画出来的点位（自检/宿主可读） */
  getPois(): Poi[];
  /** 当前**画出来**的地图 id（区域层 = 该区域全部；单图层 = 只有它自己）—— 自检用 */
  getDrawnMapIds(): number[];
  /** 当前**画出来**的实体（自检用；区域层返回空数组） */
  getDrawnEntities(): WorldMapEntity[];
  /** 侧栏那列已删；这仍是"此刻该让玩家看到的层级"（野外 + 玩家所在），给宿主/自检用 */
  getVisibleGroups(): OffworldGroup[];
  /** "上级地图"此刻会去哪（null = 没作用，例如在副本里） */
  getParentTarget(): Partial<WorldMapState> | null;
  /** 当前缩放（世界单位/像素）—— 自检用（比例尺滑块/复位不该改它） */
  getZoom(): number;
  /** 某张图的底图此刻是什么状态（自检用：区分"还没加载完"与"加载失败"，别猜颜色） */
  getImageState(mapId: number): { status: 'ok' | 'loading' | 'failed' | 'none'; natural: string };
  /**
   * 等底图就绪（已解码 / 已失败）—— **自检读像素前必须先等它**：
   * 底图是 `Image` 异步解码的，`complete` 之前画的是占位色而不是地图；
   * 游戏里无所谓（每 66ms 补一帧），验收里就是"读到占位色 → 断言随机失败"。
   */
  whenImagesReady(ids?: number[]): Promise<void>;
  /** 实体图标此刻的加载状态（自检用：区分"没加载"与"加载了但没画"） */
  getMarkerStates(): Record<string, string>;
  /** 上一帧实体图标**实际画到了哪**（自检用） */
  getLastEntityDraws(): string[];
}

const LEVELS: Record<string, number> = levelData.levels as Record<string, number>;
/**
 * 比例尺范围（世界单位/像素，越小越放大）：**8 ~ 128**（用户 2026-09-15 定为 4~128，随后调整为 8~128）。
 * 顶端 = 8 单位/px（约 2 倍于烘图基准 16），底端 = 128 单位/px。
 */
const ZOOM_MIN = 8, ZOOM_MAX = 128;


/**
 * 要不要在**图上**标地图名？
 *
 * 只在"这一层画了不止一张图"时才标（区域层需要区分彼此）；
 * **单图层不标** —— 名字已经在左上角面包屑上了，图上再写一遍是重复（用户 2026-09-15）。
 */
export function shouldDrawMapLabels(layerMapCount: number, labelsOn: boolean): boolean {
  return labelsOn && layerMapCount > 1;
}

/** 地图显示名 + 等级门：`失落神殿（98）`。**0/1 = 无实质限制**（PT 从 1 级起），只有 >1 才加括号 */
export function mapLabelOf(id: number, name: string): string {
  const lv = LEVELS[String(id)] ?? 0;
  return lv > 1 ? `${name}（${lv}）` : name;
}

export function createWorldMap(host: HTMLElement, opts: WorldMapOptions = {}): WorldMapHandle {
  const assetDir = opts.assetDir ?? 'image/planemap';
  const browse = opts.browse !== false;
  const revealAll = opts.revealAll === true;
  const openAtPlayer = opts.openAtPlayer !== false;
  const prefs = loadUiPrefs();

  // ── 数据 ──────────────────────────────────────────────────────────
  const maps = new Map<number, MapEntry>();
  for (const f of FIELDS) {
    const box = (f as unknown as { bounds?: Box }).bounds;
    if (!box) continue;
    const key = `map.${f.id}`;
    const name = t(key);
    maps.set(f.id, { id: f.id, name: name === key ? (f.minimap ?? f.shortname) : name, box, img: null, failed: false });
  }
  let ext = 'webp';
  const OUT = (): string => `/res/${assetDir}`;

  function loadImage(id: number): HTMLImageElement | null {
    const e = maps.get(id);
    if (!e) return null;
    if (e.img) return e.img;
    if (e.failed) return null;
    const img = new Image();
    img.src = `${OUT()}/${id}.${ext}`;
    img.onerror = () => { e.failed = true; };
    e.img = img;
    return img;
  }

  /**
   * 实体标记的图标 —— **与小地图同一批资产**（`image/arrow.tga` / `npc.tga` / `party.tga`），
   * 解码走同一个 `loadUiImage`（PT 加密 TGA，浏览器不能直接解码）。
   *   玩家 = ARROW（原版 `MatArrow`，16×16、随朝向旋转）
   *   NPC  = npc.tga（原版 `MatNpcPos`，8×8 中心对齐）
   *   队友 = **蓝色正方形 + 队员名称**（用户 2026-09-24 定 = D6；弃用 party.tga 近白/远红方案。
   *          原版大地图（NSPT FullZoomMap）只画当前图 rect 内的队员点、不画名字——名与方块都是
   *          超出原版的增强；色值呼应场景内队友名 RGB(51,204,255)）
   *   怪物 = 沿用 npc.tga **染红**：原版 `DrawMapNPC` 只遍历 `smCHAR_STATE_NPC`，没有怪物图标资产；
   *          "染红区分"在原版源码里有先例（队友过远即 `D3DCOLOR_RGBA(255,0,0,255)`）
   */
  const MARKER_SRC = {
    arrow: '/res/image/arrow.tga',
    npc: '/res/image/npc.tga',
  } as const;
  // 值类型 = `drawImage` 的源：原色图标是 `Image`（经 loadUiImage 等过 onload），
  // 染色图标是 `HTMLCanvasElement`（同步可画，见 `tintUiImage` 的注释）
  const markers: Partial<Record<'arrow' | 'npc',
    HTMLImageElement | HTMLCanvasElement>> = {};
  void (async () => {
    const [arrow, npc] = await Promise.all([
      loadUiImage(MARKER_SRC.arrow), loadUiImage(MARKER_SRC.npc),
    ]);
    if (arrow) markers.arrow = arrow;
    if (npc) markers.npc = npc;   // 怪物不再用染色图标（改成画三角，见 drawMonsterMark）
    draw();   // 图标到齐后补画一帧
  })();

  // 比例尺/扩展名以 index.json（烘焙元数据）为准（scale 目前只用于校验读数，界面不再显示它）
  let scale = 16;
  void scale;
  void (async () => {
    try {
      const res = await fetch(`${OUT()}/index.json`, { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json() as { scale?: number; format?: string };
      if (Number(j.scale) > 0) scale = Number(j.scale);
      if (j.format === 'png' || j.format === 'webp') ext = j.format;
    } catch { /* 读不到就用默认，仍能渲染 */ }
  })();

  /** 点位表：一次性从 fields.json 建好（传送门 41 张图 73 个、出生点 97 个） */
  const gatesByMap = new Map<number, Poi[]>();
  const startsByMap = new Map<number, Poi[]>();
  for (const f of FIELDS) {
    const g: Poi[] = (f.warpGates ?? []).map((w) => ({
      kind: 'gate' as const, mapId: f.id, x: w.x, z: w.z,
      to: (w.destinations ?? []).map((d) => ({
        mapId: d.map, name: maps.get(d.map)?.name ?? `#${d.map}`, level: d.level ?? 0,
      })),
    }));
    if (g.length) gatesByMap.set(f.id, g);
    const s: Poi[] = (f.startPoints ?? []).map(([x, z]) => ({ kind: 'start' as const, mapId: f.id, x, z }));
    if (s.length) startsByMap.set(f.id, s);
  }

  // ── DOM：**只建"地图内容"** ────────────────────────────────────────
  // 窗口外壳（边框/标题栏/拖动/缩放/关闭/层级/显隐）由 React `PanelShell` 提供，
  // 这里只往它给的 `host`（`.jp-panel-body`）里放内容 —— 这样地图和其它面板**共用一套窗口**。
  const body = document.createElement('div');
  body.className = 'jp-wm-body';
  const strip = document.createElement('div');
  strip.className = 'jp-wm-strip';
  const wrap = document.createElement('div');
  wrap.className = 'jp-wm-cvwrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'jp-wm-cv';
  const mouseCoord = document.createElement('div');
  mouseCoord.className = 'jp-wm-coord mouse';
  const selfCoord = document.createElement('div');
  selfCoord.className = 'jp-wm-coord self';
  const legend = document.createElement('div');
  legend.className = 'jp-wm-legend';
  const tip = document.createElement('div');
  tip.className = 'jp-wm-tip';

  wrap.append(canvas, mouseCoord, selfCoord, legend, tip);
  body.append(wrap, strip);   // 竖条在画布之上（绝对定位，不占宽度）
  host.appendChild(body);
  const ctx = canvas.getContext('2d')!;

  // 画布尺寸跟着**内容容器**走（以前是跟着窗口 `win` 走）。
  // 用 ResizeObserver 而不是 window.resize：PanelShell 拖拽改尺寸、切面板、改布局，
  // 容器都会变，window 的 resize 一条都收不到。
  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => resizeCanvas())
    : null;
  ro?.observe(wrap);

  const state: WorldMapState = { level: 1, groupId: 'continent', mapId: null };
  let view = { cx: 0, cz: 0, unit: 40 };   // unit = 世界单位/屏幕像素
  let hoverId: number | null = null;
  let hoverPoi: Poi | null = null;
  let mouseWorld: [number, number] | null = null;
  let poiMode: PoiMode = prefs.worldMapPoi;
  let labelsOn = prefs.worldMapLabels;
  let dimUnfocused = prefs.worldMapDim;
  const dimAlpha = prefs.worldMapDimAlpha;
  let visible = false;
  /**
   * **跟随玩家**（用户 2026-09-16："'把我放在地图中间'按钮被激活后，地图的行为应该类似小地图，
   * 永远把玩家位置居中"）：开启后每次重绘都把视野中心设成玩家坐标，玩家走到哪地图跟到哪。
   * 与"点一下居中一次"的区别：这是**开关**（竖条第 2 颗按钮，亮起表示开着）。
   *
   * 拖动画布 = 自动关掉跟随（`canvas` 的 pointerdown）：否则会变成"拖了又被拉回"，
   * 玩家不知道是卡住了还是本来如此 —— 关掉它，并让按钮熄灭作为反馈。
   */
  let followPlayer = false;

  const curGroup = (): OffworldGroup | null => groupById(state.groupId);
  const mapLabel = (id: number): string => mapLabelOf(id, maps.get(id)?.name ?? `#${id}`);

  /** 玩家此刻在哪张图、属于哪个层级 */
  function playerGroup(): OffworldGroup | null {
    const p = opts.getPlayer?.();
    return p ? layerOf(p.mapId) : null;
  }

  /**
   * 此刻该让玩家看到的层级：**野外**的（`wild`）+ **玩家当前所在**的那一个（副本/战场）。
   * 侧栏已经删了，这个函数留给宿主/自检（也是"可见性"这条规则的单一实现）。
   */
  function visibleGroups(): OffworldGroup[] {
    if (revealAll) return ALL_LAYERS;
    const mine = playerGroup();
    return ALL_LAYERS.filter((g) => g.wild || g.id === mine?.id);
  }

  /**
   * "上级地图"会去哪：
   *   · 地图 → 它所属的**区域**（里查顿 → 大陆；亚特兰蒂斯 → 神秘联邦；迷失岛 → 迷失岛）
   *   · 区域层 = **顶层** → null（无作用）
   *   · **副本 → null（无作用）** —— 副本不在大陆上，没有"上级地图"可显示
   */
  function parentTarget(): Partial<WorldMapState> | null {
    if (state.level === 1) return null;
    const id = state.mapId;
    if (id === null) return null;
    const g = layerOf(id);
    return g?.wild ? { level: 1, groupId: g.id, mapId: null } : null;
  }

  function unionBox(ids: number[]): Box | null {
    let b: Box | null = null;
    for (const id of ids) {
      const m = maps.get(id);
      if (!m) continue;
      b = b ? {
        minX: Math.min(b.minX, m.box.minX), minZ: Math.min(b.minZ, m.box.minZ),
        maxX: Math.max(b.maxX, m.box.maxX), maxZ: Math.max(b.maxZ, m.box.maxZ),
      } : { ...m.box };
    }
    return b;
  }

  function idsOfState(): number[] {
    if (state.level === 1) return curGroup()?.mapIds ?? [];
    return state.mapId === null ? [] : [state.mapId];
  }

  /**
   * 当前层要画的地图 = **就是这一层自己的成员**：
   *   · 区域层 → 该区域的全部成员
   *   · 单图层 → **只有这张图**（用户 2026-09-15："我们不能只画自己这个地图吗？"）
   * 曾经在单图层把同区域的其他图压暗当"上下文"，那是我们自己加的，已去掉。
   */
  function layerMapIds(): number[] {
    return idsOfState();
  }

  /**
   * 点位只在本图的视图里画。
   *
   * **区域层（多图那一层，用户口中的"世界地图"）一律不画图例**（传送门/出生点都不要），
   * 只留地图名字与角色自己的位置（用户 2026-09-15）—— 多图叠在一起时那些图标只会糊成一团。
   */
  function visiblePois(): Poi[] {
    if (poiMode === 'off' || state.level === 1) return [];
    const main = layerMapIds();
    const out: Poi[] = [];
    for (const id of main) {
      const g = gatesByMap.get(id);
      if (g) out.push(...g);
      if (poiMode === 'all' && state.level === 2) {
        const s = startsByMap.get(id);
        if (s) out.push(...s);
      }
    }
    return out;
  }

  /** 只把视野中心移到这批地图的包围盒中心，**不改缩放**（切图用） */
  function centerOnBox(ids: number[]): void {
    const b = unionBox(ids);
    if (!b) return;
    view.cx = (b.minX + b.maxX) / 2;
    view.cz = (b.minZ + b.maxZ) / 2;
  }

  function fitTo(ids: number[], pad = 0.06): void {
    const b = unionBox(ids);
    if (!b) return;
    const w = Math.max(b.maxX - b.minX, 1);
    const h = Math.max(b.maxZ - b.minZ, 1);
    const s = Math.min(canvas.clientWidth || 800, canvas.clientHeight || 600) * (1 - pad * 2);
    // ⚠ 取景也要夹进 [ZOOM_MIN, ZOOM_MAX]：否则初始视野会落在滑块范围之外，
    //   读数与滑块位置互相打架（滑块顶到头却还差一截）。
    const unit = Math.max(w, h) / s;
    view = {
      cx: (b.minX + b.maxX) / 2,
      cz: (b.minZ + b.maxZ) / 2,
      unit: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, unit)),
    };
    syncSlider();
  }

  function toScreen(x: number, z: number): [number, number] {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    return [w / 2 + (x - view.cx) / view.unit, h / 2 + (z - view.cz) / view.unit];
  }

  function toWorld(sx: number, sy: number): [number, number] {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    return [view.cx + (sx - w / 2) * view.unit, view.cz + (sy - h / 2) * view.unit];
  }

  function boxOnScreen(b: Box): [number, number, number, number] {
    const [x0, y0] = toScreen(b.minX, b.minZ);
    const [x1, y1] = toScreen(b.maxX, b.maxZ);
    return [x0, y0, x1 - x0, y1 - y0];
  }

  // ── 绘制 ──────────────────────────────────────────────────────────
  /**
   * 画一张平面图。`hoverable` = 这一层可以点它（区域层/单图层都会传 true）。
   *
   * ⚠ **不画静态 AABB 白框**（用户 2026-09-15："当你显示地图时，一定要把 aabb 框画出来吗？"）——
   * 那是我们自己的辅助线，视觉上就是一堆方框。保留的只有**悬停高亮**：指针压到哪张图，哪张图描黄边
   * （"这里能点"的反馈）。缺图时仍会涂底（那是**必须**可见的信息，不是装饰）。
   */
  function drawMap(id: number, alpha: number, hoverable: boolean): void {
    const m = maps.get(id);
    if (!m) return;
    const img = loadImage(id);
    const [x, y, w, h] = boxOnScreen(m.box);
    if (w < 0.5 || h < 0.5) return;
    ctx.globalAlpha = alpha;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, x, y, w, h);
    } else {
      ctx.fillStyle = m.failed ? '#5a2b2b' : '#2c3742';
      ctx.fillRect(x, y, w, h);   // 未就绪/缺图：涂底，不静默留白
    }
    if (hoverable && hoverId === id) {
      ctx.strokeStyle = '#ffd479';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    ctx.globalAlpha = 1;
  }

  function label(text: string, x: number, y: number, size: number, color = '#f4efe2'): void {
    ctx.font = `600 ${size}px "Microsoft YaHei", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 4);
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /** 点位图标：传送门 = 青色菱形，出生点 = 绿色圆点（图例是我们定的） */
  function drawPoi(p: Poi): void {
    const [x, y] = toScreen(p.x, p.z);
    if (x < -8 || y < -8 || x > canvas.clientWidth + 8 || y > canvas.clientHeight + 8) return;
    const hot = hoverPoi === p;
    if (p.kind === 'gate') {
      const r = hot ? 7 : 5;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fillStyle = '#6fe3ff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#06323f';
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, hot ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#8bf08b';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#123f12';
      ctx.stroke();
    }
  }

  /**
   * 该画的实体：
   *   · NPC/怪物 = 单图层 + 坐标落在本图范围内（区域层不画，与点位同一条规则，维持原状）；
   *   · 队友 = **当前可见地图集**内的（用户 2026-09-25 定）：单图层 = 本图队友、
   *     区域（大陆）层 = 本组各图上的队友；不在可见地图的不显示。
   *     归属判据 = 队友的**服务端权威 mapId**（不是坐标 AABB——相邻图切片会互相搭边）；
   *     再用其所在图的 AABB 做坐标合法性核对（防脏数据画出界）。
   */
  function drawnEntities(): WorldMapEntity[] {
    const visible = new Set(layerMapIds());
    const out: WorldMapEntity[] = [];
    for (const e of (opts.getEntities?.() ?? [])) {
      if (e.kind === 'party') {
        if (e.mapId == null || !visible.has(e.mapId)) continue;
        const mb = maps.get(e.mapId);
        if (!mb) continue;
        if (e.x < mb.box.minX || e.x > mb.box.maxX || e.z < mb.box.minZ || e.z > mb.box.maxZ) continue;
        out.push(e);
        continue;
      }
      if (state.level !== 2 || state.mapId === null) continue;
      const m = maps.get(state.mapId);
      if (!m) continue;
      const b = m.box;
      if (e.x >= b.minX && e.x <= b.maxX && e.z >= b.minZ && e.z <= b.maxZ) out.push(e);
    }
    return out;
  }

  /** 诊断：上一次 drawEntities 实际发出的绘制（自检读不到图标时用来定位是哪一步没了） */
  let lastEntityDraws: string[] = [];
  /**
   * 怪物标记 = **实心三角，尖指朝向**（用户 2026-09-16："把大地图上的怪物红色方块换成三角形，
   * 其中的尖尖表示怪物的面向角度"）。
   *
   * 角度换算：three 里朝向向量是 `(sin a, cos a)`（世界 x-z 平面，见 `WorldView` 的移动方向），
   * 地图是俯视的（屏幕 x = 世界 x，屏幕 y = 世界 z）⇒ 屏幕上的朝向向量同样是 `(sin a, cos a)`。
   * 三角默认尖朝 **+y（屏幕下 = 世界 +z）**，要转到 `(sin a, cos a)` 需 `rotate(-a)`：
   *   rotate(θ)·(0,1) = (-sinθ, cosθ) = (sin a, cos a) ⇒ θ = -a。
   *
   * 为什么不再用"npc.tga 染色"：那是个**方块**，表达不了朝向；三角是画出来的 path，
   * 旋转无成本，也比 8×8 的小图在缩放下更清晰。
   */
  function drawMonsterMark(x: number, y: number, angle?: number): void {
    ctx.save();
    ctx.translate(x, y);
    if (typeof angle === 'number') ctx.rotate(-angle);
    ctx.beginPath();
    ctx.moveTo(0, 5.5);        // 尖
    ctx.lineTo(-4.5, -4);      // 左下
    ctx.lineTo(4.5, -4);       // 右下
    ctx.closePath();
    ctx.fillStyle = '#ff5252';
    ctx.fill();
    // 描边：地图纹理本身颜色多变（沙漠/草地/雪地），深色边让三角在哪儿都看得清
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawEntities(): void {
    lastEntityDraws = [];
    for (const e of drawnEntities()) {
      const [sx, sy] = toScreen(e.x, e.z);
      if (e.kind === 'npc' && markers.npc) {
        ctx.drawImage(markers.npc, sx - 4, sy - 4, 8, 8);
        lastEntityDraws.push(`npc@${Math.round(sx)},${Math.round(sy)}`);
      } else if (e.kind === 'monster') {
        drawMonsterMark(sx, sy, e.angle);
        lastEntityDraws.push(`monster@${Math.round(sx)},${Math.round(sy)}`);
      } else if (e.kind === 'party') {
        // 蓝色正方形 + 队员名称（D6）。正方形带深色描边保证浅色图上可见；名字画在方块右侧。
        ctx.fillStyle = '#33ccff'; // RGB(51,204,255)，呼应场景内队友名颜色
        ctx.fillRect(sx - 4, sy - 4, 8, 8);
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx - 4.5, sy - 4.5, 9, 9);
        if (e.name) {
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(0,0,0,0.85)';
          ctx.fillText(e.name, sx + 7, sy + 0.5);
          ctx.fillStyle = '#bfeeff';
          ctx.fillText(e.name, sx + 6.5, sy);
        }
        lastEntityDraws.push(`party@${Math.round(sx)},${Math.round(sy)}${e.name ? `:${e.name}` : ''}`);
      }
    }
  }

  /** 玩家位置：与小地图同一张 ARROW 图标 + 同一套旋转约定（16×16，中心对齐） */
  function drawPlayer(): void {
    const p = opts.getPlayer?.();
    if (!p || !maps.has(p.mapId)) return;
    const m = maps.get(p.mapId)!;
    const [x, y, w, h] = boxOnScreen(m.box);
    if (w < 2 || h < 2) return;
    if (x + w < 0 || y + h < 0 || x > canvas.clientWidth || y > canvas.clientHeight) return;
    if (typeof p.x === 'number' && typeof p.z === 'number') {
      const [px, py] = toScreen(p.x, p.z);
      if (markers.arrow) {
        // 与小地图 `DrawMapArrow` 完全同一套约定：中心对齐、scale(-1,1)、rotate(朝向)
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(-1, 1);
        ctx.rotate(typeof p.angle === 'number' ? p.angle : 0);
        ctx.drawImage(markers.arrow, -8, -8, 16, 16);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ff5252';
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = '#ff5252';
      ctx.lineWidth = 3;
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    }
  }

  function draw(): void {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // **不画任何底色**（用户 2026-09-16）：canvas 保持透明，露出面板自身的底
    // （`.jp-panel` 的 #181a1f）—— 于是地图与其它面板天然同色，不需要"对齐色板"。
    //
    // 演进记录（三次都试过，别再绕回去）：
    //   ① 原先整幅铺海色 `#1d4260`（因为平面图烘焙时**水面是透明的**，需要一层底代表"水"）
    //      → 整个地图面板一片深蓝，和背包/角色面板的深灰不一致；
    //   ② 改成"图幅内铺海色、图幅外铺面板底" → 区域层是多图平铺，各图 AABB 之间的缝隙
    //      正好落在底色上，变成**一块块蓝**，比①更难看（"东一块西一块的蓝色还不如全铺满"）；
    //   ③ 最终：**什么都不画**。水（透明像素）与图幅外的空白都露出同一个面板底，
    //      陆地仍是烘出来的贴图 —— 既能区分水陆，又天然与其它面板同色。
    // 判据：画布四角像素的 alpha 应为 0（透明），而不是某个颜色。
    // 跟随玩家：把视野中心钉在玩家坐标上（在画地图之前设好，本帧立即生效）
    if (followPlayer) {
      const p = opts.getPlayer?.();
      if (p && typeof p.x === 'number' && typeof p.z === 'number') {
        // 玩家换图了 → 先切过去（`syncToPlayer` 会 goTo 到新图；下一帧再居中）
        if (state.level === 2 && state.mapId !== p.mapId) syncToPlayer();
        else { view.cx = p.x; view.cz = p.z; }
      }
    }

    const main = layerMapIds();
    for (const id of main) drawMap(id, 1, state.level === 1);   // 边框只在"可点"的区域层出现

    if (shouldDrawMapLabels(main.length, labelsOn)) {
      for (const id of main) {
        const m = maps.get(id);
        if (!m) continue;
        const [x, y, bw, bh] = boxOnScreen(m.box);
        const minSide = Math.min(bw, bh);
        if (minSide < 42) continue;   // 太小的图不画名字，免得糊成一团
        label(mapLabel(id), x + bw / 2, y + bh / 2, Math.min(18, Math.max(11, minSide / 9)));
      }
    }
    for (const p of visiblePois()) drawPoi(p);
    drawEntities();
    drawPlayer();
    syncCoords();
    syncToPlayer();   // 玩家换图 → 跟着切过去（按 mapId 去重，同图内跑动不打扰）
  }

  function resizeCanvas(): void {
    const r = wrap.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(r.height * devicePixelRatio));
    draw();
  }

  /** 可见期间持续重绘（约 15fps）：玩家标记会动 */
  let lastTick = 0;
  function tick(now: number): void {
    if (!visible) return;
    if (now - lastTick > 66) { lastTick = now; draw(); }
    requestAnimationFrame(tick);
  }

  /** 点落在哪张图上：取**面积最小**的命中者（副本常压在野外图上，点洞里进洞） */
  function mapAt(wx: number, wz: number, ids: number[]): number | null {
    let best: number | null = null, bestArea = Infinity;
    for (const id of ids) {
      const m = maps.get(id);
      if (!m) continue;
      const b = m.box;
      if (wx < b.minX || wx > b.maxX || wz < b.minZ || wz > b.maxZ) continue;
      const a = (b.maxX - b.minX) * (b.maxZ - b.minZ);
      if (a < bestArea) { bestArea = a; best = id; }
    }
    return best;
  }

  /** 光标附近的点位（8px 内，取最近） */
  function poiAt(sx: number, sy: number): Poi | null {
    let best: Poi | null = null, bestD = 8 * 8;
    for (const p of visiblePois()) {
      const [x, y] = toScreen(p.x, p.z);
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  // ── 标题栏 / 竖条 ─────────────────────────────────────────────────
  function mkBtn(text: string, titleAttr: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = `jp-wm-btn ${cls}`.trim();
    b.textContent = text;
    b.title = titleAttr;
    b.onclick = onClick;
    return b;
  }

  let upBtn!: HTMLButtonElement;
  let centerBtn!: HTMLButtonElement;
  let dimBtn!: HTMLButtonElement;
  let poiBtn!: HTMLButtonElement;
  let labelBtn!: HTMLButtonElement;
  let track!: HTMLDivElement;
  let thumb!: HTMLDivElement;

  function buildStrip(): void {
    strip.innerHTML = '';
    upBtn = mkBtn('↑', '上级地图', () => {
      const t2 = parentTarget();
      if (t2) goTo(t2);
    });
    centerBtn = mkBtn('◎', '跟随玩家：开/关（开启后像小地图那样，永远把玩家放在画面中心）',
      () => setFollowPlayer(!followPlayer));
    dimBtn = mkBtn('◐', `非激活时半透明（当前 ${Math.round(dimAlpha * 100)}%）`, () => setDimUnfocused(!dimUnfocused));
    poiBtn = mkBtn('◆', '开关地图上的图标（传送门 / 出生点）', cyclePoi);
    labelBtn = mkBtn('A', '开关地图上的文字', () => setLabels(!labelsOn));

    // 竖排比例尺：上端 +、下端 −，滑块映射到缩放（对数刻度，手感均匀）
    const wrapScale = document.createElement('div');
    wrapScale.className = 'jp-wm-scale';
    const plus = mkBtn('+', '放大', () => zoom(1 / 1.3));   // unit 越小越放大（见 zoomToT 注释）
    track = document.createElement('div');
    track.className = 'jp-wm-track';
    thumb = document.createElement('div');
    thumb.className = 'jp-wm-thumb';
    track.appendChild(thumb);
    // 滑条右侧的"当前比例"读数**已删**（用户 2026-09-16："滑条游标右侧不要再显示比例尺具体数值了"）
    const minus = mkBtn('−', '缩小', () => zoom(1.3));
    wrapScale.append(plus, track, minus);

    strip.append(upBtn, centerBtn, dimBtn, poiBtn, labelBtn, wrapScale);
    track.addEventListener('pointerdown', (e) => {
      try {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);   // 合成事件下会抛，别让它打断缩放
      } catch { /* 同上 */ }
      e.preventDefault();
      setZoomFromTrack(e.clientY);
    });
    track.addEventListener('pointermove', (e) => {
      if (e.buttons & 1) setZoomFromTrack(e.clientY);
    });
  }

  /**
   * 滑块位置 ↔ 缩放（对数刻度，手感均匀）。
   * `unit` = 世界单位/像素 → **越大越缩小**；滑块**顶端 = 最放大**（unit 最小），与"上端 + / 下端 −"一致。
   */
  function zoomToT(unit: number): number {
    const lo = Math.log(ZOOM_MIN), hi = Math.log(ZOOM_MAX);
    return (Math.log(unit) - lo) / (hi - lo);
  }
  function tToZoom(t: number): number {
    const lo = Math.log(ZOOM_MIN), hi = Math.log(ZOOM_MAX);
    return Math.exp(lo + Math.max(0, Math.min(1, t)) * (hi - lo));
  }
  function syncSlider(): void {
    if (!thumb || !track) return;
    const t = zoomToT(view.unit);
    const top = Math.round(t * (track.clientHeight - 8) + 4);
    thumb.style.top = `${top}px`;
  }
  function setZoomFromTrack(clientY: number): void {
    const r = track.getBoundingClientRect();
    const t = (clientY - r.top - 4) / Math.max(1, r.height - 8);
    const next = tToZoom(t);
    view.unit = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    syncSlider();
    draw();
  }

  /**
   * 把"窗口标题栏要显示的东西"推给 React（`PanelShell` 渲染）。
   * 关闭按钮由 PanelShell 自带；这里只出**面包屑**与"非激活半透明"开关状态。
   */
  function syncChrome(): void {
    const g = curGroup();
    const crumbs: { text: string; go: (() => void) | null }[] = [
      { text: g?.name ?? '大陆', go: state.level === 2 && g ? () => goTo({ level: 1, groupId: g.id, mapId: null }) : null },
    ];
    if (state.mapId !== null) crumbs.push({ text: mapLabel(state.mapId), go: null });
    opts.onChrome?.({ crumbs, dim: dimUnfocused });

    // 竖条按钮状态
    upBtn.disabled = parentTarget() === null;
    centerBtn.classList.toggle('on', followPlayer);
    dimBtn.classList.toggle('on', dimUnfocused);
    poiBtn.classList.toggle('on', poiMode !== 'off');
    labelBtn.classList.toggle('on', labelsOn);

    // 图例只在真的画了点位的层显示（区域层不画点位 → 也不显示图例）
    const showLegend = poiMode !== 'off' && state.level === 2;
    legend.style.display = showLegend ? '' : 'none';
    legend.innerHTML = showLegend
      ? `<i class="g">◆</i> 传送门${poiMode === 'all' ? '　<i class="s">●</i> 出生点' : ''}`
      : '';
    syncSlider();
    syncCoords();
  }

  /**
   * 跟随换图：玩家换到别的地图时，把视图切过去。
   *
   * 只在**玩家确实换了图**时动作（按 mapId 去重，不是按坐标）——否则玩家在同一张图里跑动
   * 会每帧把我们强行拉回他身边，就没法一边跑一边看地图别处了。
   * 用户手动翻去别处看不受影响：只要他不换图就不会被拉回。
   */
  let lastPlayerMapId = -1;
  function syncToPlayer(): boolean {
    if (!openAtPlayer) return false;
    const p = opts.getPlayer?.();
    if (!p || typeof p.mapId !== 'number' || !maps.has(p.mapId)) return false;
    if (p.mapId === lastPlayerMapId) return false;
    lastPlayerMapId = p.mapId;
    if (state.level === 2 && state.mapId === p.mapId) {
      // 已经在看这张图（例如刚 show 时定位过）→ 只把位置记下，不动视图
      draw();
      return false;
    }
    goTo({ level: 2, groupId: layerOf(p.mapId)?.id ?? 'continent', mapId: p.mapId });
    return true;
  }

  /** 坐标：右上 = 鼠标指向；右下 = 玩家当前（都忽略 y） */
  function syncCoords(): void {
    mouseCoord.textContent = mouseWorld
      ? `(${Math.round(mouseWorld[0])}, ${Math.round(mouseWorld[1])})` : '';
    const p = opts.getPlayer?.();
    selfCoord.textContent = p && typeof p.x === 'number' && typeof p.z === 'number'
      ? `(${Math.round(p.x)}, ${Math.round(p.z)})` : '';
  }

  // ── 导航 ──────────────────────────────────────────────────────────
  /**
   * 跳到某个层级/地图。
   *
   * `fit` = 是否**重新取景**（会改缩放）。默认 **false**：切图只改中心、**保持玩家设定的缩放**
   * （用户 2026-09-16："切换地图后缩放比例被改了"）。
   * 只有"刚打开地图"这一次需要重新取景（那时还没有"玩家的缩放"可言）。
   */
  function goTo(next: Partial<WorldMapState>, opts2?: { fit?: boolean }): void {
    let s: WorldMapState = { ...state, ...next };
    // 区域 id 认不出来（手改 URL / 分组表改过）→ 退回大陆，不留在半坏状态
    if (!groupById(s.groupId)) {
      console.warn('[worldmap] 未知区域 ' + s.groupId + ' → 退回大陆');
      s = { level: 1, groupId: 'continent', mapId: null };
    }
    Object.assign(state, s);
    const ids = idsOfState();
    const list = ids.length ? ids : (groupById('continent')?.mapIds ?? []);
    if (opts2?.fit) fitTo(list);
    else centerOnBox(list);   // 只居中，**不动缩放**
    hoverId = null;
    hoverPoi = null;
    syncChrome();
    draw();
    opts.onLevelChange?.({ ...state });
  }

  function up(): void {
    if (state.level !== 2) return;   // 区域层已是顶层
    // 单图 → 它所属的区域（大陆图 → 大陆；副本 → 它那个家族）
    const g = layerOf(state.mapId ?? -1);
    goTo(g ? { level: 1, groupId: g.id, mapId: null } : { level: 1, groupId: 'continent', mapId: null });
  }

  /** 把我放到画面中央（**不改缩放**；玩家没坐标就居中到它那张图） */
  /**
   * 把我放到画面中央（竖条第 2 项）。
   *
   * ⚠ **不只是移坐标 —— 玩家不在当前显示的那张图上时，要连图一起切过去**
   * （用户 2026-09-15："你打开了 A 地图，自己在 B 地图，难道不应该……打开 B 地图吗？"）。
   *   · 同一张图 / 同一区域（区域层且玩家在本区域）→ **只居中，不改缩放**
   *   · 否则 → 切到玩家所在那张图（切换要重新取景，故这种情形会改缩放）
   */
  /** 开/关"跟随玩家"（竖条第 2 颗按钮）。开启时立刻居中一次，之后每帧跟随 */
  function setFollowPlayer(v: boolean): void {
    followPlayer = v;
    if (v) centerOnPlayer();
    syncChrome();
  }

  function centerOnPlayer(): void {
    const p = opts.getPlayer?.();
    if (!p) return;
    const g = layerOf(p.mapId);
    const sameMap = state.level === 2 && state.mapId === p.mapId;
    const sameRegion = state.level === 1 && !!g && state.groupId === g.id;
    // 玩家不在当前显示的这张图/这个区域上 → **连图一起切过去**（切换本就要重新取景）
    if (!sameMap && !sameRegion) {
      goTo({ level: 2, groupId: g?.id ?? 'continent', mapId: p.mapId });
      return;
    }
    // 同一张图 / 同一区域 → 只居中，**不改缩放**（用户定的那条）
    if (typeof p.x === 'number' && typeof p.z === 'number') {
      view.cx = p.x;
      view.cz = p.z;
    } else {
      const m = maps.get(p.mapId);
      if (!m) return;
      view.cx = (m.box.minX + m.box.maxX) / 2;
      view.cz = (m.box.minZ + m.box.maxZ) / 2;
    }
    draw();
  }

  function zoom(factor: number, anchor?: [number, number]): void {
    const [ax, ay] = anchor ?? [canvas.clientWidth / 2, canvas.clientHeight / 2];
    const [bx, bz] = toWorld(ax, ay);
    view.unit = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.unit * factor));
    const [nx, nz] = toWorld(ax, ay);
    view.cx += bx - nx;
    view.cz += bz - nz;
    syncSlider();
    draw();
  }

  function pick(wx: number, wz: number): void {
    if (state.level === 1) {
      const g = curGroup();
      if (!g) return;
      const id = mapAt(wx, wz, g.mapIds);
      if (id === null) return;
      opts.onPick?.(id);
      if (browse) goTo({ level: 2, groupId: g.id, mapId: id });
    }
  }

  function setDimUnfocused(v: boolean): void {
    dimUnfocused = v;
    saveUiPrefs({ worldMapDim: v });
    syncChrome();   // 把新的开关状态推给 PanelShell（它负责真正的半透明）
  }

  function setLabels(v: boolean): void {
    labelsOn = v;
    saveUiPrefs({ worldMapLabels: v });
    syncChrome();
    draw();
  }

  function setPoiMode(m: PoiMode): void {
    poiMode = m;
    saveUiPrefs({ worldMapPoi: poiMode });
    syncChrome();
    draw();
  }

  function cyclePoi(): void {
    setPoiMode(poiMode === 'off' ? 'gates' : poiMode === 'gates' ? 'all' : 'off');
  }

  // ── 输入 ──────────────────────────────────────────────────────────
  function localXY(e: MouseEvent): [number, number] {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // 窗口拖动 / 缩放 / 主题焦点的进出，全部由 `PanelShell` 负责（那是"窗口"的事）。
  // 这里只剩**地图自己的平移**：在画布上按住拖动 = 移动视野。
  //
  // ⚠ 平移的 move/up 必须挂在 **window** 上，不能只挂 canvas（用户 2026-09-16 实测：
  //   "按住拖拽拖不动，鼠标变禁止行动，松开后地图粘在鼠标上"）。三个原因叠在一起：
  //   ① 只挂 canvas ⇒ 指针一离开画布就断（拖不动）；
  //   ② pointerdown 不 `preventDefault()` ⇒ 浏览器启动**原生拖拽**（那个"禁止"光标就是它，
  //      而且它会接管鼠标事件，页面收不到 pointermove/pointerup）；
  //   ③ pointerup 没落回页面 ⇒ drag 没清 ⇒ 之后指针一动就继续平移（"粘住"）。
  let drag: { kind: 'pan'; x: number; y: number } | null = null;
  let moved = false;
  function onPointerUp(): void { drag = null; }
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  /** 平移：window 级（拖出画布/拖到别的面板上都继续，直到松手） */
  function onPanMove(e: PointerEvent): void {
    if (drag?.kind !== 'pan') return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    view.cx -= dx * view.unit;
    view.cz -= dy * view.unit;
    drag = { kind: 'pan', x: e.clientX, y: e.clientY };
    draw();
  }
  window.addEventListener('pointermove', onPanMove);

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // 阻止浏览器原生拖拽（图片/canvas 的默认 drag）与文本选择 —— 少了这句，
    // 拖拽会被浏览器接管：显示"禁止"光标、且页面收不到后续 pointer 事件。
    e.preventDefault();
    // 手动平移 = 想自己看 → 自动关掉跟随（否则"拖了又被拉回"，看起来像卡住）
    if (followPlayer) { followPlayer = false; syncChrome(); }
    drag = { kind: 'pan', x: e.clientX, y: e.clientY };
    moved = false;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) return;   // 拖动中：平移由 window 级统一处理（含拖出画布），这里不重复
    const [sx, sy] = localXY(e);
    const [wx, wz] = toWorld(sx, sy);
    mouseWorld = [wx, wz];
    const poi = poiAt(sx, sy);
    const ids = layerMapIds();
    const id = mapAt(wx, wz, ids);
    if (poi !== hoverPoi) { hoverPoi = poi; draw(); }
    if (id !== hoverId) { hoverId = id; draw(); }
    // 悬停**不换光标**（用户 2026-09-16："算了，不要 pickup 了，保持默认吧"）：
    // 地图上移动始终是游戏默认光标。悬停反馈由地图自身的高亮承担（见 drawMap 的 hoverable）。
    //
    // ⚠ 也绝不能写 `canvas.style.cursor = 'help'/'pointer'`（我原来就是那么写的，被用户指出）：
    //   游戏光标设在 `document.documentElement`、**靠继承传播**，子元素自己设 cursor 就会
    //   把它覆盖成**系统箭头** —— 表现是"一进地图，PT 的光标图标就没了"。
    if (poi) {
      tip.style.display = 'block';
      tip.style.left = `${sx + 14}px`;
      tip.style.top = `${sy + 14}px`;
      tip.textContent = poi.kind === 'gate'
        ? `传送门\n${poi.to?.length ? poi.to.map((d) => `→ ${d.name}（${d.level}）`).join('\n') : '（无目的地）'}`
        : '出生点';
    } else {
      tip.style.display = 'none';
    }
    syncCoords();
  });
  canvas.addEventListener('pointerleave', () => {
    mouseWorld = null;
    hoverPoi = null;
    tip.style.display = 'none';
    syncCoords();
    draw();
  });
  canvas.addEventListener('click', (e) => {
    if (moved) { moved = false; return; }
    const [sx, sy] = localXY(e);
    const [wx, wz] = toWorld(sx, sy);
    pick(wx, wz);
  });
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); up(); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom(Math.exp(e.deltaY * 0.0012), localXY(e));
  }, { passive: false });

  /**
   * ESC = **关闭**（用户 2026-09-15："我认为应该直接关闭窗口"）。
   * 原来写的是"单图层 → 回区域、区域层 → 关闭"的逐级回退，但 ESC 在玩家心里是"关掉当前这个"，
   * 想回上一级用图上那颗 `↑`（或右键）—— 那才是明确的层级操作。
   *
   * ⚠ 只在**它是栈顶**时响应：大地图开着的玩家再打开背包，此刻栈顶是面板容器，
   * ESC 该关的是背包（那由面板自己的处理负责），不能顺手把地图也关了。
   */
  // Esc 关闭：走 `main.ts` 的统一分级（它只看 `openPanels`，地图并进来后自动生效），
  //   这里不再自己抢 Esc —— 以前那套 `isTopLayer('worldmap')` 判据是"自带窗口"时代的产物。
  // 窗口尺寸变化：`PanelShell` 改尺寸 → 内容容器跟着变 → ResizeObserver 触发重算画布（见下）。

  // 分组表体检：不通过要说出来（不然界面只是"少了几张图"，没人知道为什么）。
  // 原来它还渲染一条壳内提示条；窗口合并到 PanelShell 后没有"壳"可放 —— 走 console.error，
  // 不再需要用户盯着一块红条看（数据问题应该在日志里被看见，而不是在 UI 里被忽略）。
  const problems = checkGroups(FIELDS.map((f) => f.id));
  if (problems.length > 0) console.error('[worldmap] 大陆/分组自检未通过: ' + problems.join('; '));

  buildStrip();
  syncChrome();
  // ⚠ 层的声明**不在这里**了：窗口是 `PanelShell` 渲染的（它带 `data-layer="panel:worldmap"`），
  //   地图只提供内容。历史上这里有 `win.dataset.layer` + `root.dataset.layerHostContainer`
  //   —— 那是"自带一套窗口"的产物，也正是"地图被世界层盖住、一个像素看不见"那类坑的温床。

  /** 挂载后的初始化（由 `WorldMapPanel` 在 useEffect 里调）：定位到玩家所在图 + 启动重绘 */
  function show(): void {
    if (visible) return;
    visible = true;
    // 进地图时把光标收回**游戏默认图标**：否则"进图前指着的怪/道具"留下的 attack/pickup
    // 会跟着带进地图（地图上不再有那些目标，光标却不还原）。
    setCursorMode('default');
    resizeCanvas();
    // 默认"一开就是我在的地方"（像 FF14）：副本里 → 直接是该副本；野外 → 直接是所在的那张图，
    // 右键/↑ 再退回它的区域、再退回世界。宿主想自己控层级（URL 状态、自检）就把 openAtPlayer 设 false。
    const p = openAtPlayer ? opts.getPlayer?.() : null;
    if (p && maps.has(p.mapId)) {
      // 刚打开 → 重新取景（`fit: true`）：这一次要"把玩家所在图铺满视野"
      goTo({ level: 2, groupId: layerOf(p.mapId)?.id ?? 'continent', mapId: p.mapId }, { fit: true });
      lastPlayerMapId = p.mapId;   // 已经定位过了，别让 syncToPlayer 再切一次
    } else {
      goTo({ level: 1, groupId: 'continent', mapId: null }, { fit: true });
    }
    requestAnimationFrame(tick);
    opts.onVisibility?.(true);
  }
  /** 卸载前收尾（由 `WorldMapPanel` 的 useEffect cleanup 调）：停重绘 + 收提示 */
  function hide(): void {
    if (!visible) return;
    visible = false;
    tip.style.display = 'none';
    opts.onVisibility?.(false);
  }

  return {
    /** 内容根元素（`PanelShell` 的 body 里那一层）。**不是窗口** —— 窗口由 PanelShell 渲染 */
    el: body,
    show,
    hide,
    goTo,
    getState: () => ({ ...state }),
    focusMap(mapId: number) {
      if (maps.has(mapId)) fitTo([mapId]);
      draw();
    },
    centerOnPlayer,
    syncToPlayer,
    worldToScreen: toScreen,
    screenToWorld: toWorld,
    redraw: draw,
    destroy() {
      visible = false;   // 停掉重绘循环（否则 rAF 会一直跑在已移除的组件上）
      window.removeEventListener('pointerup', onPointerUp);
      ro?.disconnect();
      body.remove();
    },
    isDimUnfocused: () => dimUnfocused,
    setDimUnfocused,
    isLabelsOn: () => labelsOn,
    setLabels,
    getPoiMode: () => poiMode,
    setPoiMode,
    getPois: () => visiblePois(),
    getDrawnMapIds: () => layerMapIds(),
    getDrawnEntities: () => drawnEntities(),
    getVisibleGroups: () => visibleGroups(),
    getParentTarget: () => parentTarget(),
    getZoom: () => view.unit,
    getLastEntityDraws: () => lastEntityDraws.slice(),
    getMarkerStates() {
      const out: Record<string, string> = {};
      for (const k of ['arrow', 'npc'] as const) {   // 怪物是画出来的三角；队友是画的蓝方块，均无图标
        const im = markers[k];
        out[k] = im
          ? (im instanceof HTMLCanvasElement ? `${im.width}x${im.height}` : `${im.naturalWidth}x${im.naturalHeight}`)
          : '未加载';
      }
      return out;
    },
    whenImagesReady(ids) {
      const list = ids ?? [...maps.keys()];
      return Promise.all(list.map((id) => new Promise<void>((res) => {
        const e = maps.get(id);
        if (!e) { res(); return; }
        const img = e.img ?? loadImage(id);
        if (!img || (img.complete && img.naturalWidth > 0)) { res(); return; }   // 已就绪或已失败
        const done = (): void => { res(); };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }))).then(() => undefined);
    },
    getImageState(mapId) {
      const e = maps.get(mapId);
      if (!e) return { status: 'none', natural: '-' };
      if (e.failed) return { status: 'failed', natural: '-' };
      const img = e.img ?? loadImage(mapId);
      if (!img) return { status: 'failed', natural: '-' };
      const ok = img.complete && img.naturalWidth > 0;
      return { status: ok ? 'ok' : 'loading', natural: `${img.naturalWidth}x${img.naturalHeight}` };
    },
  };
}
