/**
 * 远程投射物回归（`npm run verify-projectile`）。
 *
 * 守四条（每条都对应一个"看错了就会静默错"的点）：
 *  ① **射什么由武器类型定**：弓/弩 → 一支箭；标枪 → 标枪本身；近战/法杖/拳套 → 什么都不射。
 *     这条判据两处共用（自机与旁观者），所以用仓库**真数据**逐件过一遍，不写死样本。
 *  ② **模型在盘上**：`weapons/arrow.smd`（弓/弩共用）+ 每件标枪自己的 dropitem 模型。
 *     缺任何一件的表现是"放了但看不见"，只会有一条 console.warn —— 必须在这里红。
 *  ③ **箭的朝向轴**：模型本地长轴必须在 **+Z 末端是尖**（实测：z 最大处只有 1 个顶点），
 *     经 `loadSmdFromUrl` 的 Z-up→Y-up 转换后 = 本地 **+Y** ⇒ 代码里按 +Y 对准目标才是对的。
 *     换模型/换资产时必须重验（尖反了 → 箭倒着飞）。
 *  ④ **飞行时长规则**：给了"释放→命中帧"的时长就用它（正好在命中帧到达）；没有则按弹速兜底，
 *     并夹在 [MIN,MAX] 内。
 *
 * 用法：npx tsx scripts/verify-projectile.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
import { parseSmb } from '../src/core/char-parser.js';
import { projectileChoiceOf, flightDuration, ARROW_URL, FALLBACK_SPEED, MIN_FLIGHT_SEC, MAX_FLIGHT_SEC, MAGIC_JOBS, tipAxisOf, unitBodyAnchorY, missContinue, MISS_PASS_THROUGH, RELEASE_LEAD_FRAMES, releaseDelaySec, releaseFlightTime } from '../src/render/projectile.js';
import { impShotSystem, IMP_SHOT_NAME, IMP_SHOT_HIT_FX } from '../src/render/effects/imp-shot.js';
import semRaw from '../src/game/data/item-weapon-semantics.generated.json';
import itemsRaw from '../src/game/data/source/items-11job.json';

const ASSET_ROOT = process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client';
const SEM = (semRaw as unknown as { byIdcode: Record<string, { name: string; type: string }> }).byIdcode;
const ITEMS = itemsRaw as unknown as Array<{ code: string; idCode?: number }>;
/** idcode → 模型码（dorpItem），来自 11 职业 OpenItem 扫出来的物品表 */
const codeByIdcode = new Map<number, string>();
for (const it of ITEMS) {
  if (typeof it.idCode === 'number' && it.code) codeByIdcode.set(it.idCode, it.code);
}

