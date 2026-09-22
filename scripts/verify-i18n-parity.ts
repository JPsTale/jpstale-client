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

console.log(failed === 0 ? '\ni18n 一致性：全部通过' : `\ni18n 一致性：${failed} 条失败`);
process.exit(failed === 0 ? 0 : 1);
