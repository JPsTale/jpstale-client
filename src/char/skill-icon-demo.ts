/**
 * Skill Icon Compare — 并排查看 apps(exm) 与 私服(CN) 的技能图标。
 * apps 经 /res（dev 由 VITE_ASSET_ROOT 提供），私服经 /res/cnskill（拷入的临时副本）。
 * 每种图标渲染 4 个：apps原样 / apps黑底透明 / 私服原样 / 私服黑底透明。
 */

import { decodeTextureAsync } from '../core/texture.js';

const content = document.getElementById('content') as HTMLElement;
const logEl = document.getElementById('log') as HTMLElement;
function log(msg: string): void {
  logEl.textContent += msg + '\n';
  console.log('[icon-demo]', msg);
}

// 黑底→透明（对齐透明Bmp阈值：max(r,g,b)<=24 视为黑）
function blackToAlpha(px: Uint8ClampedArray, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if (r <= 24 && g <= 24 && b <= 24) px[i + 3] = 0;
    }
  }
}

async function loadAndDraw(url: string, transparent: boolean): Promise<HTMLCanvasElement | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP' + resp.status);
    const buf = await resp.arrayBuffer();
    const decoded = await decodeTextureAsync(buf);
    if (!decoded) throw new Error('decode fail');
    const px = new Uint8ClampedArray(decoded.pixels);
    if (transparent) blackToAlpha(px, decoded.width, decoded.height);
    const c = document.createElement('canvas');
    c.width = decoded.width;
    c.height = decoded.height;
    const cx = c.getContext('2d')!;
    const id = cx.createImageData(decoded.width, decoded.height);
    id.data.set(px);
    cx.putImageData(id, 0, 0);
    return c;
  } catch (e) {
    const d = document.createElement('div');
    d.textContent = '×';
    d.style.color = '#f66';
    return d as unknown as HTMLCanvasElement;
  }
}

function makeCell(url: string, transparent: boolean, title: string): HTMLElement {
  const cell = document.createElement('td');
  cell.className = 'cell';
  cell.title = title;
  const box = document.createElement('div');
  box.style.cssText = 'position:relative;';
  const canvasHost = document.createElement('div');
  box.appendChild(canvasHost);
  void loadAndDraw(url, transparent).then(c => { if (c) canvasHost.appendChild(c); });
  cell.appendChild(box);
  return cell;
}

interface Row {
  name: string;
  appsUrl: string;  // /res/... （apps）
  cnUrl: string;    // /res/cnskill/... （私服）
}

const ROWS: Row[] = [
  // 普攻
  { name: '普攻 Skill_Normal', appsUrl: '/res/image/sinimage/skill/skill_normal.bmp', cnUrl: '/res/cnskill/Skill_Normal.bmp' },
  // knight
  { name: 'knight Sword Blast', appsUrl: '/res/image/sinimage/skill/knight/button/mn10 s_blast.bmp', cnUrl: '/res/cnskill/Knight/Button/MN10 S_Blast.bmp' },
  { name: 'knight Divine Piercing', appsUrl: '/res/image/sinimage/skill/knight/button/mn70 d_piercing.bmp', cnUrl: '/res/cnskill/Knight/Button/MN70 D_Piercing.bmp' },
  { name: 'knight Sword of Justice', appsUrl: '/res/image/sinimage/skill/knight/button/mn60 s_o_justice.bmp', cnUrl: '/res/cnskill/Knight/Button/MN60 S_O_Justice.bmp' },
  // fighter
  { name: 'fighter Raving', appsUrl: '/res/image/sinimage/skill/fighter/button/tf14 raving.bmp', cnUrl: '/res/cnskill/Fighter/Button/TF14 raving.bmp' },
  { name: 'fighter Impact', appsUrl: '/res/image/sinimage/skill/fighter/button/tf17 impact.bmp', cnUrl: '/res/cnskill/Fighter/Button/TF17 impact.bmp' },
  // magician
  { name: 'magician FireBolt', appsUrl: '/res/image/sinimage/skill/magician/button/mm12 firebolt.bmp', cnUrl: '/res/cnskill/Magician/Button/MM12 FireBolt.bmp' },
  // atalanta
  { name: 'atalanta Windy', appsUrl: '/res/image/sinimage/skill/atalanta/button/ma20 windy.bmp', cnUrl: '/res/cnskill/Atalanta/Button/MA20 Windy.bmp' },
  // priestess
  { name: 'priestess Healing', appsUrl: '/res/image/sinimage/skill/priestess/button/mp10 healing.bmp', cnUrl: '/res/cnskill/Priestess/Button/MP10 Healing.bmp' },
  // assassin
  { name: 'assassin Wisp', appsUrl: '/res/image/sinimage/skill/assassin/button/ta17 wisp.bmp', cnUrl: '/res/cnskill/Assassin/Button/TA17 Wisp.bmp' },
];

function buildSection(title: string, rows: Row[]): void {
  const h = document.createElement('h2');
  h.textContent = title;
  content.appendChild(h);
  const tbl = document.createElement('table');
  const head = document.createElement('tr');
  ['技能', 'apps 原样', 'apps 黑底透明', '私服 原样', '私服 黑底透明'].forEach(txt => {
    const th = document.createElement('th'); th.textContent = txt; head.appendChild(th);
  });
  tbl.appendChild(head);
  for (const r of rows) {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.className = 'name';
    tdName.textContent = r.name;
    tr.appendChild(tdName);
    tr.appendChild(makeCell(r.appsUrl, false, r.appsUrl));
    tr.appendChild(makeCell(r.appsUrl, true, r.appsUrl + ' (透明)'));
    tr.appendChild(makeCell(r.cnUrl, false, r.cnUrl));
    tr.appendChild(makeCell(r.cnUrl, true, r.cnUrl + ' (透明)'));
    tbl.appendChild(tr);
  }
  content.appendChild(tbl);
}

buildSection('普攻与各职业技能', ROWS);
log('图标对比页就绪：apps=/res，私服=/res/cnskill');
