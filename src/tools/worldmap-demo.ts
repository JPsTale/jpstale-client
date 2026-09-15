/**
 * 大地图 demo（`worldmap.html`）—— 世界 → 区域 → 地图 三级。
 *
 * 数据全部来自已烘的平面图：`/res/image/planemap/<mapId>.png`，
 * **统一比例尺**（1px = `scale` 世界单位、像素 (0,0) ↔ AABB 西北角），
 * 所以任何一级都是"把若干张图按世界坐标摆上去、再决定看哪一块" —— 不需要为每一级各做一套资产。
 *
 * 判据（见 `src/maps/planemap-regions.ts` 顶部）：
 *   · 世界图 = 原版给了独立 guide-map 贴图的 26 张（紧贴的一整块大陆）
 *   · 区域   = 我们按资产目录 + 地理划的 6 个地理区 + 4 个列表区（副本等没有共同坐标）
 *
 * 交互：左键下钻（世界→区域→地图）、右键/Esc 上升、滚轮缩放、拖拽平移、面包屑可点。
 * URL 可带状态，便于分享/截图：`?level=1&region=ice`、`?level=2&map=3`。
 */
import { FIELDS, fieldOf } from '../maps/map-data.js';
import levelData from '../maps/map-levels.generated.json';
import {
  WORLD_MAP_IDS, OFFWORLD_GROUPS, offworldGroupOf, groupById, checkGroups, type OffworldGroup,
} from '../maps/planemap-regions.js';
import { t } from '../i18n/index.js';

interface Box { minX: number; minZ: number; maxX: number; maxZ: number }

const OUT_DIR = 'image/planemap';
const q = new URLSearchParams(location.search);

/**
 * 比例尺与图片扩展名：以 `index.json`（烘焙的元数据）为准，URL 可覆盖。
 * 不写死 `.png` —— 换格式（WebP，见 docs/planemap-bake.md）时页面要跟着走。
 */
let SCALE = Number(q.get('scale') ?? '') || 0;
let EXT = q.get('format') === 'webp' ? 'webp' : q.get('format') === 'png' ? 'png' : '';
const OUT_INDEX = `/res/${OUT_DIR}/index.json`;

async function readIndex(): Promise<void> {
  try {
    const res = await fetch(OUT_INDEX, { cache: 'no-store' });
    if (!res.ok) return;
    const j = await res.json() as { scale?: number; format?: string };
    if (!SCALE) SCALE = Number(j.scale ?? 0);
    if (!EXT) EXT = j.format === 'webp' ? 'webp' : 'png';
  } catch { /* 读不到就用默认（下面兜底） */ }
  if (!SCALE) SCALE = 16;
  if (!EXT) EXT = 'png';
}

interface MapEntry { id: number; name: string; box: Box; img: HTMLImageElement | null; failed: boolean }
const maps = new Map<number, MapEntry>();

function mapBox(id: number): Box | null {
  const f = fieldOf(id) as unknown as { bounds?: Box } | null;
  return f?.bounds ?? null;
}

function loadImage(id: number): HTMLImageElement | null {
  const e = maps.get(id);
  if (!e) return null;
  if (e.img) return e.img;
  if (e.failed) return null;
  const img = new Image();
  img.src = `/res/${OUT_DIR}/${id}.${EXT}`;
  img.onerror = () => { e.failed = true; };
  e.img = img;
  return img;
}

// ── 状态 ────────────────────────────────────────────────────────────
interface View { cx: number; cz: number; unit: number }   // unit = 世界单位/屏幕像素
type State = { level: 0 | 1 | 2; regionId: string | null; mapId: number | null };

const state: State = { level: 0, regionId: null, mapId: null };
let view: View = { cx: 0, cz: 0, unit: 40 };

/** 当前所在的分组（世界图之外的家族）；大陆上的图没有分组 */
function curGroup(): OffworldGroup | null {
  return groupById(state.regionId);
}

/**
 * 地图等级门槛（`gamedb.maplist.levelreq`；见 `scripts/extract-map-levels.ts` 与
 * `src/maps/map-levels.generated.json`）。**0/1 = 无实质限制**（PT 角色从 1 级起），
 * 只有 >1 才是真的等级门 —— 那种才在名字后面加括号（用户 2026-09-15 要求）。
 */
