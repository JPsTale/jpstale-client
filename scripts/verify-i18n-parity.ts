/**
 * 两个前端（游戏客户端 + Web 管理端）**同一字段的文案必须逐字一致**（`npm run verify-i18n-parity`）。
 *
 * 为什么需要：用户 2026-09-22 指出"你用的文本跟我们在系统管理页面用的汉化不一致。
 * 例如药水存放数量，你显示为药水槽数量"。根因是同一个字段在两处各有一份文案、且**没人比对**：
 * 管理端的属性标签与客户端共用 `itemtip.*` 命名（设计文档 §三写明了"改名时两边一起改"），
 * 但 `weight`/`potionSpace` 当初被我放进了 `admin.item.*`，于是两边各自演化、静默漂开。
 *
 * 本脚本做两件事（都只读，失败即非零退出）：
 *   ① **共享 key 文案一致**：两边 `itemtip.*`（zh 与 en）同名 key 的文案必须逐字相同；
 *   ② **引用可解析**：管理端 `ItemColumnSemantics` 里出现的 `"itemtip.*"` / `"admin.item.*"`
 *      字符串，必须在管理端两份语言表里都存在（缺 key 时 `PTi18n` 会原样显示 key 本身 —— 可见但不该发生）。
 *
 * 服务端仓库位置：默认 `<客户端仓库>/../jpstale-server`，可用 `PT_SERVER_ROOT` 覆盖；
 * 找不到时**报告跳过并退出 0**（不假装通过）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SERVER = process.env.PT_SERVER_ROOT ?? resolve('..', 'jpstale-server');
const STATIC = resolve(SERVER, 'apps/web-server/src/main/resources/static');
const SEMANTICS = resolve(SERVER, 'apps/web-server/src/main/java/org/jpstale/server/web/item/ItemColumnSemantics.java');

if (!existsSync(STATIC)) {
  console.log(`[i18n-parity] 跳过：找不到管理端静态资源目录 ${STATIC}（设 PT_SERVER_ROOT 指向服务端仓库）`);
  process.exit(0);
}

type Table = Record<string, unknown>;
const load = (p: string): Table => JSON.parse(readFileSync(p, 'utf8')) as Table;
/** 服务端效果位 key 表（跨仓：客户端文案必须覆盖它的每一位） */
const MIX_EFFECT_JAVA = resolve('..', 'jpstale-server', 'modules', 'common-service', 'src', 'main', 'java',
  'org', 'jpstale', 'common', 'service', 'item', 'MixEffect.java');

const flat = (o: unknown, prefix = ''): Map<string, string> => {
  const m = new Map<string, string>();
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o as Table)) {
      if (typeof v === 'string') m.set(prefix + k, v);
      else for (const [k2, v2] of flat(v, `${prefix}${k}.`)) m.set(k2, v2);
    }
  }
  return m;
};

let failed = 0;
const fail = (msg: string) => { console.log(`  FAIL ${msg}`); failed++; };
/** 通过即打印（与 fail 对称） */
const ok2 = (msg: string, cond: boolean): void => {
  if (cond) console.log('  ok   ' + msg); else fail(msg);
};

for (const loc of ['zh', 'en']) {
  const cli = flat(load(resolve('src/locales', `${loc}.json`)));
  const adm = flat(load(resolve(STATIC, 'i18n', `${loc}.json`)));

  // ① 共享的 itemtip.* 逐字一致
  let compared = 0;
  for (const [k, v] of cli) {
    if (!k.startsWith('itemtip.')) continue;
    const other = adm.get(k);
    if (other === undefined) continue;           // 客户端独有的行（管理端不展示）不算漂移
    compared++;
    if (other !== v) fail(`[${loc}] ${k} 文案不一致：客户端「${v}」vs 管理端「${other}」`);
  }
  console.log(`  ok   [${loc}] 共享 itemtip.* ${compared} 条逐字一致`);

  // ② 管理端语义表引用的 key 必须能解析
  const java = readFileSync(SEMANTICS, 'utf8');
  const refs = new Set<string>();
  for (const m of java.matchAll(/"(itemtip|admin\.item)\.[A-Za-z0-9_]+"/g)) refs.add(m[0].slice(1, -1));
  let missing = 0;
  for (const r of refs) if (!adm.has(r)) { fail(`[${loc}] 语义表引用的 key 在语言表里缺失：${r}`); missing++; }
  if (missing === 0) console.log(`  ok   [${loc}] 语义表引用的 ${refs.size} 个 key 全部可解析`);
}

