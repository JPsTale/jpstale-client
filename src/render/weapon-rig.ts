/**
 * 一套装备（主手 + 副手）的**加载与挂载** —— 自机 / 远端玩家 / 选角预览的**唯一实现**。
 *
 * 为什么要有这一层：判定（骨名怎么算、要不要镜像、色表用哪一行）早就收在
 * `WeaponMount` / `offMountBoneOf` / `moveOffHandForStance` / `BlinkFx` 里了，但**编排**——
 * "加载 → 代际守卫 → 先建发光再挂载 → 副手挂哪根骨 → 摘旧件 → 销毁发光"——曾经在
 * 三处各写一遍（`WorldView.mountSelfWeapon`、`WorldView.mountRemoteWeapon`、`CharSelect` 的预览），
 * 而且**已经漂移**（副手那根骨：游戏内两处有"找不到就退到左手"的链、预览那份没有）。
 * 那正是 AGENTS #15 说的"同一判定出现第二份，哪怕只差一点，就是 bug 的种子"。
 *
 * ## 三条硬规矩
 *
 * 1. **不回退**（用户 2026-09-23 明确："装备在哪个手应该是确定性的，为什么需要回退？！"）：
 *    目标骨取不到 = **不挂**，如实上报（`reportFallback`），绝不换一只手/换一根骨凑合。
 *    依据同原版：`SetPattern` 就是 `GetObjectFromName("Bip weapon01")`（`NSP character.cpp:1865`），
 *    取不到就是 NULL —— **原版没有回退链**；回退到另一只手只会让"为什么挂错了"无从诊断。
 *    ⚠ 已知后果（**不是回退能解决的，只能如实报**）：`m8`（第 11 职业·格斗家，徒手）的骨架里
 *    **一根 "weapon" 骨都没有**（实测 `grep -i weapon M8-motion1.smb` = 0 命中）⇒ 该职业的武器
 *    不会挂上，日志/降级清单会说明"目标骨不在骨架里"。要让它显示，得**显式**给出该骨架的手部骨
 *    （那是数据决策，不是回退链）。
 * 2. **发光先于挂载**：叠加层是挂在网格子节点上的，而刺客匕首的镜像份是 `WeaponMount.mount()` 里
 *    `clone()` 出来的 —— 建晚了镜像那份就没有叠加层（一眼能看出来）。
 * 3. **守卫下沉到改场景的那一层**：`isAlive` 在**每次 await 之后**校验（AGENTS #11 第三条）。
 *    过期的那次装配必须"一个场景对象都不碰"，否则旧武器会留在别人/自己身上。
 */
import * as THREE from 'three';
import {
  loadWeaponModel, WeaponMount, offMountBoneOf, moveOffHandForStance, findBone, type MountResult,
} from './weapon-loader.js';
import { loadCharTextures } from './char-texture-loader.js';
import { BlinkFx } from './blink-fx.js';
import { reportFallback } from '../char/fallback-log.js';
import { blinkRowOfAppearance, type AppearanceBlinkInput } from '../game/agingBlink.js';

/**
 * 外观里与"手上那两件"有关的字段。**结构类型**（不 import `ui/CharSelect` 的接口）：
 * `CharacterAppearance` 恰好满足它，检查器/未来别的宿主也能直接传。
 */
export interface RigAppearance extends AppearanceBlinkInput {
  weaponDorp?: string;
  weaponIdcode?: number;
  weaponPos?: number;
  offHandDorp?: string;
  offHandKind?: number;
}

/** 一次装配的结果（调用方据此上报/打日志；**没有**"退而求其次"的隐含动作） */
export interface RigReport {
  /** 主手：实际挂到的骨 / 镜像份的骨 / 缺失的骨名 */
  main: MountResult;
  /** 副手实际挂到的骨名（null = 没有副手件，或目标骨不存在 ⇒ 未挂） */
  offBone: string | null;
  /** 副手缺失的目标骨名（供调用方上报；null = 无此事） */
  offMissingBone: string | null;
  /** true = 本次装配在 await 期间被判定过期（或已 dispose），**场景没有被改动过** */
  cancelled: boolean;
}

const CANCELLED: RigReport = {
  main: { mainBone: null, mirrorBone: null, missingBone: null },
  offBone: null,
  offMissingBone: null,
  cancelled: true,
};

