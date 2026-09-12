/**
 * 武器挂载（`WeaponMount`）不变量核对 —— 它是自机 / 远端 / 检查器的**唯一实现**。
 *
 * 守住四条已经踩过或极易踩的坑：
 *   ① **镜像只对匕首**：刺客匕首（`mirrorLeftBone` 非空）才在另一侧 clone 一份；
 *      剑/斧/弓…绝不镜像（曾把镜像写成检查器专属，游戏内左手永远空着 —— 用户实测"刺客没有双持"）。
 *   ② **收械成对搬运**：持械 = 右手武器骨 + 左手武器骨；收械 = 右腰 + 左腰（两份一起动）。
 *   ③ **换武器必须重建镜像份**：镜像份是 clone，不随主手组更新（曾表现为"换了匕首左手还是上一把"）。
 *   ④ **镜像骨不存在时不回退**：报 missingBone 让调用方上报，而不是叠到右手上（重叠比缺失更难诊断）。
 *
 * 用法：npx tsx scripts/verify-mount.ts
 */
import * as THREE from 'three';
import { WeaponMount, WEAPON_BONES } from '../src/render/weapon-loader.js';
import dbRaw from '../src/game/data/item-weapon-semantics.generated.json';

const DB = dbRaw as unknown as {
  byIdcode: Record<string, { name: string; type: string; sheathe?: { slot: string; src: string } }>;
};

/** 取一件满足条件的武器 idcode */
function pick(desc: string, pred: (v: { name: string; type: string; sheathe?: { slot: string } }) => boolean): number {
  const hit = Object.entries(DB.byIdcode).find(([, v]) => pred(v));
  if (!hit) throw new Error(`生成物里没有满足「${desc}」的武器`);
  return Number(hit[0]);
}
const idcodeOf = (type: string): number => pick(`type=${type}`, (v) => v.type === type);

/** 假骨架：只放名字对的空 Object3D（findBone 递归 + 大小写不敏感） */
function skeleton(names: string[]): THREE.Object3D {
  const root = new THREE.Object3D();
  for (const n of names) {
    const b = new THREE.Object3D();
    b.name = n;
    root.add(b);
  }
  return root;
}

/**
 * 刺客（m6）骨架里与武器相关的骨。
 * ⚠ 必须把**收械骨**也放进来：少一根背挂骨，回退链会把武器挂回右手，
 * 于是"收械入背"这类断言会假失败（第一版脚本就这么错过一次）。
 */
const ASSASSIN_BONES = [
  WEAPON_BONES.RIGHT_HAND, WEAPON_BONES.LEFT_HAND, WEAPON_BONES.SHIELD,
  WEAPON_BONES.SHEATHE_BACK, WEAPON_BONES.SHEATHE_BOW, WEAPON_BONES.SHEATHE_CROSSBOW,
  WEAPON_BONES.ASSASSIN_LEFT, WEAPON_BONES.SHEATHE_DAGGER_L, WEAPON_BONES.SHEATHE_DAGGER_R,
];