// ③ 服务端的效果位 key（`mixe.*`）必须在客户端两份文案里都有 ——
//    否则合成预览面板会把原始 key（"mixe.attack-rating"）显示给玩家，而且**不报错**。
//    服务端那侧加一位（`MixEffect.KEYS`）时，这里立刻会红。
{
  const java = readFileSync(MIX_EFFECT_JAVA, 'utf8');
  const keys = [...java.matchAll(/"(fire|ice|lightning|poison|organic|critical|attack-rating|damage-min|damage-max|attack-speed|absorb|defence|block|move-speed|hp|mp|sp|hp-regen|mp-regen|sp-regen|potion-storage)"/g)]
    .map((m) => m[1]);
  if (keys.length === 0) fail(`读不到服务端 MixEffect.java 的效果 key 表（路径或写法变了？）`);
  for (const loc of ['zh', 'en']) {
    const cli = flat(load(resolve('src/locales', `${loc}.json`)));
    let missing = 0;
    for (const k of keys) {
      if (!cli.has(`mixe.${k}`)) { fail(`[${loc}] 效果位文案缺失：mixe.${k}（服务端 MixEffect.KEYS 有它）`); missing++; }
    }
    if (missing === 0) console.log(`  ok   [${loc}] 服务端 ${keys.length} 个效果位 key 全部有文案`);
  }
}

/* ── 物品名表（`item.<id>.name`，**全量写在两份语言表里**）────────────────────────────
   用户 2026-09-25 定的两条口径：
     ① 键用 `gamedb.itemlist.id`（主键、十进制，不用 idcode）；
     ② **i18n 内容只有一处** = `locales/{zh,en}.json`（"把内容塞到不同地方只会制造维护困难"）。
   ⇒ 两份表**全量**（每件物品都有条目），客户端显示名 100% 从语言表取。
   本节钉：键集全量且成对 / 每个 id 是真物品 / 端到端取值 / 视图层走唯一实现，
   并把**未翻译的条数**报出来（zh == en 的那些 = 还等着补译文的）。 */
