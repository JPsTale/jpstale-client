/**
 * 生成「幽灵武器码」排除清单 —— `src/game/data/source/phantom-weapon-codes.json`。
 *
 * 幽灵码 = **三处皆无**的码：EU 物品表没有、OpenItem 补充没有、`it<code>.smd` 模型也没有。
 * 它们只出现在 `.in` 白名单里，永远无法被装备，却会**污染别的武器**的匹配：
 * 手别未知的幽灵码会让"纯手别条目"被判成"手未定"而漏进另一手别的候选
 *（用户实测：Pikeman 单手锤看到双手锤动画，元凶之一就是 WH152/153 这类码）。
 *
 * 用户 2026-09-12 指示：**直接删掉，留着是祸害**。故由生成器统一跳过，清单独立成文件便于复核。
 * 用法：npx tsx scripts/report-phantom-codes.ts [--check]
 *   （--check：只报告，不写文件；用于 CI/复核）
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import wcRaw from '../src/game/data/anim-in/weapon-codes.generated.json';
import items from '../src/game/data/item-weapon-semantics.generated.json';
import sup from '../src/game/data/items-supplement.generated.json';

const OUT = resolve('src/game/data/source/phantom-weapon-codes.json');
const DROPITEM = resolve(process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client', 'image/sinimage/items/dropitem');

/** idcode → 码名（与 extract-item-semantics 的 codeOfIdcode 同规则） */
function codeOf(id: number): string | null {
  const hi = (id >>> 16) & 0xffff, n = (id & 0xffff) / 0x100;
  const p: Record<number, string> = {
    0x101: 'WA', 0x102: 'WC', 0x103: 'WH', 0x104: 'WM', 0x105: 'WP',
    0x106: 'WS', 0x107: 'WS', 0x108: 'WT', 0x109: 'WN', 0x10a: 'WD', 0x10b: 'WV',
    0x204: 'DS', 0x201: 'DA',
  };
  return p[hi] ? `${p[hi]}${hi === 0x107 ? 200 + n : 100 + n}` : null;
}

const wc = (wcRaw as unknown as { table: Record<string, { type: string; hand: string }> }).table;
const eu = new Set(Object.keys((items as unknown as { byIdcode: Record<string, unknown> }).byIdcode)
  .map((k) => codeOf(Number(k))).filter(Boolean) as string[]);
const open = new Set((sup as unknown as { items: Array<{ code: number; folder: string }> }).items
  .filter((x) => x.folder === 'weapon').map((x) => codeOf(x.code)).filter(Boolean) as string[]);
const drop = readdirSync(DROPITEM).map((f) => f.toLowerCase());
const unknownHand = (c: string): boolean => wc[c]!.hand !== '1H' && wc[c]!.hand !== '2H';

const phantom = Object.keys(wc).filter((c) => !eu.has(c) && !open.has(c) && !drop.includes(`it${c.toLowerCase()}.smd`)).sort();
const payload = {
  note: '幽灵武器码排除清单（生成物，勿手改；重生用 npx tsx scripts/report-phantom-codes.ts）。'
    + '判定 = 该码在 EU 物品表 / OpenItem 补充 / it<code>.smd 模型 **三处皆无** → 永远无法装备，'
    + '却会污染其它武器的匹配（手别未知的幽灵码会让纯手别条目被判成"手未定"）。'
    + '两个生成器（extract-weapon-codes / extract-anim-from-in）统一跳过本清单。'
    + '注意 151–153 段不在清单内：它们在 OpenItem 补充里有实体物品。',
  count: phantom.length,
  /** 其中手别未知的个数 —— 删掉它们即可消掉这一整类"未定手别"噪声 */
  unknownHandCount: phantom.filter(unknownHand).length,
  codes: phantom,
};
console.log(`幽灵码 ${payload.count} 个（其中手别未定 ${payload.unknownHandCount} 个）：`);
console.log('  ' + phantom.join(' '));
if (!process.argv.includes('--check')) {
  writeFileSync(OUT, JSON.stringify(payload, null, 1) + '\n');
  console.log(`\n已写出 ${OUT}`);
}
