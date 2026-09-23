/**
 * 技能身份/拳位的**校验器** —— 钉住三件事（评审稿 §5 第 3 步）。
 *
 *   校验 A  面板序对齐 —— 每职业按 `slotInJob` 升序取出的 20 行，`iconFile` 与
 *                         `skillData.SKILLS[classDir]` 的 20 格**逐项一致**（面板 == 服务端同一格）；
 *                         并核对 `slotInJob == 数组下标`、`skillId == 0x<job><tier><slot>`。
 *   校验 B  useCode     —— **有源码的格**（`sourceUseCode` 非空）客户端 `useCode` 必须等于源码值
 *                         （2026-09-23 裁定：权威 = 源码 `USECODE`）；无源码的 60 格**不参与**。
 *   校验 C  身份桥     —— **跑客户端真查表**（`game/skillIdentity.ts`）：220 个图标都能解出 id、
 *                         大小写/后缀不敏感、`skillRowBySkillId` 反查回同一行；且图标**互不相同**
 *                         （重复即"多候选"，`skillIdByIcon` 会返回 null ⇒ 那条分支才可达）。
 *   校验 D  等级链     —— **跑真 store 真解析器**：`setSkillList` 前 → 未知（null）；收到表后 →
 *                         已学的取服务端 `point`/`mastery`、未学的明确为 0（不是拿角色等级推一个）。
 *
 * ⚠ 期望值取自**生成物**（它是机械抽取的源码值），断言写在客户端数据上 —— 不一致时改客户端数据，
 *   不放宽断言（AGENTS：红了就报红）。
 *
 * 用法：`npm run verify-skill-usecode`
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SKILLS } from '../src/game/skillData.js';
import { skillIdByIcon, skillRowBySkillId } from '../src/game/skillIdentity.js';
import { installDomStub } from './dom-stub.js';

const here = dirname(fileURLToPath(import.meta.url));
const PATH = resolve(here, '../src/game/data/skill-tables.generated.json');

interface SkillRow {
  job: number; classDir: string; skillId: number; skillIdHex: string;
  slotInJob: number; tier: number; slotInTier: number;
  iconFile: string; useCode: string; sourceUseCode: string | null;
}

const gen = JSON.parse(readFileSync(PATH, 'utf8')) as { skills: SkillRow[] };
const rows = gen.skills;

let fails = 0;
const ok = (label: string, cond: boolean): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};

/* ─────────── 校验 A：面板序对齐（面板 == 服务端同一格） ─────────── */
console.log('\n[校验 A] 每职业 20 格：生成物 iconFile ↔ skillData 面板序');
{
  const badIcon: string[] = [];
  const badSlot: string[] = [];
  const badId: string[] = [];
  let cells = 0;
  for (const [jobStr, dir] of Object.entries({ 1: 'fighter', 2: 'mecha', 3: 'archer', 4: 'pikeman', 5: 'atalanta', 6: 'knight', 7: 'magician', 8: 'priestess', 9: 'assassin', 10: 'shaman', 11: 'martial' })) {
    const job = Number(jobStr);
    const list = rows.filter((r) => r.classDir === dir).sort((a, b) => a.slotInJob - b.slotInJob);
    const client = SKILLS[dir] ?? [];
    if (list.length !== 20 || client.length !== 20) {
      ok(`${dir}: 生成物 ${list.length} 行 / 客户端 ${client.length} 格（都应 20）`, false);
      continue;
    }
    for (let i = 0; i < 20; i++) {
      cells++;
      const r = list[i]!;
      const s = client[i]!;
      if (r.slotInJob !== i) badSlot.push(`${dir} idx${i}: slotInJob=${r.slotInJob}`);
      if (r.iconFile !== s.iconFile) badIcon.push(`${dir} idx${i}: 生成物 '${r.iconFile}' vs 客户端 '${s.iconFile}'`);
      const expect = (job << 16) | (r.tier << 8) | r.slotInTier;
      if (r.skillId !== expect) badId.push(`${dir} idx${i}: ${r.skillIdHex} vs 0x${expect.toString(16)}`);
    }
  }
  ok(`220 格逐项：iconFile 一致`, badIcon.length === 0);
  ok(`220 格逐项：slotInJob == 数组下标`, badSlot.length === 0);
  ok(`220 格逐项：skillId == 0x<job><tier><slot>`, badId.length === 0);
  console.log(`  ⇒ 比对格数 ${cells}`);
  badIcon.slice(0, 10).forEach((b) => console.log(`      ${b}`));
  badSlot.slice(0, 10).forEach((b) => console.log(`      ${b}`));
  badId.slice(0, 10).forEach((b) => console.log(`      ${b}`));
}