console.log('\n[物品名] `item.<id>.name`（全量写在 locales/{zh,en}.json）');
{
  // 动态 import：i18n 在模块作用域读 localStorage/navigator（Node 下要先打桩）
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh' }, configurable: true });
  const { ITEM_DEFS, itemDefById } = await import('../src/game/data/itemDefs.js');
  const { itemDisplayNameById, itemNameKey } = await import('../src/game/itemName.js');
  const { t, setLocale } = await import('../src/i18n/index.js');

  const namesOf = (rel: string): Record<string, string> => {
    const table = load(resolve(rel));
    const item = (table.item ?? {}) as Record<string, { name?: string }>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(item)) if (/^\d+$/.test(k)) out[k] = v?.name ?? '';
    return out;
  };
  const zh = namesOf('src/locales/zh.json');
  const en = namesOf('src/locales/en.json');
  const all = (ITEM_DEFS as unknown as Array<{ id: number; name: string }>);
  const zhIds = Object.keys(zh);
  const enIds = Object.keys(en);

  // ① 全量 + 成对
  const missingZh = all.filter((d) => !(String(d.id) in zh)).map((d) => d.id);
  const missingEn = all.filter((d) => !(String(d.id) in en)).map((d) => d.id);
  const onlyZh = zhIds.filter((k) => !(k in en));
  if (missingZh.length || missingEn.length || onlyZh.length) {
    fail(`物品名不是全量/不成对：zh 缺 ${missingZh.length}、en 缺 ${missingEn.length}、只在 zh ${onlyZh.length}`
      + ` ⇒ 重跑 npm run item-names`);
  } else {
    console.log(`  ok   zh/en 各 ${zhIds.length} 条 = 物品总数 ${all.length}（键集成对）`);
  }

  // ② 没有"挂在不存在 id 上"的条目
  const known = new Set(all.map((d) => d.id));
  const dead = zhIds.filter((id) => !known.has(Number(id)));
  if (dead.length) fail(`有 ${dead.length} 个物品名挂在**不存在**的 id 上：${dead.slice(0, 5).join(',')}`);
  else console.log('  ok   每个 item.<id>.name 都对应一件真实物品');

  // ③ 端到端（真取一次，不看实现）+ 空值检查
  const blanks = zhIds.filter((id) => zh[id] === '' || en[id] === '');
  if (blanks.length) fail(`有 ${blanks.length} 条名字是空串（如 ${blanks.slice(0, 3).join(',')}）`);
  else console.log('  ok   没有空名字');
  const sample = zhIds[0];
  const def = itemDefById(Number(sample))!;
  setLocale('zh');
  ok2(`zh 下 id=${sample}：「${zh[sample]}」`,
    t(itemNameKey(Number(sample))) === zh[sample]
    && itemDisplayNameById(Number(sample), def.name) === zh[sample]);
  setLocale('en');
  ok2(`en 下 id=${sample}：${en[sample]}`,
    t(itemNameKey(Number(sample))) === en[sample]
    && itemDisplayNameById(Number(sample), def.name) === en[sample]);
  setLocale('zh');

  // ④ 未翻译的条数（zh 与 en 逐字相同 = 还在等译文；只报不红）
  const untranslated = zhIds.filter((id) => zh[id] === en[id]);
  console.log(`  ok   未翻译 ${untranslated.length}/${zhIds.length} 条（zh==en，暂用数据名）`
    + `${untranslated.length ? '，如 ' + untranslated.slice(0, 6).map((i) => `#${i}`).join(' ') : ''}`);

  // ④b **特殊掉落物**（金币 `folder=gold` / 经验 `folder=exp`）必须真有中文词条 ——
  //     它们是怪一死就出现在地上的名牌（用户 2026-09-25：「特殊掉落物 Gold 没有 i18n 支持」），
  //     不能躺在"未翻译 247 条"里当占位。
  const { ITEM_DEFS: DEFS2 } = await import('../src/game/data/itemDefs.js');
  const special = (DEFS2 as unknown as Array<{ id: number; name: string; folder: string }>)
    .filter((d) => d.folder === 'gold' || d.folder === 'exp');
  const untranslatedSpecial = special.filter((d) => zh[String(d.id)] === en[String(d.id)]);
  ok2(`特殊掉落物（gold/exp 共 ${special.length} 件）都有中文词条：`
    + special.map((d) => `#${d.id}=${zh[String(d.id)]}`).join(' '),
  special.length > 0 && untranslatedSpecial.length === 0);

  // ⑤ 名字只有一个来源：视图层不许直接拿 `def.name` / 服务端下发的 name 当显示名
  const SITES = ['ItemInfo', 'ItemPanel', 'CraftPanel', 'BuffStrip', 'ShopPanel'];
  const missing: string[] = [];
  for (const s of SITES) {
    if (!/itemName\.js/.test(readFileSync(resolve('src/ui/react/' + s + '.tsx'), 'utf8'))) missing.push(s);
  }
  ok2(`面板显示点都接了唯一实现（缺：${missing.join(', ') || '无'}）`, missing.length === 0);
  const wv = readFileSync(resolve('src/ui/WorldView.ts'), 'utf8');
  // 地面名牌：**按服务端下发的主键**（`GroundItemProto.itemlist_id`）查 —— 用户 2026-09-25 定：
  // "地面掉落物带 itemlist_id"（此前按物品码换算：`item_id` 是物品码，第一版我甚至按主键查错了字段）。
  ok2('地面名牌按 `itemlistId` 查（`itemDisplayNameById(itemlistId, …)`）',
    /name = itemDisplayNameById\(itemlistId, name, name\);/.test(wv));
  const protoCommon = readFileSync(resolve('proto/base/common.proto'), 'utf8');
  ok2('proto 声明了 `itemlist_id`（主键，专给显示名），且写清了它配 `item_id` 一起下发',
    /int32 itemlist_id = 10;/.test(protoCommon)
    && /只给客户端查 i18n 显示名/.test(protoCommon)
    && /0 = 服务端没给（旧版）/.test(protoCommon));
  ok2('proto 仍注明 `item_id` 是**物品码**（掉落模型用，名字不看它）',
    /物品码（idcode），不是 `gamedb\.itemlist\.id` 主键[\s\S]{0,400}?int32 item_id = 2;/.test(protoCommon));
  // 服务端两处填值都要带上主键（漏一处 = 那种掉落物没名字）
  const aoi = readFileSync(resolve('../jpstale-server/apps/game-server/src/main/java/org/jpstale/server/game/service/GroundItemAOI.java'), 'utf8');
  const chat = readFileSync(resolve('../jpstale-server/apps/game-server/src/main/java/org/jpstale/server/game/service/ChatService.java'), 'utf8');
  ok2('服务端两处填值都带主键（GroundItemAOI 掉落广播 + ChatService 的 /@get）',
    /setItemlistId\(gi\.item\.getItemListId\(\)/.test(aoi) && /setItemlistId\(fresh\.getItemListId\(\)\)/.test(chat));
  ok2('key 形态 = item.<id>.name', itemNameKey(755) === 'item.755.name');
}

console.log('\n[怪物名] `monster.<inf词干>.name`（locales/{zh,en}.json + 服务端对照表）');
{
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh' }, configurable: true });
  const { t, tOr, setLocale } = await import('../src/i18n/index.js');

  const zhTable = load(resolve('src/locales/zh.json'));
  const enTable = load(resolve('src/locales/en.json'));
  const zhMon = (zhTable.monster ?? {}) as Record<string, { name?: string }>;
  const enMon = (enTable.monster ?? {}) as Record<string, { name?: string }>;
  const zhKeys = Object.keys(zhMon);
  const enKeys = Object.keys(enMon);

  ok2(`zh/en 各 ${zhKeys.length} 条，键集成对`,
    zhKeys.length > 0 && zhKeys.length === enKeys.length
    && zhKeys.every((k) => k in enMon));
  ok2('zh 的怪物名都含汉字（来源只收含汉字的 B_NAME；zh==en 的条目 = 0）',
    zhKeys.length > 0 && zhKeys.every((k) => /[\u4e00-\u9fff]/.test(zhMon[k]?.name ?? '')));

  // 端到端：`tOr('monster.<key>.name', fallback)` 真取到中文
  const sample = zhKeys[0];
  setLocale('zh');
  ok2(`zh 下 monster.${sample}.name =「${zhMon[sample]?.name}」`,
    t(`monster.${sample}.name`) === zhMon[sample]?.name
    && tOr(`monster.${sample}.name`, 'X') === zhMon[sample]?.name);
  ok2('没词条的键回落到 fallback（不静默显示 key）',
    tOr('monster.__no_such_key__.name', 'X') === 'X');

  // 客户端接线：monsterlist.namekey（inf 词干）随 Appear 下发 ⇒ 名牌优先查 `monster.<键>.name`
  const wv = readFileSync(resolve('src/ui/WorldView.ts'), 'utf8');
  ok2('怪物名牌 nameKey 优先、name 兜底',
    /a\.nameKey \? tOr\(`monster\.\$\{a\.nameKey\}\.name`, a\.name \|\| ''\) : \(a\.name \|\| ''\)/.test(wv));
  const main = readFileSync(resolve('src/main.ts'), 'utf8');
  ok2('main.ts 下发 name_key（monsterlist.namekey）', /a\.nameKey \|\| ''/.test(main));
  const protoText = readFileSync(resolve('proto/base/message.proto'), 'utf8');
  const monsterMsg = /message S2C_MonsterAppear \{[\s\S]*?\n\}/.exec(protoText)?.[0] ?? '';
  ok2('S2C_MonsterAppear 带 name_key 字段（i18n 键）', /string name_key = 20;/.test(monsterMsg));

  // 字段串位防线（2026-09-25 实测事故：新 main.ts 调旧 WorldView 桥 ⇒ `name_key` 落进 `model_file`
  // 形参，客户端去请求 `/res/4_hopy`，最后炸在与病因无关的 typed array 越界上）：
  // ① 两侧参数顺序必须一致；② 拿到裸词干要**点名报错**；③ 兜底 HTML 不许被当成资产字节。
  const bridge = /monsterAppear: \(monsterId, _templateId, name, nameKey, modelFile, level,/.test(wv);
  const mainArgs = /a\.name \|\| '',[^\n]*\n\s*a\.nameKey \|\| '',[^\n]*\n\s*a\.modelFile \|\| '',/.test(main);
  ok2('main.ts 实参顺序 = WorldView 形参顺序（name → nameKey → modelFile）', bridge && mainArgs);
  const loader = readFileSync(resolve('src/render/monster-loader.ts'), 'utf8');
  ok2('loadMonsterModel 点名拒绝非资产路径（裸词干 ⇒ 直说"字段串位"）',
    loader.includes('怪物模型路径不是资产路径') && loader.includes('是否串位'));
  const cache = readFileSync(resolve('src/core/asset-cache.ts'), 'utf8');
  ok2('取字节层按 content-type 判死 SPA 兜底 HTML（否则"文件不存在"伪装成解析失败）',
    cache.includes("ct.includes('text/html')") && cache.includes('HTML 兜底页'));
  setLocale('zh');
}

console.log(failed === 0 ? '\ni18n 一致性：全部通过' : `\ni18n 一致性：${failed} 条失败`);
process.exit(failed === 0 ? 0 : 1);
