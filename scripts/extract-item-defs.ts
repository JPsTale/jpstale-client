/**
 * `ITEM_DEFS` 生成器 —— **补上一直缺失的那个脚本**（文件头自己写着"生成 2026-09-09；改 DB 定义后重跑：
 * psql 导出 json → node 格式化"，但仓库里从来没有这个脚本 ⇒ 每次改库都得手抄，2026-09-22 导入拳套时踩到）。
 *
 * 数据源：`gamedb.itemlist`（`questid = 0`，与既有文件的过滤条件一致 —— 实测"questid=0 且 id≤1226"= 992
 * 正好等于文件里的条数，所以重跑只会**新增**后来入库的行，不改动既有行）。
 * 字段映射（与既有行逐字节对照过）：
 *   id ← id；code ← idcode；name ← name；icon ← lower(codeimg1)；folder ← lower(dropfolder)；
 *   w ← width/22；h ← height/22；class ← classitem；pos ← modelposition；sound ← sound；reqLv ← reqlevel
 *   （`w/h` 是**格数**：资产是 22px/格，实测 width=22→w=1、height=44→h=2，与文件一致）
 *
 * 取数三级回退与其它生成器同款：`PT_ITEMLIST_DUMP` → 本机 podman → ssh。
 * 用法：npx tsx scripts/extract-item-defs.ts   （npm run item-defs）
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('src/game/data/itemDefs.ts');
const DB_HOST = process.env.PT_DB_HOST ?? 'root@192.168.31.10';
const SQL = 'SELECT id, idcode, name, codeimg1, dropfolder, width, height, classitem, modelposition, sound, reqlevel '
  + 'FROM gamedb.itemlist WHERE questid = 0 ORDER BY id;';

function fetchDump(): { text: string; source: string } {
  const local = process.env.PT_ITEMLIST_DUMP;
  if (local && existsSync(local)) return { text: readFileSync(local, 'utf8'), source: `file:${local}` };
  const tryRun = (f: string, a: string[]): string | null => {
    try { return execFileSync(f, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return null; }
  };
  const podman = tryRun('podman', ['exec', '-i', 'priston-pg', 'psql', '-U', 'sa', '-d', 'pristontale', '-At', '-F', '|', '-c', SQL]);
  if (podman) return { text: podman, source: 'podman:priston-pg' };
  const ssh = tryRun('ssh', [DB_HOST, `podman exec -i priston-pg psql -U sa -d pristontale -At -F'|' -c "${SQL}"`]);
  if (ssh) return { text: ssh, source: `ssh:${DB_HOST}` };
  throw new Error('取不到 itemlist：设 PT_ITEMLIST_DUMP，或确保本机/ssh 能跑 podman exec');
}

interface Def { id: number; code: number; name: string; icon: string; folder: string; w: number; h: number; class: number; pos: number; sound: number; reqLv: number }

const { text, source } = fetchDump();
const defs: Def[] = [];
for (const line of text.split(String.fromCharCode(10))) {
  const p = line.trim().split('|');
  if (p.length < 11 || !/^[0-9]+$/.test(p[0]!)) continue;
  const [id, code, name, icon, folder, width, height, cls, pos, sound, reqLv] = p as string[];
  defs.push({
    id: Number(id), code: Number(code), name: name!,
    icon: String(icon).toLowerCase(), folder: String(folder).toLowerCase(),
    w: Math.max(1, Math.round(Number(width) / 22)), h: Math.max(1, Math.round(Number(height) / 22)),
    class: Number(cls), pos: Number(pos), sound: Number(sound), reqLv: Number(reqLv),
  });
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const body = defs.map((d) => `  { id: ${d.id}, code: ${d.code}, name: "${esc(d.name)}", icon: "${esc(d.icon)}", `
  + `folder: "${esc(d.folder)}", w: ${d.w}, h: ${d.h}, class: ${d.class}, pos: ${d.pos}, sound: ${d.sound}, reqLv: ${d.reqLv} }`)
  .join(',\n');

const header = `// 物品定义静态表（生成自 gamedb.itemlist，questid=0，${defs.length} 条）
// 图标路径 = /res/image/sinimage/items/{folder}/it{icon}.bmp
// 生成物，**勿手改**：改库后重跑 \`npm run item-defs\`（scripts/extract-item-defs.ts）。
// 生成 2026-09-22；来源 ${source}

export interface ItemDef {
  id: number;      // itemlist.id（uid 关联用）
  code: number;    // idcode（原版物品码）
  name: string;
  icon: string;    // 图标文件名（codeImg1 小写）
  folder: string;  // 分类目录（weapon/defense/...）
  w: number;       // 占格宽（22px/格）
  h: number;       // 占格高
  class: number;   // classItem（装备位位值）
  pos: number;     // modelPosition（挂点）
  sound: number;   // SoundIndex（拿起/放下音效）
  reqLv: number;   // 需求等级
}

export const ITEM_DEFS: ItemDef[] = [
`;

const old = readFileSync(OUT, 'utf8');
const tail = old.slice(old.indexOf('\nconst byId = new Map'));   // 保留索引与查询函数那一段
writeFileSync(OUT, header + body + '\n];\n' + tail);

console.log(`[item-defs] ${defs.length} 条（来源 ${source}）→ ${OUT}`);
