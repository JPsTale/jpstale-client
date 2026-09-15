/**
 * 生成地图等级门槛数据（`src/maps/map-levels.generated.json`）。
 *
 * 数据源：`deploy/postgres/init/gamedb.sql` 里 `COPY gamedb.maplist` 的导出段
 * （列 `id, name, shortname, typemap, levelreq, pvp, stagefile`）。
 * **`maplist.id` 就是我们的 mapId**（实测 0=Acacia Groove/fore3、3=Ricarten Town/ric、
 * 11=Battlefield of the Ancients/desert3 与 `fields.json` 逐条对齐）。
 *
 * 为什么不用运行时那条路：客户端确实会在进图快照里收到 `levelReq`
 * （`S2C_EnterGame.maps[].levelReq` → `src/game/safeZones.ts`），但大地图 demo 没有游戏会话，
 * 所以要一份静态数据。两者同源（都来自 `gamedb.maplist`），demo 用静态这份。
 *
 * 用法：`npm run map-levels`（可用 `--sql=<路径>` 覆盖导出文件位置）
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { FIELDS } from '../src/maps/map-data.js';

const args = process.argv.slice(2);
const sqlArg = args.find((a) => a.startsWith('--sql='));
// 默认位置：客户端仓库的兄弟目录（部署用 SQL 导出）
const sqlPath = resolve(sqlArg ? sqlArg.slice(6) : '../deploy/postgres/init/gamedb.sql');
if (!existsSync(sqlPath)) {
  console.error(`找不到 maplist 导出文件: ${sqlPath}\n用 --sql=<路径> 指定 gamedb.sql 的位置。`);
  process.exit(2);
}

const sql = readFileSync(sqlPath, 'utf8');
const start = sql.indexOf('COPY gamedb.maplist ');
if (start < 0) {
  console.error('该 SQL 里没有 `COPY gamedb.maplist` 段 —— 数据源格式变了，先确认再改这个脚本。');
  process.exit(2);
}
// COPY 段到 `\.` 结束
const body = sql.slice(start, sql.indexOf('\n\\.', start));
const levels: Record<number, number> = {};
const names: Record<number, string> = {};
let rows = 0;
for (const line of body.split('\n').slice(1)) {
  if (!line.trim()) continue;
  const f = line.split('\t');
  if (f.length < 5) continue;
  const id = Number(f[0]);
  const levelReq = Number(f[4]);
  if (!Number.isInteger(id) || id < 0) continue;
  levels[id] = Number.isFinite(levelReq) ? levelReq : 0;
  names[id] = f[1] ?? '';
  rows++;
}

// 自检：我们的 63 张图必须都在 maplist 里（缺了说明 id 口径不一致，不能静默）
const missing = FIELDS.filter((f) => levels[f.id] === undefined).map((f) => f.id);
if (missing.length > 0) {
  console.error(`有 ${missing.length} 张图在 maplist 里找不到等级: ${missing.join(',')}`);
  console.error('（先核对 id 口径，别用默认值糊过去）');
  process.exit(1);
}

const out = {
  note: '地图等级门槛（gamedb.maplist.levelreq）。0/1 = 无实质限制；>1 才是真的等级门',
  source: `deploy/postgres/init/gamedb.sql · COPY gamedb.maplist（共 ${rows} 行）`,
  generatedAt: new Date().toISOString(),
  levels,
  /** maplist 里的英文名，便于交叉核对（不参与显示） */
  dbNames: names,
};
writeFileSync(resolve('src/maps/map-levels.generated.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');

const gated = FIELDS.filter((f) => (levels[f.id] ?? 0) > 1);
console.log(`[map-levels] 写入 src/maps/map-levels.generated.json：${Object.keys(levels).length} 条，`
  + `其中 ${gated.length} 张有等级门`);
for (const f of gated.sort((a, b) => (levels[b.id] ?? 0) - (levels[a.id] ?? 0))) {
  console.log(`  #${String(f.id).padStart(2)} ${(levels[f.id] ?? 0).toString().padStart(3)} 级  ${names[f.id]}`);
}
