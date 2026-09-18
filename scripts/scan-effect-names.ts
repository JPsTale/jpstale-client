/**
 * 粒子/特效**名字索引**生成器 —— 写 `src/render/effects/effect-names.generated.json`
 * （「名字 → 精确路径」）。
 *
 * 为什么需要这张表（用户 2026-09-18 定调）：**原版从不探测文件系统** ——
 * 它在启动时按硬编码清单预载脚本（`HoEffect.cpp:12030+` 一连 307 条
 * `LoadScript("Effect\\Particle\\Script\\X.part")`），运行时 `Start("ChaosKaraSkill", …)`
 * 只在内存注册表里查名字（`HoNewParticleMgr.cpp:220` → `FindScript`，定义在 `:26`）。
 * 我们过去是"先试 `effect/animationdata/<名>.ini`，404 了再试 `.part`" ⇒ **每次 spawn 都白打一次 404**
 * （用户实测控制台一堆 `GET /res/effect/animationdata/*.ini 404`）。
 * 现在改成原版那套：清单随包进来（同步查表、不可能 404），启动时按清单预载
 * （见 `src/render/effects/effect-registry.ts`）。
 *
 * 家族（**名字互不重叠**，实测交集 0 ⇒ 名字本身就能定家族，于是查找无歧义）：
 *   ini   `effect/animationdata/*.ini`      INI 广告板（ImageData 那一条链）
 *   part  `effect/particle/script/*.part`   `.part` 源语（**两处**脚本目录都收）
 *         `game/scripts/particles/*.part`
 *   lua   `effect/neweffect/*.lua`          Lua NewEffect（前端还没做，先登记，做的时候按同一张表接）
 *   luac  `game/scripts/particles/*.luac`   编译版 Lua（字节码不可解析，但属资产、要登记）
 *
 * **名字撞车 ⇒ 直接报错退出、不写文件**：两个家族同名意味着"名字→家族"不再唯一，
 * 那是要人裁定的歧义，不能让生成器替我们挑一个（AGENTS「显式优于规则计算」）。
 *
 * 已知存在、**暂不纳入**的家族（等用到那一块时加一行即可）：
 *   `effect/objanimationdata/<名>/<名>.ini`  物件动画（每个名一个子目录，内含 .smd，文件名未必等于目录名）
 *   `effect/monstereffect/**`                怪物特效**贴图**（不是条目，是 `.part` 脚本的贴图来源）
 *   `effect/assaeffect/**`                   ASE/SMD **网格**（走 `fireMesh`/`static-fx`，按路径给，不按名字查）
 *
 * 用法：`npx tsx scripts/scan-effect-names.ts [资产根]`（默认 `PT_ASSET_ROOT` 或 `E:/JPsTale/client`）
 */
import fs from 'node:fs';
import path from 'node:path';

const ASSET = path.resolve(process.argv[2] ?? process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client');
const OUT = path.resolve('src/render/effects/effect-names.generated.json');

/** 家族 → 目录 + 扩展名（**唯一**家族表：运行时那边只读生成的 JSON，不再抄一份） */
const FAMILIES: Array<{ family: string; dir: string; ext: string }> = [
  { family: 'ini', dir: 'effect/animationdata', ext: '.ini' },
  { family: 'part', dir: 'effect/particle/script', ext: '.part' },
  { family: 'part', dir: 'game/scripts/particles', ext: '.part' },
  { family: 'lua', dir: 'effect/neweffect', ext: '.lua' },
  { family: 'luac', dir: 'game/scripts/particles', ext: '.luac' },
];

/** 家族 → 名字 → 相对路径（小写正斜杠，与 `/res/` 下的取法一致） */
const names: Record<string, Record<string, string>> = {};
/** 名字 → 出现在哪些家族（用来查撞车） */
const owners = new Map<string, Set<string>>();
const dirStats: Array<{ family: string; dir: string; n: number; missing: boolean }> = [];

for (const f of FAMILIES) {
  const abs = path.join(ASSET, f.dir);
  names[f.family] ??= {};
  if (!fs.existsSync(abs)) {
    dirStats.push({ family: f.family, dir: f.dir, n: 0, missing: true });
    continue;
  }
  const files = fs.readdirSync(abs)
    .filter((x) => x.toLowerCase().endsWith(f.ext))
    .sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    const name = file.slice(0, file.length - f.ext.length).toLowerCase();
    names[f.family]![name] = `${f.dir}/${file}`.toLowerCase();
    (owners.get(name) ?? owners.set(name, new Set()).get(name)!).add(f.family);
  }
  dirStats.push({ family: f.family, dir: f.dir, n: files.length, missing: false });
}

const collisions = [...owners.entries()].filter(([, s]) => s.size > 1)
  .map(([name, s]) => ({ name, families: [...s].sort() }));

console.log(`资产根 ${ASSET}`);
for (const d of dirStats) {
  console.log(`  ${d.family.padEnd(5)} ${d.dir.padEnd(30)} ${String(d.n).padStart(4)} 个`
    + (d.missing ? '   ⚠ 目录不存在' : ''));
}
const total = Object.values(names).reduce((n, m) => n + Object.keys(m).length, 0);
console.log(`合计 ${total} 个名字`);

if (collisions.length) {
  console.error(`\n✗ ${collisions.length} 个名字撞车（同一名字出现在多个家族）—— `
    + '「名字→家族」不再唯一，**没有写文件**，请先裁定：');
  for (const c of collisions.slice(0, 40)) {
    console.error(`   ${c.name}  ∈ ${c.families.join(' / ')}`
      + `   ${c.families.map((f) => names[f]![c.name]).join('  |  ')}`);
  }
  if (collisions.length > 40) console.error(`   … 另 ${collisions.length - 40} 个`);
  process.exit(1);
}

fs.writeFileSync(OUT, JSON.stringify({
  note: '粒子/特效**名字 → 精确路径**的唯一索引。原版从不探测文件系统（启动时按硬编码清单预载、'
    + '运行时只在内存注册表里 FindScript，见 HoNewParticleMgr.cpp:220），本表就是那份清单的等价物：'
    + '运行时同步查它、不可能 404。四族名字实测互不重叠（交集 0）⇒ 名字本身就能定家族。'
    + '生成：scripts/scan-effect-names.ts（npx tsx scripts/scan-effect-names.ts）—— '
    + '**资产增减后要重跑**，跑出来的名字数变化一眼可见。',
  assetRoot: ASSET.replace(/\\/g, '/'),
  dirs: FAMILIES.map((f) => `${f.family}:${f.dir}`),
  count: Object.fromEntries(Object.entries(names).map(([k, v]) => [k, Object.keys(v).length])),
  names: Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b))),
}, null, 1) + '\n');
console.log(`写出 ${OUT}`);