/**
 * 一套装备的装配器：持有主手挂载器、副手组、两件各自的发光，以及"现在什么姿态"。
 * 生命周期与"那具角色"一致：角色出现 → `loadAndMount`；换装 → 再调一次；角色消失 → `dispose`。
 */
export class WeaponRig {
  private readonly mount = new WeaponMount();
  private offGroup: THREE.Group | null = null;
  private offBlink: BlinkFx | null = null;
  private offMissing: string | null = null;
  private idcode = 0;
  private offKind = 0;
  private stance: 'combat' | 'sheathed' = 'combat';
  /**
   * 装配代际号：`dispose()` 与每次 `loadAndMount()` 都会 +1，于是"在途的那次加载"自动作废
   * （AGENTS #11 第三条的守卫）。用它而不是一次性 `disposed` 标志：同一具角色换装/换角色时
   * rig 会被**复用**（选角页就是这样），一次性标志会让第二次装配永远返回 cancelled。
   */
  private gen = 0;

  /** 主手挂载器（攻击轨迹/投射物起点/换姿态要用它） */
  get main(): WeaponMount { return this.mount; }
  /** 副手组（null = 没挂） */
  get offHandGroup(): THREE.Object3D | null { return this.offGroup; }
  get currentStance(): 'combat' | 'sheathed' { return this.stance; }

  /**
   * 按外观把两件装好（**唯一入口**）。
   *
   * @param root    骨架根（角色组）。武器组是它的子孙骨上的挂件。
   * @param app     该角色的外观（武器/副手 dorp + 发光输入）
   * @param stance  当前姿态：持械挂手骨、收械挂背/腰
   * @param opts    anisotropy 纹理各向异性；isAlive 过期判据（每次 await 后校验）；
   *                label 日志/上报里的宿主名（'自机' / '远端 id=3' / '选角预览'）；
   *                jobId 职业（决定骨架 ⇒ 决定手部骨名，见 weapon-loader `HAND_BONE_BY_SKELETON`）
   */
  async loadAndMount(
    root: THREE.Object3D,
    app: RigAppearance | undefined,
    stance: 'combat' | 'sheathed',
    opts: { anisotropy?: number; isAlive?: () => boolean; label?: string; jobId?: number | null } = {},
  ): Promise<RigReport> {
    const myGen = ++this.gen;
    const stale = (): boolean => myGen !== this.gen;
    const alive = opts.isAlive ?? ((): boolean => true);
    const aniso = opts.anisotropy ?? 1;
    const label = opts.label ?? '装备';
    this.stance = stance;
    this.idcode = app?.weaponIdcode ?? 0;
    this.offKind = app?.offHandKind ?? 0;

    // 摘旧副手（主手连同镜像份与旧发光由 `mount.mount()` 自己收）—— 副手组是本类挂的，
    // 所以它的父节点必然是那根骨（确定性：只有本类会 add 它）
    this.detachOffHand();

    // ---- 主手（含双手武器的镜像份）----
    let mainGroup: THREE.Group | null = null;
    const dorp = app?.weaponDorp;
    if (dorp) {
      try {
        const wres = await loadWeaponModel(dorp);
        if (!alive() || stale()) return CANCELLED;            // 守卫在**改场景之前**
        await loadCharTextures(wres.texturesToLoad, aniso);
        if (!alive() || stale()) return CANCELLED;
        mainGroup = wres.group;
      } catch (e) {
        console.warn(`[rig] ${label} 主手加载失败 dorp=${dorp}`, e);
        reportFallback('mount', `${label} 主手模型加载失败 dorp=${dorp} ⇒ 该件不显示`);
      }
    }
    // 发光**先于挂载**建（见文件头第 2 条）
    const mainBlink = BlinkFx.create(mainGroup, blinkRowOfAppearance(app, 'main'), aniso);
    const main = this.mount.mount(root, mainGroup, this.idcode, app?.weaponPos, stance, mainBlink, opts.jobId);

    // ---- 副手（盾 → 左小臂；匕首 → 战斗左手 / 收械左腰；念珠不挂）----
    let offBone: string | null = null;
    this.offMissing = null;
    const offDorp = app?.offHandDorp;
    if (offDorp && this.offKind !== 0) {
      try {
        const ores = await loadWeaponModel(offDorp);
        if (!alive() || stale()) return { ...CANCELLED, main };        // 主手已挂上：如实返回，不谎报
        await loadCharTextures(ores.texturesToLoad, aniso);
        if (!alive() || stale()) return { ...CANCELLED, main };
        const boneName = offMountBoneOf(this.idcode, this.offKind, stance);
        const bone = findBone(root, boneName);
        if (bone) {
          this.offBlink = BlinkFx.create(ores.group, blinkRowOfAppearance(app, 'off'), aniso);
          this.offGroup = ores.group;
          bone.add(ores.group);
          offBone = bone.name;
        } else {
          // ★ 不回退（文件头第 1 条）：找不到就是找不到，如实上报，该件不显示
          this.offMissing = boneName;
        }
      } catch (e) {
        console.warn(`[rig] ${label} 副手加载失败 dorp=${offDorp}`, e);
        reportFallback('mount', `${label} 副手模型加载失败 dorp=${offDorp} ⇒ 该件不显示`);
      }
    }

    if (main.missingBone) {
      reportFallback('mount', `${label} 主手挂点缺失 dorp=${dorp} 目标骨=${main.missingBone} ⇒ 该件不挂（不回退）`);
    } else if (mainGroup) {
      console.log(`[rig] ${label} 主手: dorp=${dorp} bone=${main.mainBone}`
        + (main.mirrorBone ? ` 镜像=${main.mirrorBone}` : ''));
    }
    if (this.offMissing) {
      reportFallback('mount', `${label} 副手挂点缺失 dorp=${offDorp} 目标骨=${this.offMissing} ⇒ 该件不挂（不回退）`);
    } else if (offBone) {
      console.log(`[rig] ${label} 副手: dorp=${offDorp} kind=${this.offKind} bone=${offBone}`);
    }
    return { main, offBone, offMissingBone: this.offMissing, cancelled: false };
  }