const LEVELS: Record<string, number> = levelData.levels as Record<string, number>;

/** 地图显示名 + 等级门：`失落神殿（98）`；无限制时不加括号 */
function mapLabel(id: number): string {
  const name = maps.get(id)?.name ?? `#${id}`;
  const lv = LEVELS[String(id)] ?? 0;
  return lv > 1 ? `${name}（${lv}）` : name;
}

/** 一组地图的世界包围盒 */
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
  if (state.level === 0) return WORLD_MAP_IDS;
  if (state.level === 1) return curGroup()?.mapIds ?? [];
  return state.mapId === null ? [] : [state.mapId];
}

/**
 * 当前层要显示的全部地图（含被压暗的上下文）。
 * 区域层一律平铺；压暗的背景取"该层的参照集"：
 *   · 世界层        → 无背景（就是世界图本身）
 *   · 大陆的区域层   → 其余大陆地图压暗（对照位置）
 *   · 副本等区域层   → 该区域其余地图压暗（同一家族的其他楼层）—— 它们不在世界图上，
 *                     拉大陆当背景既是错的（共用坐标会重叠）也没意义
 */
function contextIds(): { main: number[]; dim: number[] } {
  if (state.level === 0) return { main: WORLD_MAP_IDS, dim: [] };
  const main = idsOfState();
  const g = curGroup();
  if (!g) return { main, dim: [] };
  // 组视图：同组其余成员压暗作参照（它们不在世界图上，拉大陆当背景没意义）
  return { main, dim: g.mapIds.filter((id) => !main.includes(id)) };
}

// ── 画布 ────────────────────────────────────────────────────────────
const canvas = document.getElementById('cv') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let hoverId: number | null = null;