/* ─────────── 校验 B：useCode（只有源码的格参与） ─────────── */
console.log('\n[校验 B] useCode：客户端 == 源码 USECODE（无源码的 60 格不参与）');
{
  const diffs: string[] = [];
  let withSource = 0, without = 0;
  for (const r of rows) {
    const s = (SKILLS[r.classDir] ?? [])[r.slotInJob];
    if (!s) { console.log(`      ✗ ${r.classDir} idx${r.slotInJob}: 客户端没有这一格`); fails++; continue; }
    if (r.sourceUseCode == null) { without++; continue; }
    withSource++;
    if (s.useCode !== r.sourceUseCode) {
      diffs.push(`${r.classDir} idx${r.slotInJob} ${r.iconFile}: 客户端 '${s.useCode}' vs 源码 '${r.sourceUseCode}'`);
    }
  }
  ok(`有源码的 ${withSource} 格：客户端 useCode == sourceUseCode`, diffs.length === 0);
  console.log(`  ⇒ 参与 ${withSource} 格；无源码跳过 ${without} 格；**实测差异 ${diffs.length} 格**`);
  diffs.forEach((d) => console.log(`      ${d}`));
}

/* ─────────── 校验 C：身份桥（跑客户端真查表，不是读 JSON） ─────────── */
console.log('\n[校验 C] `game/skillIdentity.ts` 真查表：220 个图标双向可解');
{
  const byIdOk: string[] = [];
  const byIconOk: string[] = [];
  const normOk: string[] = [];
  const dupes: string[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const n = seen.get(r.iconFile);
    seen.set(r.iconFile, (n ?? 0) + 1);
    if (skillIdByIcon(r.iconFile) !== r.skillId) byIconOk.push(`${r.classDir}#${r.slotInJob} ${r.iconFile}`);
    if (skillIdByIcon(r.iconFile.replace(/\.bmp$/i, '').toUpperCase()) !== r.skillId) normOk.push(`${r.iconFile}`);
    if (skillRowBySkillId(r.skillId)?.iconFile !== r.iconFile) byIdOk.push(`0x${r.skillIdHex}`);
  }
  for (const [icon, n] of seen) if (n > 1) dupes.push(`${icon} ×${n}`);
  ok('220 个 iconFile → skillId 全部命中', byIconOk.length === 0);
  ok('220 个图标大小写/后缀不敏感（去 .bmp + 大写仍命中）', normOk.length === 0);
  ok('220 个 skillId → 整行 反查回同一行', byIdOk.length === 0);
  ok('220 个 iconFile 互不相同（无"多候选"⇒ 歧义分支不可达）', dupes.length === 0);
  [...byIconOk, ...normOk, ...byIdOk, ...dupes].slice(0, 10).forEach((b) => console.log(`      ${b}`));
}

/* ─────────── 校验 D：等级链（跑真 store + 真解析器） ─────────── */
console.log('\n[校验 D] 等级只认 `S2C_SkillList`：表没到 = 未知；未学 = 0');
{
  installDomStub();   // gameStore → item-sounds → sfx 在 import 期就注册 document/window
  const { setSkillList } = await import('../src/app/gameStore.js');
  const { skillLevelOf, skillMasteryOf, skillLevelByIcon } = await import('../src/game/skillLevel.js');

  const learned = rows.find((r) => r.classDir === 'pikeman' && r.slotInJob === 0)!;
  const unlearned = rows.find((r) => r.classDir === 'pikeman' && r.slotInJob === 1)!;

  setSkillList(null);
  ok('表没到 ⇒ 等级是"未知"(null)，不猜', skillLevelOf(learned.skillId) === null);

  setSkillList({
    learned: { [learned.skillId]: { point: 7, mastery: 2500 } },
    skillPoint: 3,
    specialSkillPoint: 1,
  });
  ok(`已学 ⇒ 服务端 point（${learned.iconFile} = 7）`, skillLevelOf(learned.skillId) === 7);
  ok('熟练度 ⇒ 服务端 mastery（2500）', skillMasteryOf(learned.skillId) === 2500);
  ok('图标 → id → 等级 走通', skillLevelByIcon(learned.iconFile) === 7);
  ok('同一图标不带上/带上 .bmp 都命中', skillLevelByIcon(learned.iconFile.replace(/\.bmp$/i, '')) === 7);
  ok(`表里没有的技能 ⇒ 明确 0（${unlearned.iconFile}）`, skillLevelOf(unlearned.skillId) === 0);
}

console.log(fails === 0
  ? `\n✓ verify-skill-usecode 通过`
  : `\n✗ ${fails} 条不符 —— 客户端数据与生成物不一致（改客户端数据，别改断言）`);
process.exit(fails === 0 ? 0 : 1);