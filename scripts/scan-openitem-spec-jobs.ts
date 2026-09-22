/**
 * 扫 11 职业服务端 `GameServer/OpenItem/*.txt` 的**职业限制**字段（`**특화` / `**특화랜덤`）。
 *
 * ⚠ **本脚本只产出「来源数据」，没有运行时消费方**（用户 2026-09-22 明确）：
 *   这两项**不显示在物品信息框里**（"不应该显示限定职业、候选职业这两个东西"）。
 *   留着它的理由只有一个：服务端的**职业门**还没实现（AGENTS 纠错 #8 / todo #8），
 *   而这两个字段就是那道门的数据本身（`fileread.cpp` 把它们写进 `JobCodeMask` /
 *   `dwJobBitCode_Random[]`）。等做门的时候直接拿这份 JSON，不必再解一次包。
 *   所以：**别再把它接到界面上**，除非同时实现了服务端拦截 ——
 *   只显示不拦截比不显示更糟（玩家会以为换不了职业的装备真的装备不上）。
 *
 * 字段与解析规则（逐字对齐服务端 `ScrServer/src/fileread.cpp:3042-3094`，EUC-KR 文本）：
 *   `**특화  <Name> [Name...]`   → 赋值给 `lpItem->JobCodeMask`，循环里**每个匹配都覆盖**
 *                                  ⇒ 一行多名字时**最后一个**生效（"单职业"）
 *   `**특화랜덤 <Name> [Name...]` → 追加进 `lpDefItem->dwJobBitCode_Random[]`（上限 12），
 *                                  掉落/制造时从中挑一个写回 `JobCodeMask`
 *   名字比对是 `lstrcmpi`（大小写不敏感），只认 `JobDataBase[].szName` 里存在的名字；
 *   `//` 注释若单独成行不受影响（解析是逐行的）；行内出现的 `//` 只是一个匹配不上的单词，被忽略。
 *   ⚠ 名字集包含**进阶名**（Warrior/Champion/…，与职业同系但不同阶级）：与客户端
 *     `locale.jobTier` 是同一套名字，故用那张表做校验（两边同源）。
 *
 * 实测交叉印证（与 AGENTS 纠错 #8 独立得出的族级结论一致）：
 *   `wd101` 候选 = [Assassin]（匕首族 → 刺客）；`om101` = [Priestess, Magician]（法球）；
 *   `wv101` = [MartialArtist]（拳套）；`wa101` 固定 = Fighter、候选 = [Pikeman]（与样本文件逐字核对）。
 *   ⚠ 源文件存在**拼写错误** `Atalanter`（`WP121/123/125` 的候选行）—— 服务端 `lstrcmpi` 同样匹配不上、
 *     会忽略该词，本脚本保持同样行为并把它报出来（**不替源数据自作主张改**）。
 *
 * 数据源（与 extract-potion-effects.ts 同款三级回退）：
 *   1. `PT_OPENITEM_DIR` 指向的目录（离线，本机解包即可）
 *   2. `ssh <PT_DB_HOST> "cat <远端目录>/<文件>"` 逐个拉取（慢，仅在没有本地副本时用）
 *
 * 用法：npx tsx scripts/scan-openitem-spec-jobs.ts   （npm run scan-spec-jobs）
 *   取源（一次性，291KB；文件是 EUC-KR，别用 grep 直接搜中文）：
 *     ssh root@192.168.31.10 'cd "<远端 OpenItem 目录>" && tar czf - .' > tmp/openitem.tgz
 *     mkdir -p tmp/openitem && tar xzf tmp/openitem.tgz -C tmp/openitem
 *   然后 `PT_OPENITEM_DIR=<解包目录>` 跑本脚本（默认就是 `E:/JPsTale/tmp/openitem`）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '../src/locales/en.json' with { type: 'json' };

const DIR = process.env.PT_OPENITEM_DIR ?? 'E:/JPsTale/tmp/openitem';
const REMOTE_DIR = process.env.PT_OPENITEM_REMOTE_DIR
  ?? '/data/PristonTale/精灵11职业单机版一键端/Server服务端/GameServer/OpenItem';
const DB_HOST = process.env.PT_DB_HOST ?? 'root@192.168.31.10';

const SRC_OUT = resolve('src/game/data/source/item-spec-jobs.json');

/** 合法职业名（大小写不敏感）= 客户端 `jobTier` 里的全部名字（含进阶名），与服务端 `JobDataBase` 同源 */
const jobNames = new Set<string>();
for (const tiers of Object.values((en as { itemtip: { jobTier: Record<string, string[]> } }).itemtip.jobTier)) {
  for (const n of tiers) jobNames.add(n.toLowerCase());
}
/** 每个合法名的规范写法（保留服务端/客户端表格里的原始大小写，显示时用） */
const canonical = new Map<string, string>();
for (const tiers of Object.values((en as { itemtip: { jobTier: Record<string, string[]> } }).itemtip.jobTier)) {
  for (const n of tiers) canonical.set(n.toLowerCase(), n);
}

