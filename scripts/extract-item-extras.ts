/**
 * 物品**模板附加信息** → `item-extras.generated.json`：药水槽容量 + 重量。
 *
 * 为什么要单独一张表（理由与 `extract-potion-effects.ts` 同）：
 *   ① `ITEM_DEFS`（992 条）没有对应的生成脚本（一次性产出），往里加列有"下次谁重新生成就丢"的风险；
 *   ② 这两项是**模板列**（`gamedb.itemlist.potionspace` / `weight`），物品实例（proto）里根本没有，
 *      而信息框要显示它们。
 * 服务端侧：`potionspace` 尚无消费方（装备系统未做药水槽扩容），`weight` 的负重走模板直接算
 * （`PlayerStatCalculator.currentWeight`），故这里纯粹是**显示用**的同源副本，不参与判定。
 *
 * 数据源获取顺序（与 extract-item-semantics.ts / extract-potion-effects.ts 相同）：
 *   1. `PT_ITEMLIST_DUMP` 指向的本地 dump（离线）
 *   2. 本机 podman exec priston-pg psql
 *   3. ssh <PT_DB_HOST> podman exec …
 *
 * 用法：npx tsx scripts/extract-item-extras.ts   （npm run item-extras）
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('src/game/data/item-extras.generated.json');
const DB_HOST = process.env.PT_DB_HOST ?? 'root@192.168.31.10';
// 分隔符用 '|'（不是 \t）：ssh → 远端 sh → psql 的多层引号会把 '\t' 吃成两字符，行就切不开
const SQL = 'SELECT id, idcode, name, coalesce(potionspace,0), coalesce(weight,0), '
  + "coalesce(potioncount,0) FROM gamedb.itemlist ORDER BY id;";

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

export interface ItemExtras {
  /** itemlist.id（客户端 `ItemDef.id`、服务端 proto `itemlist_id`） */
  id: number;
  /** 药水槽容量：装备后药水槽每格能放的瓶数（原版 `*보유공간`，护腕是唯一来源） */
  potionSpace: number;
  /** 模板重量（负重 = Σ 已装备/背包物品重量，见服务端 `PlayerStatCalculator.currentWeight`） */
  weight: number;
  /** 药水槽内该种药水的**堆叠上限**（原版 `*PotionCount`，0 = 未定义，按 2 处理） */
  potionCount: number;
}

const { text, source } = fetchDump();
const out: ItemExtras[] = [];
for (const line of text.split('\n')) {
  const p = line.trim().split('|');
  if (p.length < 6 || !/^\d+$/.test(p[0]!)) continue;
  const [id, , , potionSpace, weight, potionCount] = p as string[];
  const e: ItemExtras = {
    id: Number(id),
    potionSpace: Number(potionSpace),
    weight: Number(weight),
    potionCount: Number(potionCount),
  };
  // 三项全 0 的行（材料/任务物）不输出：信息框没有可显示的
  if (e.potionSpace === 0 && e.weight === 0 && e.potionCount === 0) continue;
  out.push(e);
}

writeFileSync(OUT, JSON.stringify({
  note: '由 scripts/extract-item-extras.ts 从 gamedb.itemlist 的 potionspace/weight/potioncount 生成'
      + '（模板列，proto 不含；仅供客户端信息框显示，不参与判定）。',
  source,
  count: out.length,
  items: out,
}, null, 1) + '\n');

const withPotionSpace = out.filter((e) => e.potionSpace > 0).length;
console.log(`[item-extras] ${out.length} 条（有药水槽容量 ${withPotionSpace}）来源 ${source} → ${OUT}`);