function fitTo(ids: number[], pad = 0.06): void {
  const b = unionBox(ids);
  if (!b) return;
  const w = Math.max(b.maxX - b.minX, 1);
  const h = Math.max(b.maxZ - b.minZ, 1);
  const s = Math.min(canvas.clientWidth, canvas.clientHeight) * (1 - pad * 2);
  view = { cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, unit: Math.max(w, h) / s };
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

function drawMap(id: number, alpha: number, outline: boolean): void {
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
    ctx.fillRect(x, y, w, h);   // 未就绪/缺图：涂个底，不静默留白
  }
  if (outline) {
    ctx.strokeStyle = hoverId === id ? '#ffd479' : 'rgba(255,255,255,.35)';
    ctx.lineWidth = hoverId === id ? 2 : 1;
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

function draw(): void {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  // 世界图底色 = 海色（平面图里水面是透明的，这层底就是"水"）
  ctx.fillStyle = '#1d4260';
  ctx.fillRect(0, 0, w, h);

  const { main, dim } = contextIds();
  const dimmed = state.level >= 1;
  for (const id of dim) drawMap(id, dimmed ? 0.14 : 1, false);
  for (const id of main) drawMap(id, 1, state.level >= 1);

  // 地图名（图够大才画；随缩放自适应，避免糊成一团）
  const showNames = state.level >= 1;
  for (const id of main) {
    const m = maps.get(id);
    if (!m) continue;
    const [x, y, bw, bh] = boxOnScreen(m.box);
    if (!showNames && Math.min(bw, bh) < 74) continue;
    if (Math.min(bw, bh) < 42) continue;
    label(mapLabel(id), x + bw / 2, y + bh / 2, Math.min(18, Math.max(11, Math.min(bw, bh) / 9)));
  }

  // 世界层不画区域名 —— 大陆不分区，每张地图自己就是可点单位（悬停描边见 drawMap）
}

function resize(): void {
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * devicePixelRatio);
  canvas.height = Math.round(r.height * devicePixelRatio);
  draw();
}

// ── 命中判定 ────────────────────────────────────────────────────────
/** 点落在哪张图上：取面积最小的命中者（大图常压着小图，比如副本压在野外上） */
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

// ── 导航 ────────────────────────────────────────────────────────────
function go(next: State): void {
  // 分组 id 认不出来（手改 URL / 分组表改过）→ 退回世界层，不留在半坏状态
  if (next.level === 1 && !groupById(next.regionId)) {
    console.warn('[worldmap] 未知分组 ' + next.regionId + ' → 退回世界层');
    next = { level: 0, regionId: null, mapId: null };
  }
  Object.assign(state, next);
  const ids = idsOfState();
  fitTo(ids.length ? ids : WORLD_MAP_IDS);
  hoverId = null;
  syncChrome();
  redrawAll();
}

function down(wx: number, wz: number): void {
  // 世界层：大陆上每张地图单独可点 → 直接进单图（不经过任何"区域"）
  if (state.level === 0) {
    const id = mapAt(wx, wz, WORLD_MAP_IDS);
    if (id === null) return;
    const g = offworldGroupOf(id);   // 大陆图没有分组 → regionId 保持 null
    go({ level: 2, regionId: g?.id ?? null, mapId: id });
    return;
  }
  if (state.level === 1) {
    const g = curGroup();
    if (!g) return;
    const id = mapAt(wx, wz, g.mapIds);
    if (id === null) return;
    go({ level: 2, regionId: g.id, mapId: id });
  }
}

function up(): void {
  if (state.level === 2) {
    const g = offworldGroupOf(state.mapId ?? -1);
    // 大陆图没有分组 → 直接回世界层（世界 → 地图 两级）
    go(g ? { level: 1, regionId: g.id, mapId: null } : { level: 0, regionId: null, mapId: null });
  } else if (state.level === 1) {
    go({ level: 0, regionId: null, mapId: null });
  }
}

// ── 界面（面包屑 / 侧栏）────────────────────────────────────────────
const crumb = document.getElementById('crumb')!;
const side = document.getElementById('side')!;

function syncChrome(): void {
  crumb.innerHTML = '';
  const parts: { text: string; act: (() => void) | null }[] = [{ text: '大陆', act: state.level > 0 ? () => go({ level: 0, regionId: null, mapId: null }) : null }];
  const g = curGroup();
  if (g) parts.push({ text: g.name, act: state.level > 1 ? () => go({ level: 1, regionId: g.id, mapId: null }) : null });
  if (state.mapId !== null) parts.push({ text: maps.get(state.mapId)?.name ?? `#${state.mapId}`, act: null });
  parts.forEach((p, i) => {
    if (i > 0) crumb.appendChild(document.createTextNode(' › '));
    const el = document.createElement('span');
    el.textContent = p.text;
    if (p.act) { el.className = 'link'; el.onclick = p.act; }
    crumb.appendChild(el);
  });

  side.innerHTML = '';
  const add = (title: string, sub: string | null, act: () => void, on: boolean): void => {
    const b = document.createElement('button');
    b.className = 'item' + (on ? ' on' : '');
    b.innerHTML = `<span>${title}</span>${sub ? `<em>${sub}</em>` : ''}`;
    b.onclick = act;
    side.appendChild(b);
  };
  if (state.level === 0) {
    // 左栏是**层级选择器**，不是地图清单：大陆只有一项（26 张图在世界图上直接点，不在这里铺开）
    const head = document.createElement('div');
    head.className = 'head';
    head.textContent = `层级（1px = ${SCALE} 世界单位）`;
    side.appendChild(head);
    add('大陆', `${WORLD_MAP_IDS.length} 张 · 在地图上直接点图`, () => go({ level: 0, regionId: null, mapId: null }), true);
    const head2 = document.createElement('div');
    head2.className = 'head';
    head2.textContent = '世界图之外（不在大陆上，按家族/类型分组）';
    side.appendChild(head2);
    for (const g of OFFWORLD_GROUPS) {
      add(g.name, `${g.mapIds.length} 张`, () => go({ level: 1, regionId: g.id, mapId: null }), false);
    }
  } else if (state.level === 1) {
    const g = curGroup()!;
    const head = document.createElement('div');
    head.className = 'head';
    head.textContent = `${g.name}　${g.note ?? ''}`;
    side.appendChild(head);
    for (const id of g.mapIds) add(mapLabel(id), null, () => go({ level: 2, regionId: g.id, mapId: id }), state.mapId === id);
  } else {
    const m = state.mapId!;
    const head = document.createElement('div');
    head.className = 'head';
    head.textContent = '地图';
    side.appendChild(head);
    add(mapLabel(m), `#${m}`, () => {}, true);
    const back = document.createElement('button');
    back.className = 'item';
    const g = offworldGroupOf(m);
    back.innerHTML = `<span>← 返回${g ? g.name : '大陆'}</span>`;
    back.onclick = up;
    side.appendChild(back);
  }
}

/** 区域层一律平铺，没有卡片网格了；这里只确保画布可见 */
function redrawAll(): void { canvas.style.display = 'block'; draw(); }

// ── 事件 ────────────────────────────────────────────────────────────
let drag: { x: number; y: number } | null = null;
let moved = false;

function localXY(e: MouseEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) { drag = { x: e.clientX, y: e.clientY }; moved = false; }
});
window.addEventListener('mouseup', () => { drag = null; });
canvas.addEventListener('mousemove', (e) => {
  const [sx, sy] = localXY(e);
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    view.cx -= dx * view.unit;
    view.cz -= dy * view.unit;
    drag = { x: e.clientX, y: e.clientY };
    draw();
    return;
  }
  const [wx, wz] = toWorld(sx, sy);
  const ids = state.level === 0 ? WORLD_MAP_IDS : contextIds().main;
  const id = mapAt(wx, wz, ids);
  if (id !== hoverId) {
    hoverId = id;
    canvas.style.cursor = id !== null ? 'pointer' : 'default';
    draw();
  }
});
canvas.addEventListener('click', (e) => {
  if (moved) return;
  const [sx, sy] = localXY(e);
  const [wx, wz] = toWorld(sx, sy);
  down(wx, wz);
});
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); up(); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [sx, sy] = localXY(e);
  const [bx, bz] = toWorld(sx, sy);
  view.unit = Math.min(400, Math.max(0.6, view.unit * Math.exp(e.deltaY * 0.0012)));
  const [ax, az] = toWorld(sx, sy);
  view.cx += bx - ax;
  view.cz += bz - az;
  draw();
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { up(); return; }
  if (e.key === 'Backspace') { e.preventDefault(); up(); }
});
window.addEventListener('resize', resize);

