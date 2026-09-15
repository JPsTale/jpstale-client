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
import { loadUiImage, tintUiImage } from '../render/ui-texture.js';
import { bringToFront, isTopLayer } from './layerStack.js';

interface Box { minX: number; minZ: number; maxX: number; maxZ: number }
interface MapEntry { id: number; name: string; box: Box; img: HTMLImageElement | null; failed: boolean }
interface Rect { x: number; y: number; w: number; h: number }

/** 点位（传送门 / 出生点）—— 位置来自 `fields.json`；图标是我们画的（原版世界图上没有这些图标） */
export interface Poi {
  kind: 'gate' | 'start';
  mapId: number;
  x: number;
  z: number;
  /** gate：传送目的地（地图名 + 等级门槛），供悬停提示 */
  to?: { mapId: number; name: string; level: number }[];
}

/** 大地图上要画的实体（图标与小地图同源：`image/arrow.tga` / `npc.tga` / `party.tga`） */
export interface WorldMapEntity {
  kind: 'npc' | 'monster' | 'party';
  x: number;
  z: number;
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
  readonly el: HTMLElement;
  readonly visible: boolean;
  show(): void;
  hide(): void;
  toggle(): boolean;
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
  getWindowRect(): Rect;
  setWindowRect(r: Partial<Rect>): void;
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
const MIN_W = 520, MIN_H = 340;
/**
 * 比例尺范围（世界单位/像素，越小越放大）：**8 ~ 128**（用户 2026-09-15 定为 4~128，随后调整为 8~128）。
 * 顶端 = 8 单位/px（约 2 倍于烘图基准 16），底端 = 128 单位/px。
 */
const ZOOM_MIN = 8, ZOOM_MAX = 128;

const STYLE_ID = 'jp-worldmap-style';
const STYLE = `
/* z-index 由 layerStack 动态给（"谁激活谁最上"）——别再写死，否则又会压住后打开的面板 */
.jp-wm { position: fixed; inset: 0; display: none; pointer-events: none; }
.jp-wm.on { display: block; }
.jp-wm-win { position: absolute; display: flex; flex-direction: column; pointer-events: auto;
  background: #0d1117f2; border: 1px solid #2b3542; border-radius: 6px; overflow: hidden;
  box-shadow: 0 10px 34px #0009; color: #e6e9ee; font: 13px/1.5 "Microsoft YaHei", system-ui, sans-serif;
  transition: opacity .15s ease; }
/* 非激活（且开了"非激活时半透明"）→ 左侧控件与右下角拉伸手柄一起隐藏。
   用 visibility 而**不是** display:none —— 后者会让画布重排（地图尺寸跳一下）。 */
.jp-wm-win.unfocused .jp-wm-strip, .jp-wm-win.unfocused .jp-wm-grip { visibility: hidden; }
.jp-wm-title { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 10px; cursor: move;
  background: #161d27; border-bottom: 1px solid #2b3542; user-select: none; }
.jp-wm-crumb { font-weight: 600; white-space: nowrap; }
.jp-wm-crumb .link { color: #7fc4ff; cursor: pointer; }
.jp-wm-btns { margin-left: auto; display: flex; gap: 4px; }
.jp-wm-btn { min-width: 26px; padding: 2px 7px; background: #1d2735; border: 1px solid #33415280;
  border-radius: 4px; color: #dfe5ec; cursor: pointer; font: inherit; line-height: 1.4; }
.jp-wm-btn:hover { background: #26364a; }
.jp-wm-btn[disabled] { opacity: .4; cursor: default; }
.jp-wm-btn.on { background: #2c3f57; box-shadow: inset 0 0 0 1px #ffd47966; }
.jp-wm-btn.close:hover { background: #5a2b2b; }
.jp-wm-body { position: relative; min-height: 0; flex: 1; }
/* 左侧竖条**浮在地图之上**（不占画布宽度）—— 用户 2026-09-15："你的按钮不是浮在 canvas 上，
   而是单独占了一竖条空间"。半透明底，免得压住地图细节。 */
.jp-wm-strip { position: absolute; left: 0; top: 0; bottom: 0; z-index: 3; width: 34px;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 6px 0; background: #121821cc; border-right: 1px solid #232a3566; }
.jp-wm-strip .jp-wm-btn { min-width: 26px; padding: 2px 4px; }
.jp-wm-cvwrap { position: absolute; inset: 0; }
.jp-wm-cv { display: block; width: 100%; height: 100%; }
/* 比例尺滑块（竖排，上下两端 +/−） */
.jp-wm-scale { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-top: 2px; }
.jp-wm-track { position: relative; width: 6px; height: 132px; background: #1b2431; border: 1px solid #33415280;
  border-radius: 3px; cursor: pointer; }
.jp-wm-thumb { position: absolute; left: -6px; width: 16px; height: 8px; margin-top: -4px;
  background: #9fd0ff; border: 1px solid #2b3542; border-radius: 2px; pointer-events: none; }
/* 当前比例读数：浮在滑块右侧、与滑块同高（跟着它上下走） */
.jp-wm-scaleval { position: absolute; left: 28px; transform: translateY(-50%); white-space: nowrap;
  padding: 1px 5px; background: #0b0f14d9; border: 1px solid #33415280; border-radius: 3px;
  color: #cfe3f5; font: 11px/1.5 monospace; pointer-events: none; }
/* 坐标：右上 = 鼠标指向，右下 = 玩家 */
.jp-wm-coord { position: absolute; color: #e8eef5; font: 12px/1.4 monospace; pointer-events: none;
  text-shadow: 0 1px 2px #000c; }
.jp-wm-coord.mouse { right: 8px; top: 6px; color: #cfe3f5; }
.jp-wm-coord.self { right: 8px; bottom: 6px; color: #ffe9b0; }
.jp-wm-legend { position: absolute; left: 40px; bottom: 6px; color: #a8b6c6; font-size: 12px;
  pointer-events: none; text-shadow: 0 1px 2px #000c; }
.jp-wm-legend i { font-style: normal; }
.jp-wm-legend .g { color: #6fe3ff; }
.jp-wm-legend .s { color: #8bf08b; }
.jp-wm-tip { position: absolute; display: none; padding: 4px 7px; background: #0b0f14ee; border: 1px solid #3a4756;
  border-radius: 4px; color: #eaf0f6; font-size: 12px; pointer-events: none; white-space: pre; }
.jp-wm-grip { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 46%, #66788f 46%, #66788f 54%, transparent 54%,
    transparent 66%, #66788f 66%, #66788f 76%, transparent 76%); }
.jp-wm-warn { display: none; padding: 6px 10px; background: #4a2020; color: #ffc9c0; font-size: 12px; }
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = STYLE;
  document.head.appendChild(s);
}

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
  ensureStyle();
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
   *   队友 = party.tga（原版 `MatPartyPos`；**白点 = 17 格内、红点 = 更远**，
   *          常量取自 `character.h: PARTY_GETTING_DIST2 = (17*64)^2`。原版这段在 exm 里被注释掉了，
   *          但规则是明确的 —— 用户要求画）
   *   怪物 = 沿用 npc.tga **染红**：原版 `DrawMapNPC` 只遍历 `smCHAR_STATE_NPC`，没有怪物图标资产；
   *          "染红区分"在原版源码里有先例（队友过远即 `D3DCOLOR_RGBA(255,0,0,255)`）
   */
  const MARKER_SRC = {
    arrow: '/res/image/arrow.tga',
    npc: '/res/image/npc.tga',
    party: '/res/image/party.tga',
  } as const;
  // 值类型 = `drawImage` 的源：原色图标是 `Image`（经 loadUiImage 等过 onload），
  // 染色图标是 `HTMLCanvasElement`（同步可画，见 `tintUiImage` 的注释）
  const markers: Partial<Record<'arrow' | 'npc' | 'party' | 'monster' | 'partyFar',
    HTMLImageElement | HTMLCanvasElement>> = {};
  void (async () => {
    const [arrow, npc, party] = await Promise.all([
      loadUiImage(MARKER_SRC.arrow), loadUiImage(MARKER_SRC.npc), loadUiImage(MARKER_SRC.party),
    ]);
    if (arrow) markers.arrow = arrow;
    if (npc) { markers.npc = npc; markers.monster = tintUiImage(npc, '#ff5252'); }
    if (party) { markers.party = party; markers.partyFar = tintUiImage(party, '#ff5252'); }
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

  // ── DOM ───────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'jp-wm';
  const win = document.createElement('div');
  win.className = 'jp-wm-win';
  const title = document.createElement('div');
  title.className = 'jp-wm-title';
  const crumb = document.createElement('div');
  crumb.className = 'jp-wm-crumb';
  const btns = document.createElement('div');
  btns.className = 'jp-wm-btns';
  const warn = document.createElement('div');
  warn.className = 'jp-wm-warn';
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
  const grip = document.createElement('div');
  grip.className = 'jp-wm-grip';

  wrap.append(canvas, mouseCoord, selfCoord, legend, tip, grip);
  title.append(crumb, btns);
  body.append(wrap, strip);   // 竖条在画布之上（绝对定位，不占宽度）
  win.append(title, warn, body);
  root.append(win);
  host.appendChild(root);
  const ctx = canvas.getContext('2d')!;

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
  let focused = false;   // 鼠标是否在窗口里（决定是否半透明）

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

  // ── 窗口几何（持久化，坏数据一律回默认）───────────────────────────
  function defaultRect(): Rect {
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.max(MIN_W, Math.min(1280, Math.round(vw * 0.8)));
    const h = Math.max(MIN_H, Math.min(860, Math.round(vh * 0.8)));
    return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w, h };
  }

  let rect: Rect = prefs.worldMapRect ?? defaultRect();

  function clampRect(r: Rect): Rect {
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.max(MIN_W, Math.min(Math.max(MIN_W, vw - 16), Math.round(r.w)));
    const h = Math.max(MIN_H, Math.min(Math.max(MIN_H, vh - 16), Math.round(r.h)));
    const x = Math.max(-w + 140, Math.min(vw - 140, Math.round(r.x)));
    const y = Math.max(0, Math.min(vh - 32, Math.round(r.y)));
    return { x, y, w, h };
  }

  function setRect(r: Partial<Rect>, persist = true): void {
    rect = clampRect({ ...rect, ...r });
    win.style.left = `${rect.x}px`;
    win.style.top = `${rect.y}px`;
    win.style.width = `${rect.w}px`;
    win.style.height = `${rect.h}px`;
    resizeCanvas();
    if (persist) saveUiPrefs({ worldMapRect: rect });
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

  /** 该画的实体：单图层 + 坐标落在本图范围内的那些（区域层不画，与点位同一条规则） */
  function drawnEntities(): WorldMapEntity[] {
    if (state.level !== 2 || state.mapId === null) return [];
    const m = maps.get(state.mapId);
    if (!m) return [];
    const b = m.box;
    return (opts.getEntities?.() ?? []).filter((e) => e.x >= b.minX && e.x <= b.maxX && e.z >= b.minZ && e.z <= b.maxZ);
  }

  /** 队友"近/远"的分界：原版 PARTY_GETTING_DIST2 = (17*64)^2 → 17 格 = 1088 世界单位 */
  const PARTY_NEAR_DIST2 = (17 * 64) ** 2;

  /** 诊断：上一次 drawEntities 实际发出的绘制（自检读不到图标时用来定位是哪一步没了） */
  let lastEntityDraws: string[] = [];
  function drawEntities(): void {
    const self = opts.getPlayer?.();
    lastEntityDraws = [];
    for (const e of drawnEntities()) {
      const [sx, sy] = toScreen(e.x, e.z);
      if (e.kind === 'npc' && markers.npc) {
        ctx.drawImage(markers.npc, sx - 4, sy - 4, 8, 8);
        lastEntityDraws.push(`npc@${Math.round(sx)},${Math.round(sy)}`);
      } else if (e.kind === 'monster' && markers.monster) {
        ctx.drawImage(markers.monster, sx - 4, sy - 4, 8, 8);
        lastEntityDraws.push(`monster@${Math.round(sx)},${Math.round(sy)}`);
      } else if (e.kind === 'party') {
        const near = !!(self && typeof self.x === 'number' && typeof self.z === 'number'
          && (e.x - self.x) ** 2 + (e.z - self.z) ** 2 < PARTY_NEAR_DIST2);
        const img = near ? markers.party : markers.partyFar;
        if (img) {
          ctx.drawImage(img, sx - 4, sy - 4, 8, 8);
          lastEntityDraws.push(`party${near ? 'Near' : 'Far'}@${Math.round(sx)},${Math.round(sy)}`);
        } else {
          lastEntityDraws.push(`party${near ? 'Near' : 'Far'}@${Math.round(sx)},${Math.round(sy)}=NO_IMG`);
        }
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
    ctx.fillStyle = '#1d4260';   // 底色 = 海色（平面图里水面是透明的，这层底就相当于"水"）
    ctx.fillRect(0, 0, w, h);

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
  let dimBtn!: HTMLButtonElement;
  let poiBtn!: HTMLButtonElement;
  let labelBtn!: HTMLButtonElement;
  let track!: HTMLDivElement;
  let thumb!: HTMLDivElement;
  let scaleVal!: HTMLDivElement;

  function buildStrip(): void {
    strip.innerHTML = '';
    upBtn = mkBtn('↑', '上级地图', () => {
      const t2 = parentTarget();
      if (t2) goTo(t2);
    });
    const centerBtn = mkBtn('◎', '把我放到画面中央（不改缩放）', centerOnPlayer);
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
    scaleVal = document.createElement('div');
    scaleVal.className = 'jp-wm-scaleval';
    scaleVal.title = '当前比例尺：1 像素 = N 世界单位（1 单位 = 1cm；烘图基准 16 单位/像素）';
    track.appendChild(scaleVal);
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
    // 当前比例：`N 单位/px`（说的就是 view.unit）。跟着滑块上下走。
    scaleVal.style.top = `${top}px`;
    scaleVal.textContent = `${Math.round(view.unit)} 单位/px`;
  }
  function setZoomFromTrack(clientY: number): void {
    const r = track.getBoundingClientRect();
    const t = (clientY - r.top - 4) / Math.max(1, r.height - 8);
    const next = tToZoom(t);
    view.unit = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    syncSlider();
    draw();
  }

  function syncChrome(): void {
    crumb.innerHTML = '';
    const g = curGroup();
    const parts: { text: string; act: (() => void) | null }[] = [
      { text: g?.name ?? '大陆', act: state.level === 2 && g ? () => goTo({ level: 1, groupId: g.id, mapId: null }) : null },
    ];
    if (state.mapId !== null) parts.push({ text: mapLabel(state.mapId), act: null });
    parts.forEach((p, i) => {
      if (i > 0) crumb.appendChild(document.createTextNode(' › '));
      const el = document.createElement('span');
      el.textContent = p.text;
      if (p.act) { el.className = 'link'; el.onclick = p.act; }
      crumb.appendChild(el);
    });

    btns.innerHTML = '';
    btns.append(mkBtn('×', '关闭（M / Esc）', hide, 'close'));

    // 竖条按钮状态
    upBtn.disabled = parentTarget() === null;
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
  function goTo(next: Partial<WorldMapState>): void {
    let s: WorldMapState = { ...state, ...next };
    // 区域 id 认不出来（手改 URL / 分组表改过）→ 退回大陆，不留在半坏状态
    if (!groupById(s.groupId)) {
      console.warn('[worldmap] 未知区域 ' + s.groupId + ' → 退回大陆');
      s = { level: 1, groupId: 'continent', mapId: null };
    }
    Object.assign(state, s);
    const ids = idsOfState();
    fitTo(ids.length ? ids : (groupById('continent')?.mapIds ?? []));
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
    applyFocusStyle();
    syncChrome();
  }

  /**
   * 非激活（鼠标不在窗口里）时：窗口半透明 **+ 左侧控件与拉伸手柄隐藏**（用户 2026-09-15）。
   * 关掉这个开关就恢复 100% 不透明、控件常驻。
   */
  function applyFocusStyle(): void {
    const inactive = dimUnfocused && !focused;
    win.style.opacity = inactive ? String(dimAlpha) : '1';
    win.classList.toggle('unfocused', inactive);
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

  let drag: { kind: 'win' | 'size' | 'pan'; x: number; y: number; r: Rect } | null = null;
  let moved = false;
  function onWindowPointerDown(e: PointerEvent, kind: 'win' | 'size'): void {
    if (e.button !== 0) return;
    drag = { kind, x: e.clientX, y: e.clientY, r: { ...rect } };
    try {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);   // 合成事件下会抛，忽略即可
    } catch { /* 没有真实指针：不影响拖动逻辑（我们只读 clientX/Y） */ }
    e.preventDefault();
  }
  title.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    onWindowPointerDown(e, 'win');
  });
  grip.addEventListener('pointerdown', (e) => onWindowPointerDown(e, 'size'));
  function onPointerMove(e: PointerEvent): void {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    if (drag.kind === 'win') setRect({ x: drag.r.x + dx, y: drag.r.y + dy });
    else setRect({ w: drag.r.w + dx, h: drag.r.h + dy });
  }
  function onPointerUp(): void { drag = null; }
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  // 非激活半透明：鼠标是否在窗口里（进入 = 激活）
  win.addEventListener('pointerenter', () => { focused = true; applyFocusStyle(); });
  win.addEventListener('pointerleave', () => { focused = false; applyFocusStyle(); });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) { drag = { kind: 'pan', x: e.clientX, y: e.clientY, r: { ...rect } }; moved = false; }
  });
  canvas.addEventListener('pointermove', (e) => {
    const [sx, sy] = localXY(e);
    if (drag?.kind === 'pan') {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      view.cx -= dx * view.unit;
      view.cz -= dy * view.unit;
      drag = { kind: 'pan', x: e.clientX, y: e.clientY, r: drag.r };
      draw();
      return;
    }
    const [wx, wz] = toWorld(sx, sy);
    mouseWorld = [wx, wz];
    const poi = poiAt(sx, sy);
    const ids = layerMapIds();
    const id = mapAt(wx, wz, ids);
    if (poi !== hoverPoi) { hoverPoi = poi; draw(); }
    if (id !== hoverId) {
      hoverId = id;
      canvas.style.cursor = poi ? 'help' : id !== null ? 'pointer' : 'default';
      draw();
    }
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
  function onKey(e: KeyboardEvent): void {
    if (!visible || e.key !== 'Escape') return;
    if (!isTopLayer('worldmap')) return;
    e.preventDefault();
    e.stopPropagation();
    hide();
  }
  window.addEventListener('keydown', onKey, true);
  const onWinResize = (): void => setRect({});
  window.addEventListener('resize', onWinResize);

  // 分组表自检：不通过要说出来（不然界面只是"少了几张图"，没人知道为什么）
  const problems = checkGroups(FIELDS.map((f) => f.id));
  if (problems.length > 0) {
    console.warn('[worldmap] 大陆/分组自检: ' + problems.join('; '));
    warn.textContent = '大陆/分组自检: ' + problems.join('；');
    warn.style.display = 'block';
  }

  buildStrip();
  setRect({}, false);
  syncChrome();
  applyFocusStyle();
  // 参与"谁激活谁最上"：
  //  · 层声明在**窗口** `win` 上（能拖能关的那扇窗，才是玩家眼里的"一层"）；
  //  · 容器 `root` 声明为**宿主容器**（`data-layer-host-container`），它的 z-index 由层栈
  //    按"组内最高层"合成。
  //
  // ⚠ 容器**必须有** z-index，否则整层会被世界画面盖住 —— 而且这个坑很隐蔽：
  //   `position: fixed` **本身就会创建层叠上下文**（CSS Positioned Layout 规范），
  //   于是窗口自己的 `z-index: 103` 只在容器内有效，容器以 `z-index: auto` 参与外层，
  //   在 `#world-root{z-index:50}` 面前等同 0 ⇒ 地图窗口一个像素都看不见（用户 2026-09-16 实测截图）。
  //   最小复现：容器 `fixed + z:auto` 时子元素 z=999 依然被外层 z=50 盖住；给容器 z=100 后子元素才到最上。
  win.dataset.layer = 'worldmap';
  win.dataset.layerHost = 'worldmap';
  root.dataset.layerHostContainer = 'worldmap';