let fail = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}：${String(got)}${ok ? '' : `（期望 ${String(want)}）`}`);
}

const dagger = idcodeOf('DAGGER');
// 收械**入背**的剑（真正的剑）；WS201-203 那几把"匕首型短剑"的槽是 `hand`（收械留手上），
// 见 AGENTS.md 纠错 #3a —— 拿它们测"入背"会得到错误结论（第一版脚本就踩了）。
const sword = pick('type=SWORD 且收械入背', (v) => v.type === 'SWORD' && (!v.sheathe || v.sheathe.slot === 'back'));
const handSword = pick('type=SWORD 且收械留手上', (v) => v.type === 'SWORD' && v.sheathe?.slot === 'hand');
console.log(`样本：匕首=${dagger} / 入背剑=${sword} / 留手上剑=${handSword}\n`);

// ① 匕首：持械 = 右手 + 左手武器骨（镜像）
{
  const mount = new WeaponMount();
  const root = skeleton(ASSASSIN_BONES);
  const g = new THREE.Group();
  const res = mount.mount(root, g, dagger, 1, 'combat');
  console.log('① 刺客匕首 持械');
  check('主手骨', res.mainBone, WEAPON_BONES.RIGHT_HAND);
  check('镜像骨', res.mirrorBone, WEAPON_BONES.ASSASSIN_LEFT);
  check('镜像份已建', mount.mirror !== null, true);
  check('镜像份与主手**不是**同一个对象', mount.mirror === g, false);
}

// ② 匕首：收械 = 右腰 + 左腰（成对搬运）
{
  const mount = new WeaponMount();
  const root = skeleton(ASSASSIN_BONES);
  mount.mount(root, new THREE.Group(), dagger, 1, 'combat');
  const res = mount.setStance(root, 'sheathed');
  console.log('\n② 刺客匕首 收械（安全区）');
  check('主手→右腰', res.mainBone, WEAPON_BONES.SHEATHE_DAGGER_R);
  check('镜像→左腰', res.mirrorBone, WEAPON_BONES.SHEATHE_DAGGER_L);
  const back = mount.setStance(root, 'combat');
  check('再切回持械：主手', back.mainBone, WEAPON_BONES.RIGHT_HAND);
  check('再切回持械：镜像', back.mirrorBone, WEAPON_BONES.ASSASSIN_LEFT);
}

// ③ 非匕首：绝不镜像
{
  const mount = new WeaponMount();
  const root = skeleton(ASSASSIN_BONES);
  const res = mount.mount(root, new THREE.Group(), sword, 1, 'combat');
  console.log('\n③ 剑（非匕首）');
  check('持械：主手', res.mainBone, WEAPON_BONES.RIGHT_HAND);
  check('持械：不镜像', res.mirrorBone, null);
  check('镜像份为空', mount.mirror, null);
  const sh = mount.setStance(root, 'sheathed');
  check('收械：入背', sh.mainBone, WEAPON_BONES.SHEATHE_BACK);
  check('收械：仍不镜像', sh.mirrorBone, null);

  // ③b 收械**留手上**的武器（WS201-203 匕首型短剑、爪、单手弩…）：收械后仍在该手
  const mount2 = new WeaponMount();
  const root2 = skeleton(ASSASSIN_BONES);
  mount2.mount(root2, new THREE.Group(), handSword, 1, 'combat');
  const sh2 = mount2.setStance(root2, 'sheathed');
  check('留手上类武器 收械后仍在右手', sh2.mainBone, WEAPON_BONES.RIGHT_HAND);
}

// ④ 换武器必须重建镜像份（否则左手留着上一把）
{
  const mount = new WeaponMount();
  const root = skeleton(ASSASSIN_BONES);
  mount.mount(root, new THREE.Group(), dagger, 1, 'combat');
  const oldMirror = mount.mirror!;
  const res = mount.mount(root, new THREE.Group(), sword, 1, 'combat');
  console.log('\n④ 匕首 → 剑（换武器）');
  check('旧镜像份已被摘除', oldMirror.parent, null);
  check('新武器不镜像', res.mirrorBone, null);
}

// ⑤ 镜像骨不存在 → 不回退、报 missingBone（会重叠到右手上比缺失更难诊断）
{
  const mount = new WeaponMount();
  const root = skeleton([WEAPON_BONES.RIGHT_HAND, WEAPON_BONES.LEFT_HAND]);
  const res = mount.mount(root, new THREE.Group(), dagger, 1, 'combat');
  console.log('\n⑤ 骨架没有镜像骨（如非刺客体型拿匕首）');
  check('主手仍挂上', res.mainBone, WEAPON_BONES.RIGHT_HAND);
  check('镜像未挂', res.mirrorBone, null);
  check('报出缺失的骨名', res.missingBone, WEAPON_BONES.ASSASSIN_LEFT);
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项不符`);
process.exit(fail === 0 ? 0 : 1);
