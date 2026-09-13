/**
 * 药水/回复类物品的**使用效果**数值 → `potion-effects.generated.json`。
 *
 * 数据源：`gamedb.itemlist` 的 `recoveryhpmin/max`、`recoverympmin/max`、`recoverystmmin/max`
 * （服务端 `ItemList` 实体已映射这三对列；`ItemPanel` 的物品信息要显示"恢复多少"）。
 *
 * **为什么不塞进 `ITEM_DEFS`**：那份 994 条的生成物没有对应的生成脚本（一次性产出），
 * 往里加列会有"下次谁重新生成就丢"的风险；效果数值与物品本体正交，单独一张表更安全。
 *
 * 判据（与主服务端 `ItemNetworkHandler.rollRecovery` 完全一致）：三对列**至少一个有值**才算回复类；
 * 全 0 的行不输出（那是增益/力量石一类，另有机制）。
 * 注意：idcode 级的 Life/Mana 家族在我们 DB 与 `items-11job.json` 之间是**相反**的，
 * 所以这里**只按列取值、不按 idcode 族推断**（见 docs/传送系统.md §6）。
 *
 * 数据源获取顺序（与 extract-item-semantics.ts 相同）：
 *   1. `PT_ITEMLIST_DUMP` 指向的本地 dump（离线）
 *   2. 本机 podman exec priston-pg psql
 *   3. ssh <PT_DB_HOST> podman exec …
 *
 * 用法：npx tsx scripts/extract-potion-effects.ts   （npm run potions）
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('src/game/data/potion-effects.generated.json');
const DB_HOST = process.env.PT_DB_HOST ?? 'root@192.168.31.10';
// 分隔符用 '|'（不是 \t）：ssh → 远端 sh → psql 的多层引号会把 '\t' 吃成两字符，行就切不开
const SQL = 'SELECT id, idcode, name, '
  + "coalesce(recoveryhpmin,0), coalesce(recoveryhpmax,0), "
  + "coalesce(recoverympmin,0), coalesce(recoverympmax,0), "
  + "coalesce(recoverystmmin,0), coalesce(recoverystmmax,0) "
  + 'FROM gamedb.itemlist ORDER BY id;';

function fetchDump(): { text: string; source: string } {
  const local = process.env.PT_ITEMLIST_DUMP;
  if (local && existsSync(local)) {
    return { text: readFileSync(local, 'utf8'), source: `file:${local}` };
  }
  const tryRun = (file: string, args: string[]): string | null => {
    try {
      return execFileSync(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch {
      return null;
    }
  };
  const podman = tryRun('podman', ['exec', '-i', 'priston-pg', 'psql', '-U', 'sa', '-d', 'pristontale', '-At', '-F', '|', '-c', SQL]);
  if (podman) return { text: podman, source: 'podman:priston-pg' };
  const ssh = tryRun('ssh', [DB_HOST, `podman exec -i priston-pg psql -U sa -d pristontale -At -F'|' -c "${SQL}"`]);
  if (ssh) return { text: ssh, source: `ssh:${DB_HOST}` };
  throw new Error('取不到 itemlist dump：设 PT_ITEMLIST_DUMP，或确保本机/ssh 能跑 podman exec');
}

export interface PotionEffect {
  /** itemlist.id（客户端 `ItemDef.id`、服务端 proto `itemlist_id`） */
  id: number;
  code: number;
  name: string;
  /** [min, max]，0 表示该类不回复；三项全 0 的行不会出现在这里 */
  hp?: [number, number];
  mp?: [number, number];
  stm?: [number, number];
}

const { text, source } = fetchDump();
const out: PotionEffect[] = [];
for (const line of text.split('\n')) {
  const p = line.trim().split('|');
  if (p.length < 9 || !/^\d+$/.test(p[0]!)) continue;
  const [id, code, name, hmin, hmax, mmin, mmax, smin, smax] = p as string[];
  const hp: [number, number] = [Number(hmin), Number(hmax)];
  const mp: [number, number] = [Number(mmin), Number(mmax)];
  const stm: [number, number] = [Number(smin), Number(smax)];
  const has = (v: [number, number]) => v[0] > 0 || v[1] > 0;
  if (!has(hp) && !has(mp) && !has(stm)) continue;   // 非回复类
  const e: PotionEffect = { id: Number(id), code: Number(code), name: name! };
  if (has(hp)) e.hp = hp;
  if (has(mp)) e.mp = mp;
  if (has(stm)) e.stm = stm;
  out.push(e);
}

writeFileSync(OUT, JSON.stringify({
  note: '由 scripts/extract-potion-effects.ts 从 gamedb.itemlist 的 recovery* 列生成；判据=至少一对列有值。'
      + ' idcode 族的 Life/Mana 在 items-11job.json 里相反，故本表只按列取值、不按族推断。',
  source,
  count: out.length,
  items: out,
}, null, 1) + '\n');

const byKind = (k: 'hp' | 'mp' | 'stm') => out.filter((e) => e[k]).length;
console.log(`[potion-effects] ${out.length} 条（HP ${byKind('hp')} / MP ${byKind('mp')} / STM ${byKind('stm')}）来源 ${source} → ${OUT}`);