// ── 自检（`?selftest=1`）────────────────────────────────────────────
// 无头浏览器点不了鼠标，"点击下钻/右键上升"这条链路就用状态机自检：
// 走一遍 世界→区域→地图→上升，把结果写进 #warn 与 console，`--dump-dom` 就能读。
function selftest(): void {
  const lines: string[] = [];
  const expect = (what: string, ok: boolean): void => { lines.push(`${ok ? 'PASS' : 'FAIL'} ${what}`); };
  const level = (): number => state.level;   // 走函数调用，避开 TS 对属性的字面量收窄
  const sample = (id: number): [number, number] => {
    const b = maps.get(id)!.box;
    return [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  };
  state.level = 0; state.regionId = null; state.mapId = null;

  // 大陆不分区：世界图上直接点一张图 → 直接到单图（世界 → 地图 两级）
  const [fx, fz] = sample(2);
  down(fx, fz);
  expect('世界点 fore-1 → 直接到地图 #2（中间无区域层）', level() === 2 && state.mapId === 2 && state.regionId === null);
  up();
  expect('右键 → 回世界（大陆图没有区域层）', level() === 0 && state.regionId === null && state.mapId === null);
  const [dx, dz] = sample(10);
  down(dx, dz);
  expect('世界点 desert2 → 直接到地图 #10', level() === 2 && state.mapId === 10);

  // 世界图之外：左栏进组 → 组内平铺 → 点成员进单图 → 右键回组 → 再右键回世界
  for (const gid of ['lostisle', 'prison', 'cursedtemple', 'endlesstower', 'darktemple', 'newworlds', 'kelvezu']) {
    const g = OFFWORLD_GROUPS.find((x) => x.id === gid)!;
    go({ level: 1, regionId: gid, mapId: null });
    const tiled = Number.isFinite(view.cx) && Number.isFinite(view.cz) && view.unit > 0;
    expect(`${g.name} 组视图平铺（${g.mapIds.length} 张）`, tiled && canvas.style.display !== 'none');
    const mid = g.mapIds[1] ?? g.mapIds[0];
    const [mx, mz] = sample(mid);
    down(mx, mz);
    expect(`${g.name} 平铺处点 #${mid} → 进该地图`, level() === 2 && state.mapId === mid);
    up();
    expect(`${g.name} 右键 → 回组`, level() === 1 && state.regionId === gid);
    up();
    expect(`${g.name} 再右键 → 回世界`, level() === 0);
  }

  // 世界图之外的图**不该**出现在世界层（它们与野外共用坐标，会盖住野外）
  const onWorld = OFFWORLD_GROUPS.flatMap((g) => g.mapIds).filter((id) => WORLD_MAP_IDS.includes(id));
  expect(`世界图不含非大陆地图（世界 ${WORLD_MAP_IDS.length} 张）`, onWorld.length === 0);
  // 左栏是层级选择器：第 0 层只应有「大陆」+ 8 个家族，不得把 26 张大陆图铺开
  state.level = 0; state.regionId = null; state.mapId = null;
  syncChrome();
  const items = side.querySelectorAll('.item');
  const names = [...items].map((b) => (b.querySelector('span')?.textContent ?? ''));
  expect(`大陆左栏只有层级项（${items.length} 项：大陆 + ${OFFWORLD_GROUPS.length} 个家族）`,
    items.length === OFFWORLD_GROUPS.length + 1 && names[0] === '大陆'
    && !names.some((n) => WORLD_MAP_IDS.some((id) => maps.get(id)?.name === n)));
  go({ level: 0, regionId: null, mapId: null });

  // 等级门显示规则：>1 才加括号（0/1 = 无实质限制）
  expect('等级门显示：#13 古代监狱F1（40）', mapLabel(13).endsWith('（40）'));
  expect('等级门显示：#35 冰封圣殿（90）', mapLabel(35).endsWith('（90）'));
  expect('等级门显示：无限制的图不加括号（#3 里查顿城）', !mapLabel(3).includes('（'));
  const gatedCount = FIELDS.filter((f) => (LEVELS[String(f.id)] ?? 0) > 1).length;
  expect(`等级门数据覆盖 63 张（其中 ${gatedCount} 张有门）`, FIELDS.every((f) => LEVELS[String(f.id)] !== undefined));

  const bad = checkGroups(FIELDS.map((f) => f.id));
  expect('世界图/分组不重不漏地覆盖 63 张', bad.length === 0);
  if (bad.length > 0) for (const b of bad) lines.push('  · ' + b);

  const el = document.getElementById('warn')!;
  el.style.display = 'block';
  el.textContent = lines.join(' | ');
  for (const l of lines) (l.startsWith('FAIL') ? console.error : console.log)('[selftest] ' + l);
}

// ── 启动 ────────────────────────────────────────────────────────────
const problems = checkGroups(FIELDS.map((f) => f.id));
if (problems.length > 0) {
  // 分组表自检不通过要说出来（不然界面只是"少了几张图"，没人知道为什么）
  console.warn('[worldmap] 世界图/分组自检: ' + problems.join('; '));
  const warn = document.getElementById('warn')!;
  warn.textContent = '世界图/分组自检: ' + problems.join('；');
  warn.style.display = 'block';
}

for (const f of FIELDS) {
  const box = mapBox(f.id);
  if (!box) continue;
  const key = `map.${f.id}`;
  const name = t(key);
  maps.set(f.id, { id: f.id, name: name === key ? (f.minimap ?? f.shortname) : name, box, img: null, failed: false });
}

// URL 初始状态（便于分享/截图各层）
const lv = Number(q.get('level') ?? '0');
const rid = q.get('region');
const mid = Number(q.get('map') ?? '');
if (lv === 1 && groupById(rid)) { state.level = 1; state.regionId = rid; }
else if (lv === 2 && Number.isInteger(mid) && maps.has(mid)) {
  const g = offworldGroupOf(mid);
  state.level = 2; state.mapId = mid; state.regionId = g?.id ?? null;
}
async function boot(): Promise<void> {
  await readIndex();
  resize();
  go({ level: state.level, regionId: state.regionId, mapId: state.mapId });
  if (q.get('selftest') === '1') selftest();
}
void boot();