const FIXED = '**특화';
const RANDOM = '**특화랜덤';

function readText(file: string): string {
  if (existsSync(resolve(DIR, file))) {
    return new TextDecoder('euc-kr').decode(readFileSync(resolve(DIR, file)));
  }
  // 本地没有就按名逐个从远端取（EUC-KR 原始字节 → 解码）
  const buf = execFileSync('ssh', [DB_HOST, `cat "${REMOTE_DIR}/${file}"`], { maxBuffer: 8 * 1024 * 1024 });
  return new TextDecoder('euc-kr').decode(buf);
}

/** 一行里 `<前缀>` 之后的所有合法职业名（按出现顺序，保留规范大小写） */
function namesAfter(line: string, prefix: string): string[] {
  return line.slice(prefix.length).split(/\s+/).filter(Boolean)
    .map((w) => canonical.get(w.toLowerCase()))
    .filter((w): w is string => w !== undefined);
}

const unknownNames = new Set<string>();
const files = existsSync(DIR)
  ? readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.txt'))
  : [];

const items: { file: string; code: string; fixed: string | null; random: string[] }[] = [];
for (const file of files) {
  const code = file.replace(/\.txt$/i, '');
  const text = readText(file);
  let fixed: string | null = null;
  const random: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith(RANDOM)) {
      for (const n of namesAfter(line, RANDOM)) if (!random.includes(n)) random.push(n);
      collectUnknown(line.slice(RANDOM.length));
    } else if (line.startsWith(FIXED)) {
      // 服务端在循环里**覆盖**赋值 ⇒ 一行多名字时最后一个生效
      const ns = namesAfter(line, FIXED);
      if (ns.length > 0) fixed = ns[ns.length - 1]!;
      collectUnknown(line.slice(FIXED.length));
    }
  }
  if (fixed !== null || random.length > 0) items.push({ file, code, fixed, random });
}

function collectUnknown(rest: string): void {
  for (const w of rest.split(/\s+/).filter(Boolean)) {
    // `//` 注释行内词、纯数字等不算"未知职业名"，只报**看起来像名字**（含字母）却没匹配上的
    if (/[A-Za-z]/.test(w) && !canonical.has(w.toLowerCase())) unknownNames.add(w);
  }
}

items.sort((a, b) => a.code.localeCompare(b.code));

writeFileSync(SRC_OUT, JSON.stringify({
  note: '扫自 11 职业服务端 GameServer/OpenItem/*.txt 的 **특화（固定专精）与 **특화랜덤（候选清单）；'
    + '解析规则照抄 ScrServer/src/fileread.cpp:3042-3094。生成脚本 scripts/scan-openitem-spec-jobs.ts。'
    + '⚠ 无运行时消费方：用户 2026-09-22 决定不在物品信息框显示职业限制（只显示不拦截会误导），'
    + '本文件留给尚未实现的服务端职业门（AGENTS 纠错 #8 / todo #8）当输入。',
  source: `OpenItem @ ${REMOTE_DIR}`,
  items,
}, null, 1) + '\n');

const withFixed = items.filter((i) => i.fixed).length;
const withRandom = items.filter((i) => i.random.length > 0).length;
console.log(`扫描 ${files.length} 个文件 → 有职业字段 ${items.length} 条`
  + `（固定专精 ${withFixed} / 候选清单 ${withRandom}）`);
console.log(`  ${SRC_OUT}（仅来源数据，界面不显示）`);
if (unknownNames.size > 0) {
  console.log(`⚠ 未识别的名字（未收录，可能是职业以外的词）：${[...unknownNames].join(', ')}`);
}
const bothMiss = items.filter((i) => i.fixed && i.random.length > 0
  && !i.random.includes(i.fixed)).length;
console.log(`  其中"固定专精不在候选清单里"的 ${bothMiss} 条（原版允许，掉落时会改成候选之一）`);