  function show(): void {
    if (visible) return;
    visible = true;
    bringToFront('worldmap');   // 刚打开 → 最上（此后点别处会被别的层顶下去）
    root.classList.add('on');
    setRect({}, false);
    resizeCanvas();
    // 默认"一开就是我在的地方"（像 FF14）：副本里 → 直接是该副本；野外 → 直接是所在的那张图，
    // 右键/↑ 再退回它的区域、再退回世界。宿主想自己控层级（URL 状态、自检）就把 openAtPlayer 设 false。
    const p = openAtPlayer ? opts.getPlayer?.() : null;
    if (p && maps.has(p.mapId)) {
      goTo({ level: 2, groupId: layerOf(p.mapId)?.id ?? 'continent', mapId: p.mapId });
      lastPlayerMapId = p.mapId;   // 已经定位过了，别让 syncToPlayer 再切一次
    } else {
      goTo({ level: 1, groupId: 'continent', mapId: null });
    }
    requestAnimationFrame(tick);
    opts.onVisibility?.(true);
  }
  function hide(): void {
    if (!visible) return;
    visible = false;
    root.classList.remove('on');
    tip.style.display = 'none';
    opts.onVisibility?.(false);
  }

  return {
    el: root,
    get visible() { return visible; },
    show,
    hide,
    toggle() { visible ? hide() : show(); return visible; },
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
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onWinResize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      root.remove();
    },
    getWindowRect: () => ({ ...rect }),
    setWindowRect: (r) => setRect(r),
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
      for (const k of ['arrow', 'npc', 'monster', 'party', 'partyFar'] as const) {
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