let fail = 0;
function check(label: string, got: unknown, want: unknown): void {
  // 用 JSON 比较（数组/对象也要能比）—— 裸 `===` 对数组永远是 false，
  // 报出来还是"两边一模一样"（本项目踩过这种自检假红）。
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}：${String(got)}${ok ? '' : `（期望 ${String(want)}）`}`);
}

// ① 判据：按类型分布逐族过
console.log('① 射什么（按武器类型，全表逐件）');
const byType = new Map<string, { n: number; bad: string[]; knownGap?: number }>();
for (const [idStr, v] of Object.entries(SEM)) {
  const id = Number(idStr);
  const choice = projectileChoiceOf(id, codeByIdcode.get(id) ?? null);
  const rec = byType.get(v.type) ?? { n: 0, bad: [] };
  rec.n++;
  const want: string | null = v.type === 'BOW' || v.type === 'CROSSBOW' ? 'arrow'
    : v.type === 'JAVELIN' ? 'javelin' : null;
  // ⚠ 标枪里有一批**没有模型码**的（私服新增、11 职业 OpenItem 里没有条目）：它们没有 dropitem 模型，
  // 故 `projectileChoiceOf` 给 null（**不能拿箭的模型顶替**，那是编数据）。这批列在下面，逐件核对名字，
  // 免得"哪天某件标枪悄悄丢了模型"被当成已知情况放过去。
  const knownModelLess = ['Cronus Javelin', 'Mythology Javelin', 'Abyss Javelin', "Beginner's Javelin", 'Star Wars Javelin'];
  const got = choice?.kind ?? null;
  const isKnownGap = v.type === 'JAVELIN' && !codeByIdcode.get(id) && knownModelLess.includes(v.name);
  if (got !== want && !isKnownGap) rec.bad.push((codeByIdcode.get(id) ?? idStr) + '/' + v.name);
  if (got === null && isKnownGap) rec.knownGap = (rec.knownGap ?? 0) + 1;
  byType.set(v.type, rec);
}
for (const [type, rec] of [...byType].sort((a, b) => a[0].localeCompare(b[0]))) {
  const want = type === 'BOW' || type === 'CROSSBOW' ? 'arrow' : type === 'JAVELIN' ? 'javelin' : 'null';
  const gap = rec.knownGap ? `（其中 ${rec.knownGap} 件无模型 = 已知数据缺口）` : '';
  check(`${type.padEnd(9)} ×${String(rec.n).padStart(2)} → ${want}${gap}`, rec.bad.length, 0);
}
// 没有模型码的标枪：不射（而不是射一把看不见的）
{
  const javelin = Object.entries(SEM).find(([, v]) => v.type === 'JAVELIN')!;
  check('标枪但没有模型码 → 不射（不用假模型兜底）', projectileChoiceOf(Number(javelin[0]), null), null);
}

// ② 资产在盘上
console.log('\n② 模型在盘上');
check('弓/弩共用的箭模型', existsSync(resolve(ASSET_ROOT, 'weapons/arrow.smd')), true);
check('箭的贴图', existsSync(resolve(ASSET_ROOT, 'weapons/arrow.tga')), true);
{
  const missing: string[] = [];
  for (const [idStr, v] of Object.entries(SEM)) {
    if (v.type !== 'JAVELIN') continue;
    const code = codeByIdcode.get(Number(idStr));
    if (!code) continue;
    if (!existsSync(resolve(ASSET_ROOT, `image/sinimage/items/dropitem/it${code.toLowerCase()}.smd`))) missing.push(code);
  }
  check(`全部标枪的 dropitem 模型存在（缺 ${missing.slice(0, 5).join(',')}${missing.length > 5 ? '…' : ''}）`, missing.length, 0);
}

// ③ 朝向轴：**按类型固定的常量**（不做几何推断 —— 头尾是资产既定事实）
console.log('\n③ 朝向轴（箭 +Y / 标枪 −Y）');
{
  const a = tipAxisOf('arrow'), j = tipAxisOf('javelin');
  check('箭：尖端轴 = +Y（弓已实测手感正确）', [a.x, a.y, a.z], [0, 1, 0]);
  check('标枪：尖端轴 = −Y（用户实测飞行时头尾颠倒 ⇒ 翻过来）', [j.x, j.y, j.z], [0, -1, 0]);
  const src = readFileSync(resolve(SCRIPT_DIR, '../src/render/projectile.ts'), 'utf8');
  check('摆姿时用的是这张表（不是写死的单一轴）',
    /setFromUnitVectors\(TIP_AXIS\[l\.kind\]/.test(src), true);
}

// ④ 飞行时长规则
console.log('\n④ 飞行时长（秒）');
check('有"释放→命中"时长就用它（800 子帧 @4800/秒）', Number(flightDuration(300, 800 / 4800).toFixed(4)), 0.1667);
check('没有事件帧 → 距离 ÷ 弹速', Number(flightDuration(FALLBACK_SPEED * 0.3).toFixed(4)), 0.3);
check('夹下限', flightDuration(1, 0.001), MIN_FLIGHT_SEC);
check('夹上限', flightDuration(1, 5), MAX_FLIGHT_SEC);
check('非正的显式时长按缺省处理', Number(flightDuration(FALLBACK_SPEED * 0.2, -1).toFixed(4)), 0.2);

// ⑤ 法术弹：法杖/图腾（attackClass = MAGIC）+ 职业门（法师 7 / 祭司 8 / 萨满 10）
console.log('\n⑤ 法术弹（法杖 STAFF / 图腾 PHANTOM）');
{
  // ⚠ 判据 = **职业 × 主手条件**，主手条件取自物品表的 **`category`**：
  //   法师 7 / 祭司 8：空手 或 **Wands**（法杖）→ 法术弹；萨满 10：**Phantom**（图腾）→ 法术弹
  //   （用户 2026-09-16 指出"gamedb.itemlist 有 category 字段，Phantom 是萨满图腾，Wands 是法师和祭司的法杖"）
  let magicBad = 0;
  const magicBadCase: string[] = [];
  const cats = Object.entries(SEM) as Array<[string, { category?: string; type?: string }]>;
  const wands = cats.filter(([, v]) => v.category === 'Wands');
  const totems = cats.filter(([, v]) => v.category === 'Phantom');
  for (const [idStr] of wands) {
    const id = Number(idStr);
    for (const job of [7, 8]) {
      if (projectileChoiceOf(id, codeByIdcode.get(id) ?? null, job)?.kind !== 'magic') { magicBad++; magicBadCase.push(`${codeByIdcode.get(id)}@job${job}`); }
    }
    // 法师/祭司之外（含萨满）拿法杖 → 不射
    for (const job of [1, 3, 9, 10, 11]) {
      if (projectileChoiceOf(id, codeByIdcode.get(id) ?? null, job) !== null) { magicBad++; magicBadCase.push(`${codeByIdcode.get(id)}@job${job}(应 null)`); }
    }
  }
  for (const [idStr] of totems) {
    const id = Number(idStr);
    if (projectileChoiceOf(id, codeByIdcode.get(id) ?? null, 10)?.kind !== 'magic') { magicBad++; magicBadCase.push(`${codeByIdcode.get(id)}@job10`); }
    for (const job of [7, 8, 1, 3, 9]) {
      if (projectileChoiceOf(id, codeByIdcode.get(id) ?? null, job) !== null) { magicBad++; magicBadCase.push(`${codeByIdcode.get(id)}@job${job}(应 null)`); }
    }
  }
  check(`Wands ×${wands.length}（法杖）→ 法师/祭司 施法；Phantom ×${totems.length}（图腾）→ 萨满 施法`
    + (magicBadCase.length ? `（例：${magicBadCase.slice(0, 4).join(', ')}）` : ''), magicBad, 0);

  let magicBad2 = 0;
  const magicBadCase2: string[] = [];
  const OFF_TABLE_STAFF = 0x01049900;   // 表外、但前缀属法杖族（私服新增法杖就是这个情形）
  for (const job of [7, 8]) {
    if (projectileChoiceOf(0, null, job)?.kind !== 'magic') { magicBad2++; magicBadCase2.push(`空手@job${job}`); }
    if (projectileChoiceOf(OFF_TABLE_STAFF, 'WM199', job)?.kind !== 'magic') { magicBad2++; magicBadCase2.push(`表外法杖@job${job}`); }
    // 近战/魔法族的"非本行"武器（装不上，但判据要正确）
    for (const t of ['SWORD', 'DAGGER', 'AXE', 'SCYTHE', 'CLAW', 'HAMMER']) {
      const id = Number(cats.find(([, v]) => v.type === t)?.[0] ?? 0);
      if (projectileChoiceOf(id, codeByIdcode.get(id) ?? 'xx1', job) !== null) { magicBad2++; magicBadCase2.push(`${t}@job${job}(应 null)`); }
    }
  }
  if (projectileChoiceOf(0, null, 10) !== null) { magicBad2++; magicBadCase2.push('空手@job10(应 null，原话只提图腾)'); }
  check('法师/祭司：空手 或 表外法杖 → 施法；持近战武器不射'
    + (magicBadCase2.length ? `（例：${magicBadCase2.slice(0, 4).join(', ')}）` : ''), magicBad2, 0);

  let meleeBad = 0;
  const melees = (Object.entries(SEM) as Array<[string, { attackClass?: string }]>)
    .filter(([, v]) => v.attackClass === 'MELEE');
  for (const [idStr] of melees) {
    const id = Number(idStr);
    // 非魔法职业拿近战武器 → 不射（魔法职业见上一条）
    for (const job of [1, 3, 9, 11]) {
      if (projectileChoiceOf(id, codeByIdcode.get(id) ?? null, job) !== null) meleeBad++;
    }
  }
  check(`MELEE 族 ×${melees.length} 件：非魔法职业不射`, meleeBad, 0);
  // "没有职业信息 → 不猜"：拿**需要职业才决定**的武器（法杖）验；弓/标枪与职业无关，本来就会出箭
  check('没有职业信息时不射（判据不猜）', projectileChoiceOf(Number(wands[0]?.[0] ?? 0), null, null), null);
  check('空手 + 非魔法职业 → 不射', projectileChoiceOf(0, null, 3), null);

  // 接线：空手时发射点退到右手武器骨（`Bip weapon01`，与原版 GetAttackPoint 同一位置）
  const srcWV = readFileSync(resolve(SCRIPT_DIR, '../src/ui/WorldView.ts'), 'utf8');
  check('空手施法有出手点（武器骨 → 手骨）',
    /mount\.group\?\.parent[\s\S]{0,200}?WEAPON_BONES\.RIGHT_HAND/.test(srcWV), true);
}

// ⑥ 默认弹 spec：把"从 HoParticle 搬来的值"钉住（改了会红，并提示出处）
console.log('\n⑥ 默认弹 spec（原版 MONSTER_IMP_SHOT1，参数搬自 HoParticle.cpp:213-246）');
{
  const sys = impShotSystem();
  const em = sys.emitters[0]!;
  const num = (v: unknown): number => (v as { v: number }).v;
  check('名字', sys.name, IMP_SHOT_NAME);
  // 贴图：原版用 Red.dds，但**我方 red.tga 是红色光球**（配近白调仍发红 ⇒ 用户实测"红色的小火球"），
  // 用户描述的原版是**青白** ⇒ 改用中性白色光斑 flare.tga（`ColorStart` 的 230/250/250 本身带青白）。
  check('贴图 = 中性白色光斑 flare.tga（不是红色的 red.tga）', em.texture, 'effect\\imagedata\\particle\\flare.tga');
  check('贴图在盘上', existsSync(resolve(ASSET_ROOT, 'effect/imagedata/particle/flare.tga')), true);
  check('混合 = lamp（原版 SMMAT_BLEND_LAMP）', em.blend, 'lamp');
  check('寿命 = 0.1s（原版 Life 0.005 被 HoClamp 到 MIN_LIFETIME=0.1）', num(em.lifetime), 0.1);
  check('尺寸比原值放大（用户实测"小"，我方决定的倍率）', num(em.initialSize) > 4, true);
  const c0 = em.initialColor as unknown as { r: unknown; g: unknown; b: unknown; a: unknown };
  const c1 = em.finalColor as unknown as { r: unknown; a: unknown };
  check('起色 (230,250,250,200)（原版 ColorStart/AlphaStart）',
    [num(c0.r), num(c0.g), num(c0.b), num(c0.a)], [230, 250, 250, 200]);
  check('末色/末透明 = 0（原版 ColorEnd/AlphaEnd）', [num(c1.r), num(c1.a)], [0, 0]);
  check('持续时间 0.9s（原版 Age 0.9）', Number((em.numParticles / em.emitRate).toFixed(2)), 0.9);
  check('命中特效 = 原版 MONSTER_IMP_HIT1 的两张 INI', [...IMP_SHOT_HIT_FX], ['MonsterImp1', 'Power1']);
  for (const name of IMP_SHOT_HIT_FX) {
    const p1 = resolve(ASSET_ROOT, `effect/imagedata/${name.toLowerCase()}.ini`);
    const p2 = resolve(ASSET_ROOT, `effect/animationdata/${name.toLowerCase()}.ini`);
    check(`${name} 的 INI 在盘上`, existsSync(p1) || existsSync(p2), true);
  }
}

// ⑦ 落点与 miss 续飞（用户 2026-09-16 实测反馈的三条）
console.log('\n⑦ 落点锚点 / miss 续飞');
check('落点 = 目标身体中部（root.y + topY×0.5）', unitBodyAnchorY(10, 3.4), 11.7);
{
  // 落点规则必须与命中特效（白光 NormalHit1 的落点）**同一份实现**：源码接线断言
  const src = readFileSync(resolve(SCRIPT_DIR, '../src/ui/WorldView.ts'), 'utf8');
  check('WorldView 的命中特效落点走 unitBodyAnchorY（唯一实现）',
    /function unitBodyAnchor\([\s\S]{0,400}?unitBodyAnchorY\(/.test(src), true);
  check('投射物也走同一锚点函数', /unitBodyAnchor\(targetId\)/.test(src), true);
  check('miss 判定取自"与命中音效同一份"服务端计划（到点现查）',
    /missed: \(\) => \{[\s\S]{0,300}?\.get\(0\)/.test(src), true);
  // ⚠ 必须传**取值函数**而不是计划值：自机的计划在起手之后才到（服务端回包），
  //   捕获当时的 null 会让 miss 判定静默退化成"永远算命中"
  check('自机传的是计划取值函数（不是捕获值）', /\(\) => selfAttackPlan/.test(src), true);
  check('旁观者传的是计划取值函数（不是捕获值）', /\(\) => actor\.attack\?\.plan/.test(src), true);
}
{
  // miss：**同速**再飞一段（用户明确要求"按相同的速度再飞一段距离"）
  const dist = 200, dur = 0.25;
  const c = missContinue(dist, dur);
  check('续飞长度 = MISS_PASS_THROUGH', c.length, MISS_PASS_THROUGH);
  check('续飞速度与命中段一致', Number((c.length / c.duration).toFixed(4)), Number((dist / dur).toFixed(4)));
  const d0 = missContinue(0, 0);
  check('无段信息时用弹速兜底（仍同速）', Number((d0.length / d0.duration).toFixed(4)), FALLBACK_SPEED);
}

// ⑧ 放箭时刻 = 事件帧前 RELEASE_LEAD_FRAMES 帧（"拉满弓"那一下），到达仍 = 事件帧
console.log('\n⑧ 放箭时刻（用户 2026-09-16 实测："抬手拉弓时箭就飞出去了"）');
{
  // 事件帧在 10 帧处、速率 1 ⇒ 提前 6 帧放箭 = (10-6) 帧 = 640/4800 s，飞行用掉 960/4800 s
  check('放箭延迟 =（事件帧 − 提前量）÷ 4800',
    Number(releaseDelaySec(1600, 1).toFixed(4)), Number((640 / 4800).toFixed(4)));
  check('飞行时长 = 提前量那段（到达 = 事件帧）',
    Number((releaseFlightTime(1600, 1) ?? 0).toFixed(4)), Number((960 / 4800).toFixed(4)));
  check('攻速快（rate=2）时提前量减半',
    Number(releaseDelaySec(1600, 2).toFixed(4)), Number((640 / 9600).toFixed(4)));
  check('事件帧比提前量还早 → 立即放箭（时间不为负）', releaseDelaySec(400, 1), 0);
  check('取不到事件帧 → 交给弹速兜底（undefined）', releaseFlightTime(undefined, 1), undefined);
  check('提前量常量（改观感就改它）', RELEASE_LEAD_FRAMES, 6);
  // 接线：放箭必须发生在"逐帧检查"里，而不是起手那一刻
  const src = readFileSync(resolve(SCRIPT_DIR, '../src/ui/WorldView.ts'), 'utf8');
  check('自机：在事件帧前提前量处放箭',
    /compFrame >= selfAttackEventFrames\[0\]! - RELEASE_LEAD_FRAMES \* 160/.test(src), true);
  check('旁观者：同一条规则',
    /compFrame >= actor\.attack\.eventFrames\[0\]! - RELEASE_LEAD_FRAMES \* 160/.test(src), true);
  check('起手处不再直接放箭（那会让箭在动画第 0 帧就飞）',
    /⚠ 投射物\*\*不在这里\*\*放/.test(src), true);
  check('飞行时长走 releaseFlightTime（同一份换算）', /releaseFlightTime\(eventFrame, rate\)/.test(src), true);
}

// ⑨ 跨语言一致性：服务端的"施法职业"与客户端的 MAGIC_JOBS 必须是同一组
//    （跨语言没法共享常量 ⇒ 两边各写注释互相指认 + 这里读服务端源码断言，改一边就红）
console.log('\n⑨ 施法职业集合：客户端 MAGIC_JOBS ↔ 服务端 PlayerStatCalculator.isMagicJob');
{
  const CALC = resolve(SCRIPT_DIR, '../..'
    + '/jpstale-server/pt-game-server/src/main/java/org/jpstale/server/game/service/PlayerStatCalculator.java');
  if (!existsSync(CALC)) {
    console.log(`  ! 未找到服务端源码，跳过该项（不静默通过）：${CALC}`);
  } else {
    const src = readFileSync(CALC, 'utf8');
    const m = /isMagicJob\(int job\)\s*\{[\s\S]{0,200}?return ([^;]+);/.exec(src);
    const serverJobs = m
      ? [...m[1]!.matchAll(/job\s*==\s*(\d+)/g)].map((x) => Number(x[1])).sort((a, b) => a - b)
      : null;
    check('服务端 isMagicJob 的职业集合与客户端一致', serverJobs, [...MAGIC_JOBS].sort((a, b) => a - b));
    check('服务端"魔法职业空手射程"常量存在（140 = 最低阶魔法武器射程）',
      /MAGIC_UNARMED_RANGE\s*=\s*140/.test(src), true);
    check('服务端用 hasWeapon 判"空手"（不是 range==0 —— 近战各族的 range 也是 0）',
      /!e\.hasWeapon && isMagicJob\(p\.getJob\(\)\)/.test(src), true);
  }
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项不符`);
process.exit(fail === 0 ? 0 : 1);
