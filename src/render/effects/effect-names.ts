/**
 * **名字 → 资产**的唯一实现（同步、纯本地查表，不做任何 I/O）。
 *
 * 单独一个模块的理由：离线脚本（`scripts/verify-fx-names.ts`）也要用**同一份**判断，
 * 而 `effect-registry.ts` 会连带 import 加载器（碰 three / DOM）⇒ 脚本里 import 不了它。
 * 与其让脚本抄一份归一化规则（AGENTS #15 禁止），不如把这层抽出来两边共用。
 *
 * 数据来自 `effect-names.generated.json`（`npm run fx-names` 生成）—— 见
 * `scripts/scan-effect-names.ts` 的说明：它就是原版那份"启动预载清单"的等价物。
 */
import NAMES from './effect-names.generated.json';

export type EffectFamily = 'ini' | 'part' | 'lua' | 'luac';

/** 清单里的一条：名字 + 家族 + **精确路径** */
export interface EffectEntry {
  name: string;
  family: EffectFamily;
  path: string;
}

/** 名字 → 路径（生成物；四族**互不重叠**，见 `scripts/scan-effect-names.ts`） */
const TABLE = NAMES.names as Record<EffectFamily, Record<string, string>>;

/** 四族（**唯一**的家族清单：查表顺序与预载顺序都读它，别处不要再抄一份） */
export const EFFECT_FAMILIES: EffectFamily[] = ['ini', 'part', 'lua', 'luac'];

const FAMILIES = EFFECT_FAMILIES;

/**
 * **名字 → 资产**（同步、纯本地查表；不做任何 I/O）。
 *
 * 归一化：取 basename、去掉家族扩展名、小写 —— 于是 `ChaosKaraSkill`、
 * `Effect\Particle\Script\chaoskaraskill.part`、`chaoskaraskill` 都指向同一条。
 * 找不到 = null（调用方自己决定要不要上报：工具里查名字不该刷降级清单）。
 */
export function lookupEffect(rawName: string): EffectEntry | null {
  const base = rawName.replace(/\\/g, '/').split('/').pop() ?? rawName;
  const name = base.replace(/\.(ini|part|lua|luac)$/i, '').toLowerCase();
  if (!name) return null;
  for (const family of FAMILIES) {
    const path = TABLE[family]?.[name];
    if (path) return { name, family, path };
  }
  return null;
}

/** 清单里某族的全部条目（预载、离线核对、将来的烘焙都走它） */
export function entriesOf(family: EffectFamily): EffectEntry[] {
  const m = TABLE[family] ?? {};
  return Object.keys(m).sort().map((name) => ({ name, family, path: m[name]! }));
}

/** 清单的各族条数（启动日志/工具回显） */
export function effectCounts(): Record<string, number> {
  return NAMES.count as Record<string, number>;
}
