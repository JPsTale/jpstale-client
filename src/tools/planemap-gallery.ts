/**
 * 平面图图集（`planemap.html`，dev 页）：把 `image/planemap/` 里已烘的图列出来看。
 *
 * 只做两件事：贴图 + 核对尺寸。
 *   · 底色用海色 —— 水面（`isWater` 材质）在烘焙时被剔除，图上是**透明**的，
 *     所以页面这层底就相当于世界图的底色。
 *   · 尺寸核对：期望图幅 = `ceil(AABB / scale)`（`fields.json` 的 bounds + 页面比例尺），
 *     与 PNG 实际尺寸不符就标红 —— 数据或烘焙任一边漂移都能立刻看到。
 *
 * 比例尺优先取 `?scale=`，否则读 `index.json`（最近一次烘焙写的），最后默认 8。
 */
import { FIELDS, fieldOf } from '../maps/map-data.js';
import { t } from '../i18n/index.js';

interface BakeIndex {
  scale?: number;
  format?: 'png' | 'webp';
}

const q = new URLSearchParams(location.search);
const OUT_DIR = q.get('out') ?? 'image/planemap';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 地图显示名：i18n 有就用，否则退回 minimap / shortname */
function mapName(id: number): string {
  const key = `map.${id}`;
  const name = t(key);
  if (name !== key) return name;
  const f = fieldOf(id);
  return f?.minimap ?? f?.shortname ?? `#${id}`;
}

async function main(): Promise<void> {
  // 比例尺与扩展名都以 index.json 为准（烘焙的唯一元数据），URL 可覆盖；
  // 没有 index.json 就不做尺寸核对（不拿默认值冒充"核对通过"）。
  let scale = Number(q.get('scale') ?? '');
  let ext = q.get('format') === 'webp' ? 'webp' : q.get('format') === 'png' ? 'png' : '';
  let haveIndex = false;
  try {
    const res = await fetch(`/res/${OUT_DIR}/index.json`, { cache: 'no-store' });
    if (res.ok) {
      const j = await res.json() as BakeIndex;
      haveIndex = true;
      if (!(Number.isFinite(scale) && scale > 0)) scale = Number(j.scale ?? 0);
      if (!ext) ext = j.format === 'webp' ? 'webp' : 'png';
    }
  } catch { /* 没 index.json：下面按"无元数据"处理 */ }
  if (!ext) ext = 'png';
  const checked = haveIndex && Number.isFinite(scale) && scale > 0;
  document.getElementById('scale')!.textContent = checked
    ? `1px = ${scale} 世界单位　·　${ext}`
    : '没有 index.json（未核对尺寸）';

  const grid = document.getElementById('grid')!;
  let baked = 0;

  for (const f of FIELDS) {
    const card = el('div', 'card');
    const thumb = el('div', 'thumb');
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = mapName(f.id);
    thumb.appendChild(img);
    card.appendChild(thumb);

    const meta = el('div', 'meta');
    const name = el('div', 'name', mapName(f.id));
    name.appendChild(el('span', 'id', `#${f.id}`));
    meta.appendChild(name);
    const sub = el('div', 'sub', '…');
    meta.appendChild(sub);
    card.appendChild(meta);
    grid.appendChild(card);

    img.addEventListener('error', () => {
      card.classList.add('missing');
      img.remove();
      thumb.appendChild(el('div', 'none', '未烘焙'));
      sub.textContent = `${f.minimap ?? f.shortname}　—`;
    });
    img.addEventListener('load', () => {
      baked++;
      document.getElementById('count')!.textContent = `已烘 ${baked} / ${FIELDS.length}`;
      const b = (f as unknown as { bounds?: { minX: number; maxX: number; minZ: number; maxZ: number } }).bounds;
      if (!b || !checked) { sub.textContent = `${img.naturalWidth}×${img.naturalHeight}（无元数据，未核对）`; return; }
      const ew = Math.ceil((b.maxX - b.minX) / scale);
      const eh = Math.ceil((b.maxZ - b.minZ) / scale);
      const ok = ew === img.naturalWidth && eh === img.naturalHeight;
      sub.innerHTML = '';
      sub.appendChild(document.createTextNode(`${img.naturalWidth}×${img.naturalHeight}`));
      sub.appendChild(document.createTextNode(`　期望 ${ew}×${eh}　`));
      if (ok) sub.appendChild(document.createTextNode('✓'));
      else sub.appendChild(el('span', 'bad', '尺寸不符'));
      const a = el('a', undefined, '原图');
      a.href = `/res/${OUT_DIR}/${f.id}.${ext}`;
      a.target = '_blank';
      sub.appendChild(document.createTextNode('　'));
      sub.appendChild(a);
    });
    img.src = `/res/${OUT_DIR}/${f.id}.${ext}`;
  }
}

void main();