  /**
   * 换姿态：主手（含镜像份）与副手**成对**搬（分开搬必然漏一份）。
   * 不加载任何资源（换姿态不该触发下载）——只搬运已挂上的组。
   */
  setStance(root: THREE.Object3D, stance: 'combat' | 'sheathed'): RigReport {
    if (this.stance === stance) {
      // 没变就是没动（调用方一般已自行去重）：如实返回"什么都没有发生"，不编造骨名
      return { main: { mainBone: null, mirrorBone: null, missingBone: null }, offBone: null, offMissingBone: null, cancelled: false };
    }
    this.stance = stance;
    const main = this.mount.setStance(root, stance);
    // 副手：盾留左臂不动、匕首在左手 ↔ 左腰之间搬（唯一实现在 weapon-loader）
    const offRes = moveOffHandForStance({
      root,
      off: this.offGroup,
      idcode: this.idcode,
      offKind: this.offKind,
      stance,
    });
    if (offRes.missingBone) {
      reportFallback('mount', `副手姿态 ${stance}：目标骨 ${offRes.missingBone} 不在骨架里 ⇒ 该件留在原挂点`);
    }
    return { main, offBone: offRes.moved ? 'moved' : null, offMissingBone: offRes.missingBone, cancelled: false };
  }

  /**
   * 只更新发光（外观里那四个字段变了、但模型没变时走这条 —— 例如装备着的武器锻造 +1）。
   * 不碰模型/动画/位置（那正是"外观指纹没变就不重建"的价值）。
   */
  setAppearance(app: RigAppearance | undefined): void {
    if (app?.weaponIdcode !== undefined) this.idcode = app.weaponIdcode;
    if (app?.offHandKind !== undefined) this.offKind = app.offHandKind;
    this.mount.blink?.setRow(blinkRowOfAppearance(app, 'main'));
    this.offBlink?.setRow(blinkRowOfAppearance(app, 'off'));
  }

  /** 每帧推进两件的呼吸发光（原版逐帧 `SetRenderBlinkColor`） */
  updateBlink(nowMs: number): void {
    this.mount.blink?.update(nowMs);
    this.offBlink?.update(nowMs);
  }

  /**
   * 卸下两件并作废在途装配（**可复用**：之后还能再 `loadAndMount`，选角页换角色就是这么用的）。
   * 组的几何/贴图不销毁（所有权归调用方）；发光材质是本类造的，随 `BlinkFx.dispose()` 一起收。
   */
  dispose(): void {
    this.gen++;
    this.detachOffHand();
    this.mount.detach();
    this.mount.disposeBlink();
  }

  private detachOffHand(): void {
    if (this.offGroup) {
      this.offGroup.parent?.remove(this.offGroup);
      this.offGroup = null;
    }
    this.offBlink?.dispose();
    this.offBlink = null;
    this.offMissing = null;
  }
}
