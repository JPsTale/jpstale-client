// 原版技能数据（PristonTale 原版 20 技能/职业，含 10 职业 = 200 技能）。
// 数据来源：wartale.com 全部 50 个技能页逐页抓取（docs/wartale-skills.tsv），
// 每技能含官方英文名（name）、需求等级（reqLv）、分类（type），200 项全量覆盖。
// 图标 URL 与资源资产 image/sinimage/skill/{职业}/button/*.bmp 一一对应（iconFile）。
// alt = 早期 GLM/资源文件名引申的旧英译名（与 wartale 官方名不一致时保留参照）。
// 与 DB 的 skillinfo 无关（那是 EU 私服删减的 16 技能版）。
// 顺序 = 图标文件编号序，每 4 个一页（T1/T2/T3/T4/T5 共 5 页），index 0-3 页内技能。

export interface SkillDef {
  iconFile: string; // button/ 目录下的 bmp 文件名（原文件小写含空格）
  name: string;     // wartale 官方技能名
  reqLv: number;    // 需求等级
  type: string;     // 分类（Buff/Passive/Single Target/Target Area/Target Area(heal)/Summon/Active...）
  useCode: 'RIGHT' | 'LEFT' | 'ALL' | 'NOT'; // 可绑拳位（源自 Game.exe 技能表：RIGHT=仅右拳/ALL=左右皆可/NOT=不可绑；LEFT 无）
  alt?: string;     // 旧译名（仅与 wartale 官方名不一致时存在）
  weapon?: number[]; // 需求武器图标索引（1-11 对应原版 UseSkillItemInfo；空=无需武器）
  desc?: string;     // wartale 完整技能描述（多句以空格连接）
}

// 职业 id（服务端 job）→ 资源目录名
export const CLASS_DIR: Record<number, string> = {
  1: 'fighter', 2: 'mecha', 3: 'archer', 4: 'pikeman', 5: 'atalanta',
  6: 'knight', 7: 'magician', 8: 'priestess', 9: 'assassin', 10: 'shaman',
};

export const SKILLS: Record<string, SkillDef[]> = {
  fighter: [
    { iconFile: 'tf10 m_mastery.bmp', name: 'Melee Mastery', reqLv: 10, type: 'Passive', useCode: 'NOT', weapon: [1, 7, 3, 6], desc: 'Permanently increases attack power when using melee weapons' },
    { iconFile: 'tf12 f_attribute.bmp', name: 'Fire Attribute', reqLv: 12, type: 'Passive', useCode: 'NOT', weapon: [], desc: 'Permanently increases resistance to fire property attacks' },
    { iconFile: 'tf14 raving.bmp', name: 'Raving', reqLv: 14, type: 'Single Target', useCode: 'ALL', weapon: [1, 7, 3, 5, 6], desc: 'Goes berserk for a short period of time, increases attack power but decreases HP' },
    { iconFile: 'tf17 impact.bmp', name: 'Impact', reqLv: 17, type: 'Single Target', useCode: 'ALL', weapon: [1, 7, 5, 6], desc: 'Delivers two powerful swings on a single target Impact either successes or misses both attacks. Impact does 2 hits.' },
    { iconFile: 'tf20 t_impact.bmp', name: 'Triple Impact', reqLv: 20, type: 'Single Target', useCode: 'ALL', weapon: [1, 7, 5, 6], desc: 'Delivers devastating attack combos inflicting huge damage to the target Triple Impact either successes or misses both attacks.' },
    { iconFile: 'tf23 b_swing.bmp', name: 'Brutal Swing', reqLv: 23, type: 'Single Target', useCode: 'ALL', weapon: [1, 6], desc: 'Unleashes a massive attack inflicting huge damage to the target' },
    { iconFile: 'tf26 roar.bmp', name: 'Roar', reqLv: 26, type: 'Active', useCode: 'RIGHT', alt: 'War Cry', weapon: [1, 3, 6], desc: 'Shouts a deafening roar to momentarily stun enemies' },
    { iconFile: 'tf30 r_zecram.bmp', name: 'Rage of Zecram', reqLv: 30, type: 'Target Area', useCode: 'RIGHT', weapon: [1, 3, 6], desc: 'Uses the power of the legendary hero Zecram to unleash a powerful eruption of fire Rage of Zecram first hit is single target. Rage of Zecram does fire damage. Rage of Zecram does 2 hits.' },
    { iconFile: 'tf40 concentration.bmp', name: 'Concentration', reqLv: 40, type: 'Buff', useCode: 'RIGHT', weapon: [1, 6], desc: 'Increases attack rating with intense concentration Cannot be used simultaneously with Swiftness.' },
    { iconFile: 'tf43 a_crash.bmp', name: 'Avenging Crash', reqLv: 43, type: 'Single Target', useCode: 'RIGHT', weapon: [1, 6], desc: 'Inflicts great damage with the use of two deadly uppercuts Avenging Crash chains 50% of Brutal Swing\'s Critical. Avenging Crash does 2 hits.' },
    { iconFile: 'tf46 s_axe.bmp', name: 'Swiftness', reqLv: 46, type: 'Buff', useCode: 'RIGHT', alt: 'Swift Axe', weapon: [1, 6], desc: 'Increases attack speed Cannot be used simultaneously with Concentration.' },
    { iconFile: 'tf50 b_crash.bmp', name: 'Bone Crash', reqLv: 50, type: 'Single Target', useCode: 'RIGHT', weapon: [1, 6], desc: 'Jumps into the air and delivers a smashing blow on the target Bone Crash does 2 hits.' },
    { iconFile: 'tf60 destoryer.bmp', name: 'Destroyer', reqLv: 60, type: 'Single Target', useCode: 'ALL', weapon: [1], desc: 'Delivers a powerful combo with massive damage and increased critical Destroyer does +50% damage against demon monsters. Destroyer does 3 hits.' },
    { iconFile: 'tf63 berserker.bmp', name: 'Berserker', reqLv: 63, type: 'Buff', useCode: 'RIGHT', weapon: [], desc: 'Decreases absorb rating for an increased attack power' },
    { iconFile: 'tf66 c_strike.bmp', name: 'Cyclone Strike', reqLv: 66, type: 'Target Area', useCode: 'RIGHT', weapon: [1, 6], desc: 'Rotates creating a huge cyclone damaging surrounding targets Cyclone Strike can deal critical damage. Cyclone Strike does 2 hits. Cyclone Strike will always hit its targets. Cyclone Strike does bonus damage nearby monsterswithin a range of 100.' },
    { iconFile: 'tf70 b_health.bmp', name: 'Boost Health', reqLv: 70, type: 'Passive', useCode: 'NOT', weapon: [], desc: 'Increases HP permanently' },
    { iconFile: 'tf100 survival_instinct.bmp', name: 'Charge', reqLv: 80, type: 'Single Target', useCode: 'RIGHT', alt: 'Survival Instinct', weapon: [1, 6], desc: 'Charges towards the enemy with a powerful bash Charge can be cancelled by using the skill again. Charge is cancelled if fighter collide with the environment.' },
    { iconFile: 'tf103 sesmic_impact.bmp', name: 'Inner Soul', reqLv: 83, type: 'Buff', useCode: 'RIGHT', alt: 'Seismic Impact', weapon: [1, 6], desc: 'Adds Attack Rating Inner Soul chains 100% Concentration Attack Rating. Inner Soul cannot be used simultaneously with Concentration.' },
    { iconFile: 'tf106 ruthless_zecram.bmp', name: 'Hellion', reqLv: 86, type: 'Summon', useCode: 'RIGHT', alt: 'Ruthless Zecram', weapon: [1, 6], desc: 'Summon mischievous creatures from the underworld to loot gold or fight for you Hellion\'s keep 5% of all gold looted. Hellion\'s only loot in maps with a maximum level difference of 30 level. Hellion is automatically disabled if Fighter is not active. There is a 5% chance for the Hellion to rage against its summoner.' },
    { iconFile: 'tf110 whirlwind.bmp', name: 'Flame Vortex', reqLv: 90, type: 'Area Attack', useCode: 'RIGHT', alt: 'Whirlwind', weapon: [1, 6], desc: 'Spin frantically with a fiery axe, burning through enemies in your way Flame Vortex does damage every 0,25 seconds Flame vortex reduces Fighter movement speed by 50% Flame Vortex does fire damage.' },
  ],
  mecha: [
    { iconFile: 'tm10 ex_shield.bmp', name: 'Extreme Shield', reqLv: 10, type: 'Buff', useCode: 'RIGHT', weapon: [3, 6], desc: 'Increases block rating of your shield Cannot be used simultaneously with Spark Shield.' },
    { iconFile: 'tm12 m_bomb.bmp', name: 'Mechanic Bomb', reqLv: 12, type: 'Target Area', useCode: 'RIGHT', weapon: [3, 6], desc: 'Throws a bomb that causes an explosion damaging enemies in that area Mechanic Bomb does +50% damage against mutant monsters. Mechanic Bomb will always hit its targets. Does Fire damage.' },
    { iconFile: 'tm14 p_attribute.bmp', name: 'Reverse Engineering', reqLv: 14, type: 'Passive', useCode: 'NOT', alt: 'Poison Attribute', weapon: [3, 6], desc: 'Permanently increases damage against mechanic enemies by studying their components' },
    { iconFile: 'tm17 ph_absorb.bmp', name: 'Physical Absorption', reqLv: 17, type: 'Buff', useCode: 'RIGHT', alt: 'Physical Absorb', weapon: [3, 6], desc: 'Increases absorb rating Cannot be used simultaneously with Maximize, Automation, Metal Armor or Precision.' },
    { iconFile: 'tm20 g_smash.bmp', name: 'Great Smash', reqLv: 20, type: 'Single Target', useCode: 'ALL', weapon: [3, 6], desc: 'Delivers a powerful blow to the targeted enemy' },
    { iconFile: 'tm23 maximize.bmp', name: 'Maximize', reqLv: 23, type: 'Buff', useCode: 'RIGHT', weapon: [3, 6], desc: 'Optimizes weapon for increased attack power Cannot be used simultaneously with Physical Absorption, Automation, Metal Armor or Precision. Metal Armor chains Physical Absorption\'s by 100%.' },
    { iconFile: 'tm26 automation.bmp', name: 'Automation', reqLv: 26, type: 'Buff', useCode: 'RIGHT', weapon: [3, 6], desc: 'Automates projectile weapons to raise attack power and attack speed Cannot be used simultaneously with Physical Absorption, Maximize, Metal Armor or Precision.' },
    { iconFile: 'tm30 spark.bmp', name: 'Spark', reqLv: 30, type: 'Target Area', useCode: 'RIGHT', weapon: [3, 6], desc: 'Delivers a powerful lightning bolt towards the targeted enemy Spark does +50% damage against mechanic monsters. Spark will always hit its targets. Does Lightning damage.' },
    { iconFile: 'tm40 m_armor.bmp', name: 'Metal Armor', reqLv: 40, type: 'Buff', useCode: 'RIGHT', weapon: [3, 6], desc: 'Hardens your armor with a metallic coating to increase your defense Cannot be used simultaneously with Physical Absorption, Maximize, Automation or Precision. Metal Armor chains Physical Absorption\'s fixed absorb value by 200% and armor absorb boost value by 100%. Must wear a Mechanician specialized armor.' },
    { iconFile: 'tm43 grand_smash.bmp', name: 'Grand Smash', reqLv: 43, type: 'Single Target', useCode: 'RIGHT', weapon: [3, 6], desc: 'Delivers several powerful blows towards the targeted enemy Grand Smash does 2 hits.' },
    { iconFile: 'tm44 m_weapon.bmp', name: 'Mechanic Weapon Mastery', reqLv: 46, type: 'Passive', useCode: 'NOT', alt: 'Mechanic Weapon', weapon: [3, 6], desc: 'Optimizes weapons with mechanic spec' },
    { iconFile: 'tm50 s_shield.bmp', name: 'Spark Shield', reqLv: 50, type: 'Buff', useCode: 'RIGHT', weapon: [3, 6], desc: 'Absorbs energy from a blocked attack and emits electricity back at the enemy Spark Shield does +50% damage against Mechanic monsters. Spark Shield chains Spark\'s damage boost. Spark Shield is automatically disabled if Mechanician is not active. Does Lightning damage.' },
    { iconFile: 'tm60 impulsion.bmp', name: 'Impulsion', reqLv: 60, type: 'Target Area', useCode: 'RIGHT', weapon: [3, 6], desc: 'Delivers several powerful electric blows towards the targeted enemy Impulsion will always hit its targets. Impulsion does bonus damage nearby monsterswithin a range of 100. Does Lightning damage.' },
    { iconFile: 'tm63 compulsion.bmp', name: 'Compulsion', reqLv: 63, type: 'Buff', useCode: 'RIGHT', weapon: [3, 6], desc: 'Creates a magnetic field that pulls enemies towards you and increases absorb rating' },
    { iconFile: 'tm66 m_sphere.bmp', name: 'Magnetic Sphere', reqLv: 66, type: 'Active', useCode: 'RIGHT', weapon: [3, 6], desc: 'Generates three magnetic spheres that attack nearby enemies Magnetic Sphere does +50% damage against mechanic monsters. Magnetic Sphere will always hit its targets. Does Lightning damage.' },
    { iconFile: 'tm70 m_golem.bmp', name: 'Metal Golem', reqLv: 70, type: 'Summon', useCode: 'RIGHT', weapon: [3, 6], desc: 'Summons a huge metallic golem to aid you in battle attacking nearby enemies' },
    { iconFile: 'tm100 rupture.bmp', name: 'Precision', reqLv: 80, type: 'Buff', useCode: 'RIGHT', alt: 'Rupture', weapon: [3, 6], desc: 'Increases the ability to use Bows and Javelins with a specialty against Mechanic typed monsters Precision chains 100% Automation. Cannot be used simultaneously with Physical Absorption, Maximize, Automation or Metal Armor.' },
    { iconFile: 'tm103 parasit_shot.bmp', name: 'Trine Shield', reqLv: 83, type: 'Buff', useCode: 'RIGHT', alt: 'Parasit Shot', weapon: [3, 6], desc: 'Greatly increases the defensive power of your Shield' },
    { iconFile: 'tm106 hardening_shield.bmp', name: 'Gravitation', reqLv: 86, type: 'Buff', useCode: 'RIGHT', alt: 'Hardening Shield', weapon: [3, 6], desc: 'A portion of the damage inflicted on nearby party members is pulled to you' },
    { iconFile: 'tm110 magnetic_discharge.bmp', name: 'Obliterate', reqLv: 90, type: 'Single Target', useCode: 'RIGHT', alt: 'Magnetic Discharge', weapon: [3, 6], desc: 'Generate mechanical energy in your Metal Hammer to smash a massive crater Obliterate does bonus damage if Mechanician health is above 75%. Obliterate must be fully charged in order to inflict Area damage.' },
  ],
  archer: [
    { iconFile: 'ta10 s_hawk.bmp', name: 'Scout Hawk', reqLv: 10, type: 'Buff', useCode: 'RIGHT', weapon: [], desc: 'Summons a hawk to scout the surrounding area, increases attack rating on all surrounding enemies Scout Hawk cannot be used simultaneously with Falcon or Golden Falcon.' },
    { iconFile: 'ta12 s_mastery.bmp', name: 'Shooting Mastery', reqLv: 12, type: 'Passive', useCode: 'NOT', weapon: [8], desc: 'Permanently increases attack power with bows and crossbows' },
    { iconFile: 'ta14 w_arrow.bmp', name: 'Wind Arrow', reqLv: 14, type: 'Single Target', useCode: 'ALL', weapon: [8], desc: 'Imbues an arrow with wind properties to increase attack power Wind Arrow does +50% damage against normal monsters.' },
    { iconFile: 'ta17 p_aim.bmp', name: 'Perfect Aim', reqLv: 17, type: 'Single Target', useCode: 'ALL', weapon: [8], desc: 'Creates a well aimed shot with increased attack power and attack rating Perfect Aim does +100% damage against demon monsters.' },
    { iconFile: 'ta20 d_eye.bmp', name: 'Dion\'s Eye', reqLv: 20, type: 'Passive', useCode: 'NOT', alt: 'Dions Eye', weapon: [8], desc: 'Uses the Eye Sight of the Legendary Archer \'Dion\' to permanently increase Attack Rating based on your Weapon' },
    { iconFile: 'ta23 falcon.bmp', name: 'Falcon', reqLv: 23, type: 'Buff', useCode: 'RIGHT', weapon: [], desc: 'Summons a fierce falcon to attack targeted enemies Falcon will always hit its target. Falcon cannot be used simultaneously with Scout Hawk or Golden Falcon.' },
    { iconFile: 'ta26 a_rage.bmp', name: 'Arrow of Rage', reqLv: 26, type: 'Target Area', useCode: 'RIGHT', weapon: [8], desc: 'Shoots an arrow over a desired area which explodes in the air and rains a down fire of arrows on targeted enemies Arrow of Rage will always hit its targets' },
    { iconFile: 'ta30 avalanchie.bmp', name: 'Avalanche', reqLv: 30, type: 'Single Target', useCode: 'RIGHT', weapon: [8], desc: 'Unleashes a barrage of piercing arrows on a single target' },
    { iconFile: 'ta40 e_shot.bmp', name: 'Elemental Shot', reqLv: 40, type: 'Target Area', useCode: 'RIGHT', weapon: [8], desc: 'Shoots two elemental attacks towards the targeted enemy Elemental Shot will always hit its targets. Elemental Shot has a firing speed bonus. Elemental Shot randomly selects the elemental property. Elemental Shot does 2 hits. Elemental Shot  can deal critical damage.' },
    { iconFile: 'ta43 g_falcon.bmp', name: 'Golden Falcon', reqLv: 43, type: 'Buff', useCode: 'RIGHT', weapon: [], desc: 'Summons a falcon to attack targeted enemies Chains 50% to Scout Hawk\'s Attack Rating. Golden Falcon will always hit its target. Golden Falcon cannot be used simultaneously with Scout Hawk or Falcon.' },
    { iconFile: 'ta46 b_shot.bmp', name: 'Bomb Shot', reqLv: 46, type: 'Target Area', useCode: 'RIGHT', weapon: [8], desc: 'Fires two explosive arrows causing splash damage within the blast radius Fires two explosive arrows causing splash damage within the blast radius. Bomb Shot will always hit its targets. Bomb Shot\'s initial Firing speed is 6 regardless of your bow\'s Firing speed. Bomb Shot does double damage on the main target. Surrounding enemies get half of the Damage Boost, but get additional Splash Damage. Demon Bonus applies to area damage only. Bomb Shot does 2 hits.' },
    { iconFile: 'ta50 perforation.bmp', name: 'Perforation', reqLv: 50, type: 'Target Area', useCode: 'RIGHT', weapon: [8], desc: 'Accurate attack that perforates opponents Perforation will always hit its targets. Perforation can deal critical damage.' },
    { iconFile: 'ta60 r_wolverin.bmp', name: 'Wolverine', reqLv: 60, type: 'Summon', useCode: 'RIGHT', alt: 'Recall Wolverin', weapon: [], desc: 'Summons Wolverine to support you in battle' },
    { iconFile: 'ta63 e_mastery.bmp', name: 'Evasion Mastery', reqLv: 63, type: 'Passive', useCode: 'NOT', weapon: [8], desc: 'Avoids attacks effectively' },
    { iconFile: 'ta66 p_shot.bmp', name: 'Phoenix Shot', reqLv: 66, type: 'Single Target', useCode: 'RIGHT', weapon: [8], desc: 'Increases your attack power using the Power of Phoenix Phoenix Shot must be fully charged in order to inflict Linear Area damage.' },
    { iconFile: 'ta70 f_o_nature.bmp', name: 'Force of Nature', reqLv: 70, type: 'Buff', useCode: 'RIGHT', weapon: [8], desc: 'Improves your ability by natural assimilation perfectly' },
    { iconFile: 'ta100 lethal_sight.bmp', name: 'Stun Arrow', reqLv: 80, type: 'Active', useCode: 'RIGHT', alt: 'Lethal Sight', weapon: [8], desc: 'Fires an arrow that stuns the targeted enemy and slows nearby foes' },
    { iconFile: 'ta103 fierce_wind.bmp', name: 'Phoenix Speed', reqLv: 83, type: 'Buff', useCode: 'RIGHT', alt: 'Fierce Wind', weapon: [8], desc: 'Increases the Walking Speed and Evasion. Doubles stamina skill usage' },
    { iconFile: 'ta106 entailing_roots.bmp', name: 'Leap Shot', reqLv: 86, type: 'Single Target', useCode: 'RIGHT', alt: 'Entailing Roots', weapon: [8], desc: 'Swift retreat and pushback attack combo' },
    { iconFile: 'ta110 bombardment.bmp', name: 'Solar Arrow', reqLv: 90, type: 'Target Area', useCode: 'RIGHT', alt: 'Bombardment', weapon: [8], desc: 'The arrow gathers the power of the Sun en route to inflict bonus damage and split in two Solar Arrow does bonus damage if Archer is in maximum range. Solar arrow will not split if archer misses the hit. Solar arrow split range is equal the range from the target.' },
  ],
  pikeman: [
    { iconFile: 'tp10 p_wind.bmp', name: 'Pike Wind', reqLv: 10, type: 'Area Attack', useCode: 'RIGHT', weapon: [5], desc: 'Forms a whirlwind to push back and slightly damage surrounding enemies Pike Wind will always hit its targets.' },
    { iconFile: 'tp12 i_attribute.bmp', name: 'Ice Attribute', reqLv: 12, type: 'Passive', useCode: 'NOT', weapon: [3, 5], desc: 'Permanently increase resistance against frost property attacks Ice Attribute lowers the freezing duration' },
    { iconFile: 'tp14 cri_hit.bmp', name: 'Critical Hit', reqLv: 14, type: 'Single Target', useCode: 'ALL', weapon: [5], desc: 'Aims for the weak point of the targeted enemy to raise the probability of a critical strike Critical Hit has a +2 attack speed bonus. Critical Hit does 2 hits.' },
    { iconFile: 'tp17 j_crash.bmp', name: 'Jumping Crash', reqLv: 17, type: 'Single Target', useCode: 'ALL', weapon: [5], desc: 'Leaps up into the air to strikedown inflicting huge damage Jumping Crash does +100% damage against demon monsters.' },
    { iconFile: 'tp20 g_pike.bmp', name: 'Ground Pike', reqLv: 20, type: 'Area Attack', useCode: 'RIGHT', weapon: [5], desc: 'Freezes all enemies in range Ground Pike freeze duration is increased by 30% against demon or undead monsters. Ground Pike does ice damage.' },
    { iconFile: 'tp23 tornado.bmp', name: 'Tornado', reqLv: 23, type: 'Target Area', useCode: 'RIGHT', weapon: [5], desc: 'Summons a tornado to attack surrounding enemies Tornado will always hit its targets. Tornado area is relative to the target location.' },
    { iconFile: 'tp26 w_d_mastery.bmp', name: 'Weapon Defense Mastery', reqLv: 26, type: 'Passive', useCode: 'NOT', alt: 'Weapon Defence Mastery', weapon: [5], desc: 'Passively increases block rating' },
    { iconFile: 'tp30 expasion.bmp', name: 'Expansion', reqLv: 30, type: 'Target Area', useCode: 'ALL', weapon: [5, 3], desc: 'Unleashes a devastating attack to strike the enemy Expansion does +50% damage against mutant monsters. Expansion will always hit its targets. Expansion range is relative to the weapon size. Expansion does linear area damage.' },
    { iconFile: 'tp40 v_spear.bmp', name: 'Venom Spear', reqLv: 40, type: 'Area Attack', useCode: 'RIGHT', weapon: [5], desc: 'Poisons surrounding enemies with HP drain attack Venom Spear will always hit its targets. Venom Spear does Poison damage.' },
    { iconFile: 'tp43 vanish.bmp', name: 'Vanish', reqLv: 43, type: 'Buff', useCode: 'RIGHT', weapon: [], desc: 'Vanishes into thin air to reduce the sight range of enemies Vanish is only apllied to the first hit after the use. Vanish is automatically disabled after attacking an enemy.' },
    { iconFile: 'tp46 c_mastery.bmp', name: 'Critical Mastery', reqLv: 46, type: 'Passive', useCode: 'NOT', weapon: [5], desc: 'Permanently increases critical' },
    { iconFile: 'tp50 c_lance.bmp', name: 'Chain Lancer', reqLv: 50, type: 'Single Target', useCode: 'RIGHT', alt: 'Chain Lance', weapon: [5], desc: 'Jumps into the air slashing a single opponent with a fast and devastating combo Chain Lance does 3 hits.' },
    { iconFile: 'tp60 a_eye.bmp', name: 'Assassin\'s Eye', reqLv: 60, type: 'Active', useCode: 'RIGHT', alt: 'Assassin Eye', weapon: [5], desc: 'Exposes the enemy\'s weak spot Other Players can also benefit from Assassin\'s Eye' },
    { iconFile: 'tp63 c_strike.bmp', name: 'Charging Strike', reqLv: 63, type: 'Single Target', useCode: 'RIGHT', weapon: [5], desc: 'Charges at an enemy delivering three powerful blows on a single target Charging Strike must be completely charged in order to acquire the Fully Charged Damage Boost. Charging Strike does 3 hits.' },
    { iconFile: 'tp66 vague.bmp', name: 'Vague', reqLv: 66, type: 'Buff', useCode: 'RIGHT', weapon: [5], desc: 'Increases evasion rate when using spears Vague can evade area damage.' },
    { iconFile: 'tp70 s_master.bmp', name: 'Shadow Master', reqLv: 70, type: 'Single Target', useCode: 'RIGHT', weapon: [5], desc: 'Strikes a single target with a barrage of five powerful blows' },
    { iconFile: 'tp100 ring_spears.bmp', name: 'Attack Rating Mastery', reqLv: 80, type: 'Passive', useCode: 'NOT', alt: 'Ring Spears', weapon: [5], desc: 'Permanently boosts Attack Rating based on wielded Weapon' },
    { iconFile: 'tp103 focus.bmp', name: 'Lethal Strike', reqLv: 83, type: 'Single Target', useCode: 'RIGHT', alt: 'Focus', weapon: [5], desc: 'Throws a shuriken to a fleeing enemy Lethal strike does bonus damage if the enemy health is lower than 25%. Lethal strike does bonus damage if the enemy is running or walking.' },
    { iconFile: 'tp106 death_master.bmp', name: 'Dodge', reqLv: 86, type: 'Active', useCode: 'RIGHT', alt: 'Death Master', weapon: [5], desc: 'Evade enemy damage by predicting the hit Dodge can be used instantly while performing another action.' },
    { iconFile: 'tp110 twister.bmp', name: 'Vorpal Dive', reqLv: 90, type: 'Area Attack', useCode: 'RIGHT', alt: 'Twister', weapon: [5], desc: 'Dive to the selected location, piercing enemies with sharp ice spikes Vorpal Dive does extra damage against frozen enemies. Vorpal Dive does Ice damage.' },
  ],
  atalanta: [
    { iconFile: 'ma10 s_strike.bmp', name: 'Shield Strike', reqLv: 10, type: 'Target Area', useCode: 'RIGHT', weapon: [4], desc: 'Stuns and confuses the enemy by throwing your shield' },
    { iconFile: 'ma12 farina.bmp', name: 'Farina', reqLv: 12, type: 'Single Target', useCode: 'RIGHT', weapon: [9], desc: 'Throws a spear that creates illusions Farina does +50% Damage against normal monsters.' },
    { iconFile: 'ma14 t_mastery.bmp', name: 'Throwing Mastery', reqLv: 14, type: 'Passive', useCode: 'RIGHT', weapon: [9], desc: 'Trains Javelin attacks to increase damage permanently using Javelins' },
    { iconFile: 'ma17 v_spear.bmp', name: 'Vigor Spear', reqLv: 17, type: 'Single Target', useCode: 'ALL', weapon: [5, 9], desc: 'Attacks the targeted enemy with a holy Javelin Vigor Spear does +50% Damage against mechanic monsters.' },
    { iconFile: 'ma20 windy.bmp', name: 'Windy', reqLv: 20, type: 'Buff', useCode: 'NOT', weapon: [9], desc: 'Increases attack rating of Javelins' },
    { iconFile: 'ma23 t_javelin.bmp', name: 'Twist Javelin', reqLv: 23, type: 'Single Target', useCode: 'ALL', weapon: [9], desc: 'Increase attack rating and attack power with using a twisting tactic Twist Javelin does +100% Damage against demon monsters.' },
    { iconFile: 'ma26 s_sucker.bmp', name: 'Soul Sucker', reqLv: 26, type: 'Single Target', useCode: 'RIGHT', weapon: [4], desc: 'Absorbs the HP of enemies within attack range that have more than 50 percent HP' },
    { iconFile: 'ma30 f_javelin.bmp', name: 'Fire Javelin', reqLv: 30, type: 'Single Target', useCode: 'RIGHT', weapon: [9], desc: 'Attacks the enemy with power of fire Fire Javelin does +100% Damage against mutant monsters. Fire Javelin does Fire damage.' },
    { iconFile: 'ma40 split_javelin.bmp', name: 'Split Javelin', reqLv: 40, type: 'Single Target', useCode: 'RIGHT', weapon: [9], desc: 'Attacks the enemy with several powerful strikes at very fast speed' },
    { iconFile: 'ma43 t_of_valhalla.bmp', name: 'Triumph of Valhalla', reqLv: 43, type: 'Buff', useCode: 'ALL', weapon: [9], desc: 'Increases attack power of all party members Triumph of Valhalla cast onto other players give 50% of the added Max Attack Power based on the caster\'s level.' },
    { iconFile: 'ma46 l_javelin.bmp', name: 'Lightning Javelin', reqLv: 46, type: 'Target Area', useCode: 'RIGHT', weapon: [9], desc: 'Increases the lightning attribute of the Javelin Piercing does +50% Damage against undead monsters. Storm Javelin will always hit its targets. Lightning Javelin does Lightning Damage' },
    { iconFile: 'ma50 storm_javelin.bmp', name: 'Storm Javelin', reqLv: 50, type: 'Target Area', useCode: 'RIGHT', weapon: [9], desc: 'Attacks the enemy with a strong tornado tactic, pushing them back Storm Javelin will always hit its targets. Storm Javelin does linear area damage. Storm Javelin does 2 hits' },
    { iconFile: 'ma60 h_o_valhalla.bmp', name: 'Hall of Valhalla', reqLv: 60, type: 'Buff', useCode: 'ALL', weapon: [9], desc: 'Creates a space to unleash the Power of Valhalla Hall of Valhalla chains Triumph of Valhalla\'s Max. Attack Power by 100% Hall of Valhalla Evasion is reduced by 50% to party members. Hall of Valhalla can evade area damage.' },
    { iconFile: 'ma63 x_rage.bmp', name: 'Extreme Rage', reqLv: 63, type: 'Target Area', useCode: 'RIGHT', alt: 'X Rage', weapon: [9], desc: 'Attacks the enemy with Power of Anger Extreme Rage does 3 hits.' },
    { iconFile: 'ma66 f_javelin.bmp', name: 'Frost Javelin', reqLv: 66, type: 'Buff', useCode: 'RIGHT', weapon: [9], desc: 'Increases ice attribute for a period of time' },
    { iconFile: 'ma70 vengeance.bmp', name: 'Vengeance', reqLv: 70, type: 'Single Target', useCode: 'RIGHT', weapon: [9], desc: 'Attacks the enemy with several fast and powerful attacks Vengeance does 2 hits.' },
    { iconFile: 'ma100 s_tiger.bmp', name: 'Chimera of Light', reqLv: 80, type: 'Summon', useCode: 'RIGHT', alt: 'S Tiger', weapon: [5], desc: 'Summons a Chimera of Light' },
    { iconFile: 'ma103 golden_apple.bmp', name: 'Poison Javelin', reqLv: 83, type: 'Target Area', useCode: 'RIGHT', alt: 'Golden Apple', weapon: [5], desc: 'Hits the target with a fierce Poison Javelin' },
    { iconFile: 'ma106 plague_javelin.bmp', name: 'Amazon Rage', reqLv: 86, type: 'Buff', useCode: 'RIGHT', alt: 'Plague Javelin', weapon: [5], desc: 'Use Amazon\'s Power for increased attack speed, move speed. Doubles Mana skill usage' },
    { iconFile: 'ma110 combo_javelin.bmp', name: 'Javelin Mastery', reqLv: 90, type: 'Passive', useCode: 'NOT', alt: 'Combo Javelin', weapon: [9], desc: 'Permanently increases critical when using Javelins' },
  ],
  knight: [
    { iconFile: 'mn10 s_blast.bmp', name: 'Sword Blast', reqLv: 10, type: 'Target Area', useCode: 'RIGHT', weapon: [6], desc: 'Throws a devastating blast towards the targeted enemy damaging enemies in its path Sword Blast does +50% Damage Boost against normal and mutant monsters. Sword Blast will always hit its targets. Sword Blast does linear area damage.' },
    { iconFile: 'mn12 h_body.bmp', name: 'Holy Body', reqLv: 12, type: 'Passive', useCode: 'RIGHT', weapon: [], desc: 'Permanently reduces the damage taken from undead enemies' },
    { iconFile: 'mn14 p_traning.bmp', name: 'Physical Training', reqLv: 14, type: 'Passive', useCode: 'ALL', weapon: [], desc: 'Physical Training increases stamina permanently' },
    { iconFile: 'mn17 d_crash.bmp', name: 'Double Crash', reqLv: 17, type: 'Single Target', useCode: 'RIGHT', weapon: [1, 7, 6], desc: 'Strikes twice with a consecutive attack Double Crash does 2 hits.' },
    { iconFile: 'mn20 h_valor.bmp', name: 'Holy Valor', reqLv: 20, type: 'Buff', useCode: 'NOT', weapon: [], desc: 'Increases attack power of the party against the Undead Cannot be used simultaneously with Drastic Spirit. Damage Boost does not apply to AoE damage.' },
    { iconFile: 'mn23 brandish.bmp', name: 'Brandish', reqLv: 23, type: 'Target Area', useCode: 'ALL', weapon: [5, 6], desc: 'Damaging all enemies within the splash range Brandish will always hit its targets.' },
    { iconFile: 'mn26 piercing.bmp', name: 'Piercing', reqLv: 26, type: 'Target Area', useCode: 'RIGHT', weapon: [6], desc: 'Pierces a sword through the targeted enemy with a powerful attack Piercing does +100% Damage against mutant monsters. Piercing will always hit its targets. Piercing does linear area damage.' },
    { iconFile: 'mn30 d_spirit.bmp', name: 'Drastic Spirit', reqLv: 30, type: 'Buff', useCode: 'ALL', weapon: [], desc: 'Increases defense rating Cannot be used simultaneously with Holy Valor.' },
    { iconFile: 'mn40 s_mastery.bmp', name: 'Sword Mastery', reqLv: 40, type: 'Passive', useCode: 'ALL', weapon: [6], desc: 'Increases attack power on swords permanently' },
    { iconFile: 'mn43 d_inhalation.bmp', name: 'Divine Shield', reqLv: 43, type: 'Buff', useCode: 'RIGHT', alt: 'Divine Inhalation', weapon: [4], desc: 'Increases block and converts blocked undead damage into HP' },
    { iconFile: 'mn46 h_incantation.bmp', name: 'Holy Incantation', reqLv: 46, type: 'Active', useCode: 'NOT', weapon: [], desc: 'Transforms the targeted monster into a pet that will fight for you in battle for a period of time' },
    { iconFile: 'mn50 g_cross.bmp', name: 'Grand Cross', reqLv: 50, type: 'Single Target', useCode: 'RIGHT', weapon: [6], desc: 'Attacks the enemy with a deadly cross Grand Cross does 2 hits.' },
    { iconFile: 'mn60 s_o_justice.bmp', name: 'Sword of Justice', reqLv: 60, type: 'Target Area', useCode: 'RIGHT', weapon: [6], desc: 'Attacks the enemy with the help of God\'s power to unleash a devastating strike Sword of Justice will always hit its targets.' },
    { iconFile: 'mn63 g_shield.bmp', name: 'Godly Shield', reqLv: 63, type: 'Buff', useCode: 'RIGHT', weapon: [4], desc: 'Forms a Holy Shield blessed by God Godly Shield Chains 100% Divine Shield\'s Block.' },
    { iconFile: 'mn66 g_bless.bmp', name: 'God\'s Blessing', reqLv: 66, type: 'Buff', useCode: 'RIGHT', alt: 'God Bless', weapon: [1, 7, 3, 5, 6, 8, 9], desc: 'Increases your attack power by the name of God' },
    { iconFile: 'mn70 d_piercing.bmp', name: 'Divine Piercing', reqLv: 70, type: 'Single Target', useCode: 'RIGHT', weapon: [6], desc: 'Strikes the enemy with several powerful hits' },
    { iconFile: 'mn100 holy_conviction.bmp', name: 'Lightning Sword', reqLv: 80, type: 'Area Attack', useCode: 'RIGHT', alt: 'Holy Conviction', weapon: [6], desc: 'Use the Sword\'s magical power to subtract electricity from the air and stun enemies with it' },
    { iconFile: 'mn103 divine_inquisiton.bmp', name: 'Undead Bane', reqLv: 83, type: 'Passive', useCode: 'NOT', alt: 'Divine Inquisition', weapon: [6], desc: 'Permanently increases damage against undead enemies' },
    { iconFile: 'mn106 glorious_shield.bmp', name: 'Zealous Reach', reqLv: 86, type: 'Active', useCode: 'RIGHT', alt: 'Glorious Shield', weapon: [6], desc: 'Reach to an ally in need to protect with the Godly Barrier. Based on Drastic Spirit or Holy Valor Zealous Reach chains 100% Godly Shield\'s Damage Reduction 1h. If Drastic Spirit is active heal after 4 seconds If Holy Valor is active does damage after 4 seconds' },
    { iconFile: 'mn110 divine_cross.bmp', name: 'Holy Aura', reqLv: 90, type: 'Buff', useCode: 'RIGHT', alt: 'Divine Cross', weapon: [6], desc: 'A powerful aura that sucks the trapped life out of nearby undead monsters' },
  ],
  magician: [
    { iconFile: 'mm10 agony.bmp', name: 'Agony', reqLv: 10, type: 'Active', useCode: 'RIGHT', weapon: [2], desc: 'Instantly sacrifices your Health to restore Mana' },
    { iconFile: 'mm12 firebolt.bmp', name: 'Fire Bolt', reqLv: 12, type: 'Single Target', useCode: 'RIGHT', weapon: [2], desc: 'Shoot a Fire Bolt Fire Bolt does fire damage.' },
    { iconFile: 'mm14 zenith.bmp', name: 'Zenith', reqLv: 14, type: 'Buff', useCode: 'RIGHT', weapon: [2], desc: 'Increases elemental attributes for a period of time' },
    { iconFile: 'mm17 fireball.bmp', name: 'Fire Ball', reqLv: 17, type: 'Target Area', useCode: 'ALL', weapon: [2], desc: 'Fires a huge Fire Ball towards the enemy damaging all surroundings Fire Ball will always hit its target. Fire Ball does fire damage.' },
    { iconFile: 'mm20 m_mastery.bmp', name: 'Mental Mastery', reqLv: 20, type: 'Passive', useCode: 'RIGHT', weapon: [], desc: 'Permanently increase maximum MP' },
    { iconFile: 'mm23 watornado.bmp', name: 'Watornado', reqLv: 23, type: 'Target Area', useCode: 'RIGHT', weapon: [2], desc: 'Summons a Water Tornado on the enemy causing a devastating damage to the enemy and all surroundings Watornado reduces Lightning resistance of target by -50 on Water Duration. Watornado does water damage.' },
    { iconFile: 'mm26 e_weapon.bmp', name: 'Enchant Weapon', reqLv: 26, type: 'Buff', useCode: 'NOT', weapon: [2], desc: 'Enhances Attack Power with the Fire, Ice or Lightning Element Enchant Weapon randomly selects the elemental property. Affects the final damage inflicted on a target, after all modifiers.' },
    { iconFile: 'mm30 d_ray.bmp', name: 'Death Ray', reqLv: 30, type: 'Single Target', useCode: 'RIGHT', alt: 'Dead Ray', weapon: [2], desc: 'Fires a powerful ray from palms' },
    { iconFile: 'mm40 e_shield.bmp', name: 'Energy Shield', reqLv: 40, type: 'Buff', useCode: 'RIGHT', weapon: [2], desc: 'Reduces damage by absorbing a portion of the damage at the cost of mana' },
    { iconFile: 'mm43 diastrophism.bmp', name: 'Diastrophism', reqLv: 43, type: 'Area Attack', useCode: 'ALL', weapon: [2], desc: 'Strong geographical attack to opponents within range Diastrophism will always hit its targets. Diastrophism does 2 hits.' },
    { iconFile: 'mm46 s_elemental.bmp', name: 'Spirit Elemental', reqLv: 46, type: 'Buff', useCode: 'RIGHT', weapon: [2], desc: 'Summons a ghost to increase magical damage' },
    { iconFile: 'mm50 d_sword.bmp', name: 'Dancing Sword', reqLv: 50, type: 'Buff', useCode: 'RIGHT', weapon: [2], desc: 'Summons a dancing sword that damages the targeted enemies for a period of time Dancing Sword will always hit its target. Dancing Sword randomly selects the elemental property.' },
    { iconFile: 'mm60 f_elemental.bmp', name: 'Fire Elemental', reqLv: 60, type: 'Summon', useCode: 'RIGHT', weapon: [2], desc: 'Summons a Fire Elemental which will support you in battle with use of fire' },
    { iconFile: 'mm63 f_wave.bmp', name: 'Flame Wave', reqLv: 63, type: 'Target Area', useCode: 'RIGHT', weapon: [2], desc: 'Releases a devastating wave of fire towards the enemy causing massive damage to all surroundings Flame Wave will always hit its target. Flame Wave does 2 hits. Flame Wave does Fire damage.' },
    { iconFile: 'mm66 distortion.bmp', name: 'Distortion', reqLv: 66, type: 'Active', useCode: 'RIGHT', weapon: [2], desc: 'Slows down the enemies with the Distortion of Space' },
    { iconFile: 'mm70 meteo.bmp', name: 'Meteorite', reqLv: 70, type: 'Target Area', useCode: 'RIGHT', alt: 'Meteo', weapon: [2], desc: 'Calls a meteorite wave to strike down on the targeted enemy Meteorite does 3 hits. Meteorite does fire damage.' },
    { iconFile: 'mm100 wizardtrance.bmp', name: 'Magic Source', reqLv: 80, type: 'Buff', useCode: 'RIGHT', alt: 'Wizard Trance', weapon: [2], desc: 'Boosts MP and SP' },
    { iconFile: 'mm103 stone_skin.bmp', name: 'Amplify', reqLv: 83, type: 'Passive', useCode: 'NOT', alt: 'Stone Skin', weapon: [2], desc: 'Permanently boosts Attack Rating' },
    { iconFile: 'mm106 redray.bmp', name: 'Stone Spike', reqLv: 86, type: 'Area Attack', useCode: 'RIGHT', alt: 'Red Ray', weapon: [2], desc: 'Unleashes stone spikes which inflicts damage on nearby enemies Stone Spike will always hit its target.' },
    { iconFile: 'mm110 cataclysm.bmp', name: 'Dance of Calamity', reqLv: 90, type: 'Single Target', useCode: 'RIGHT', alt: 'Cataclysm', weapon: [2], desc: 'Wield the Dancing Sword in your hand to attack the enemy with elemental forces Dance of Calamity cooldown is reduced by 2.5s if Magician Mana is above 75% Dance of Calamity randomly selects the elemental property. Dance of Calamity does 3 hits.' },
  ],
  priestess: [
    { iconFile: 'mp10 healing.bmp', name: 'Healing', reqLv: 10, type: 'Active', useCode: 'RIGHT', weapon: [2], desc: 'Sends a healing elemental to regenerate the target\'s health over time' },
    { iconFile: 'mp12 holybolt.bmp', name: 'Holy Bolt', reqLv: 12, type: 'Single Target', useCode: 'RIGHT', weapon: [2], desc: 'Attacks the enemy with a holy bolt Holy bolt does +100% Damage against undead monsters.' },
    { iconFile: 'mp14 m_spark.bmp', name: 'Multi Spark', reqLv: 14, type: 'Single Target', useCode: 'RIGHT', weapon: [2], desc: 'Releases lightning sparks towards the enemy that stack into one powerful hit Multiple Spark does +50% Damage against mechanic monsters.' },
    { iconFile: 'mp17 holymind.bmp', name: 'Holy Mind', reqLv: 17, type: 'Active', useCode: 'ALL', weapon: [2], desc: 'Weakens the enemy attack power for a small period of time' },
    { iconFile: 'mp20 meditation.bmp', name: 'Meditation', reqLv: 20, type: 'Passive', useCode: 'RIGHT', weapon: [], desc: 'Increases MP Recovery permanently' },
    { iconFile: 'mp23 d_lightning.bmp', name: 'Divine Lightning', reqLv: 23, type: 'Area Attack', useCode: 'RIGHT', weapon: [2], desc: 'Attacks the enemy with a holy lightning Divine Lightning does +50% Damage against undead monsters. Divine Lightning will always hit its targets. Does lightning damage' },
    { iconFile: 'mp26 h_reflection.bmp', name: 'Holy Reflection', reqLv: 26, type: 'Buff', useCode: 'NOT', weapon: [2], desc: 'Reflects attacks from Undead enemies Holy Reflection is automatically disabled if Priestess is not active.' },
    { iconFile: 'mp30 g_healing.bmp', name: 'Grand Healing', reqLv: 30, type: 'Active', useCode: 'RIGHT', weapon: [2], desc: 'Instantly restores the health of party members and applies a healing effect to them Also activates Healing (T1) on Party Members if it\'s not already active' },
    { iconFile: 'mp40 v_ball.bmp', name: 'Vigor Ball', reqLv: 40, type: 'Single Target', useCode: 'RIGHT', weapon: [2], desc: 'Fires two Vigor Balls towards the enemy Vigor Ball does +80% Damage against undead monsters. Does 2 hits.' },
    { iconFile: 'mp43 resurrection.bmp', name: 'Resurrection', reqLv: 43, type: 'Active', useCode: 'RIGHT', weapon: [2], desc: 'Revives dead players within range' },
    { iconFile: 'mp46 extinction.bmp', name: 'Extinction', reqLv: 46, type: 'Active', useCode: 'ALL', weapon: [2], desc: 'Lethal incantation to undead monsters' },
    { iconFile: 'mp50 v_life.bmp', name: 'Virtual Life', reqLv: 50, type: 'Buff', useCode: 'RIGHT', weapon: [2], desc: 'Increases the HP of the targeted friend for a period of time and monster absorb for other classes' },
    { iconFile: 'mp60 g_spike.bmp', name: 'Glacial Spike', reqLv: 60, type: 'Target Area', useCode: 'RIGHT', weapon: [2], desc: 'Releases a huge ice block towards the enemy freezing all enemies in range Glacial Spike will always hit its targets. Glacial Spike does ice damage.' },
    { iconFile: 'mp63 r_field.bmp', name: 'Regeneration Field', reqLv: 63, type: 'Active', useCode: 'RIGHT', weapon: [2], desc: 'Creates a Regeneration field for a period of time, increases the regeneration of all party members in range Other players within Regeneration Field area will receive 50% of the benefits.' },
    { iconFile: 'mp66 c_lightning.bmp', name: 'Chain Lightning', reqLv: 66, type: 'Target Area', useCode: 'RIGHT', weapon: [2], desc: 'Releases a devastating Divine Lightning which also chain damages monsters in range Chain Lightning does +50% Damage against normal monsters. Chain Lightning will always hit its targets. Does Lightning damage.' },
    { iconFile: 'mp70 s_muspell.bmp', name: 'Summon Muspell', reqLv: 70, type: 'Buff', useCode: 'RIGHT', weapon: [2], desc: 'Summons a Muspell which absorbs attack power of Undead enemies Muspell\'s damage is equal to your own character. Muspell can evade area damage.' },
    { iconFile: 'mp100 ice_elemental.bmp', name: 'Divine Force', reqLv: 80, type: 'Buff', useCode: 'RIGHT', alt: 'Ice Elemental', weapon: [2], desc: 'Increases the 1v1 final damage, also applies to party members at half strength Divine Force Damage boost is reduced by 50% to party members. Damage boost is increased by 100% against undead monsters.' },
    { iconFile: 'mp103 lightning_surge.bmp', name: 'Ice Meteorite', reqLv: 83, type: 'Area Attack', useCode: 'RIGHT', alt: 'Lightning Surge', weapon: [2], desc: 'Calls in an ice cold meteorite storm which will damage and freeze opponents near the strike area of each meteorite Ice Meteorite will always hit its targets. The freezing time is stacked on existing freeze time of the opponent. Ice Meteorite does Ice damage.' },
    { iconFile: 'mp106 heavenly_light.bmp', name: 'Thunderstorm', reqLv: 86, type: 'Area Attack', useCode: 'RIGHT', alt: 'Heavenly Light', weapon: [2], desc: 'Purify the ground with an electric circle of unleashing divine lightnings Thunderstorm chains Divine Lightning\'s Damage Boost. Thunderstorm does lightning damage.' },
    { iconFile: 'mp110 consecration.bmp', name: 'Divine Cleansing', reqLv: 90, type: 'Active', useCode: 'RIGHT', alt: 'Consecration', weapon: [2], desc: 'Cleanse the targeted friend from debuffs and grants a short invulnerability' },
  ],
  assassin: [
    { iconFile: 'ta10 stingger.bmp', name: 'Stinger', reqLv: 10, type: 'Single Target', useCode: 'RIGHT', alt: 'Stingger', weapon: [10], desc: 'Runs straight towards the enemy and hits the enemy with two quick attacks Stinger does +50% Damage against normal and mutant monsters. Stinger does 2 Hits' },
    { iconFile: 'ta12 r_hit.bmp', name: 'Double Blow', reqLv: 12, type: 'Single Target', useCode: 'RIGHT', alt: 'Running Hit', weapon: [], desc: 'Deals continuous damage to the enemy while spinning Double Blow does 2 Hits' },
    { iconFile: 'ta14 d_mastery.bmp', name: 'Dual Wield Mastery', reqLv: 14, type: 'Passive', useCode: 'NOT', alt: 'Dual Sword Mastery', weapon: [10], desc: 'Increases your Attack Power permanently when using daggers' },
    { iconFile: 'ta17 wisp.bmp', name: 'Wisp', reqLv: 17, type: 'Active', useCode: 'RIGHT', weapon: [10], desc: 'Blinds the enemy temporarily, reducing their ability to accurately hit' },
    { iconFile: 'ta20 v_throne.bmp', name: 'Venom Thorn', reqLv: 20, type: 'Single Target', useCode: 'ALL', alt: 'Venom Throne', weapon: [10], desc: 'Attacks the enemy twice rapidly with poisoned daggers Venom Thorn does 2 hits. Venom Thorn does poison damage.' },
    { iconFile: 'ta23 alas.bmp', name: 'Alas', reqLv: 23, type: 'Buff', useCode: 'RIGHT', weapon: [10], desc: 'Distributes dexterity of an Assassin and increases Evasion of all party members' },
    { iconFile: 'ta26 s_shock.bmp', name: 'Soul Shock', reqLv: 26, type: 'Active', useCode: 'RIGHT', weapon: [10], desc: 'Performs a hard hit to the ground and stun all enemies around' },
    { iconFile: 'ta30 a_mastery.bmp', name: 'Blade Mastery', reqLv: 30, type: 'Passive', useCode: 'NOT', alt: 'Attack Mastery', weapon: [10], desc: 'Increases your Attack Power and Evasion permanently when using daggers Blade Mastery can evade area damage.' },
    { iconFile: 'ta40 s_sword.bmp', name: 'Finishing Blow', reqLv: 40, type: 'Single Target', useCode: 'ALL', alt: 'Sore Sword', weapon: [10], desc: 'Deals repeated damage to the enemy Finish Blow does 2 hits.' },
    { iconFile: 'ta43 b_up.bmp', name: 'Gust Slash', reqLv: 43, type: 'Target Area', useCode: 'RIGHT', alt: 'Beat Up', weapon: [10], desc: 'Jumps towards the enemy and attacks repeatedly to deal massive damage to the enemy and anyone nearby Gust Slash does +50% Damage against mechanic monsters. Gust Slash does 2 hits.' },
    { iconFile: 'ta46 inpes.bmp', name: 'Inpes', reqLv: 46, type: 'Buff', useCode: 'RIGHT', weapon: [10], desc: 'Increases your Attack Speed temporarily' },
    { iconFile: 'ta50 blind.bmp', name: 'Deception', reqLv: 50, type: 'Buff', useCode: 'RIGHT', alt: 'Blind', weapon: [10], desc: 'Hides into your own shadow which turn you invisible to enemies eyes for a short duration until you attack Deception is only apllied to the first hit after the use. Deception is automatically disabled after attacking an enemy.' },
    { iconFile: 'ta60 f_wind.bmp', name: 'Frost Wind', reqLv: 60, type: 'Single Target', useCode: 'RIGHT', weapon: [10], desc: 'Moves quickly to deal repeated fatal damage to the enemy Frost wind does 2 hits. Frost wind does ice damage.' },
    { iconFile: 'ta63 f_mastery.bmp', name: 'Fatal Mastery', reqLv: 63, type: 'Passive', useCode: 'NOT', alt: 'Critical Mastery', weapon: [], desc: 'Increases your Critical chance permanently when using daggers' },
    { iconFile: 'ta66 polluted.bmp', name: 'Pollute', reqLv: 66, type: 'Area Attack', useCode: 'RIGHT', alt: 'Polluted', weapon: [10], desc: 'Poisons all nearby enemies and decreases their health for a duration Pollute does +50% Damage against mutant monsters. Pollute does poison damage.' },
    { iconFile: 'ta70 p_shadow.bmp', name: 'Ninja Shadow', reqLv: 70, type: 'Single Target', useCode: 'RIGHT', alt: 'Pasting Shadow', weapon: [10], desc: 'Moves fast to deal continuous damage to the enemy with shadows' },
    { iconFile: 'ts80 j_bomb.bmp', name: 'Shadow Bomb', reqLv: 80, type: 'Area Attack', useCode: 'RIGHT', weapon: [10, 11], desc: 'Hides in the shadow and deals damage in an area by throwing a fire bomb on the ground Shadow Bomb does +50% Damage against normal monsters. Shadow Bomb does fire damage' },
    { iconFile: 'ts83 r_slash.bmp', name: 'Rising Slash', reqLv: 83, type: 'Target Area', useCode: 'RIGHT', weapon: [10, 11], desc: 'Jumps on the spot and uses gravitational energy to perform a big slash to the enemy Rising Slash does +100% Damage against mechanic monsters.' },
    { iconFile: 'ts86 v_stab.bmp', name: 'Violent Stab', reqLv: 86, type: 'Single Target', useCode: 'RIGHT', alt: 'Violence Stab', weapon: [10, 11], desc: 'A distracting kick quickly followed by a powerful blade stab' },
    { iconFile: 'ts90 storm.bmp', name: 'Shadow Storm', reqLv: 90, type: 'Target Area', useCode: 'RIGHT', alt: 'Storm', weapon: [10, 11], desc: 'Summons a storm to deal massive damage' },
  ],
  shaman: [
    { iconFile: 'ms10 darkbolt.bmp', name: 'Dark Bolt', reqLv: 10, type: 'Single Target', useCode: 'RIGHT', weapon: [11], desc: 'Hits the enemy with an almighty bolt of dark magic created with sorcery Dark Bolt does +50% Damage against normal and mutant monsters.' },
    { iconFile: 'ms12 darkwave.bmp', name: 'Dark Wave', reqLv: 12, type: 'Single Target', useCode: 'RIGHT', weapon: [11], desc: 'Performs a consecutive attack with almighty bolts of dark magic Dark Wave does +50% Damage against demon monsters.' },
    { iconFile: 'ms14 curselazy.bmp', name: 'Inertia', reqLv: 14, type: 'Active', useCode: 'ALL', alt: 'Curse Lazy', weapon: [11], desc: 'Throws a curse onto the enemy to slow down the enemy' },
    { iconFile: 'ms17 i_peace.bmp', name: 'Inner Peace', reqLv: 17, type: 'Passive', useCode: 'RIGHT', weapon: [], desc: 'Through mental training your maximum Mana capacity is increased permanently' },
    { iconFile: 'ms20 s_flare.bmp', name: 'Spiritual Flare', reqLv: 20, type: 'Target Area', useCode: 'RIGHT', weapon: [11], desc: 'Uses powerful sorcery to deal damage to all enemies nearby in the area Spirital Flare does +50% Damage against demon monsters.' },
    { iconFile: 'ms23 s_manacle.bmp', name: 'Spiritual Manacle', reqLv: 23, type: 'Active', useCode: 'NOT', alt: 'Soul Manacle', weapon: [11], desc: 'Binds the target\'s soul with sorcery that results in a stun of the target' },
    { iconFile: 'ms26 c_hunt.bmp', name: 'Chasing Hunt', reqLv: 26, type: 'Active', useCode: 'RIGHT', weapon: [11], desc: 'Increases your sight and gatherers nearby enemies close by luring them towards you' },
    { iconFile: 'ms30 a_migal.bmp', name: 'Advent Migal', reqLv: 30, type: 'Buff', useCode: 'RIGHT', weapon: [11], desc: 'Calls forth Migal to temporarily increase the Attack Power of you and your party members Cannot be used simultaneously with Advent Midranda' },
    { iconFile: 'ms40 r_maker.bmp', name: 'Rainmaker', reqLv: 40, type: 'Buff', useCode: 'RIGHT', alt: 'Rain Maker', weapon: [11], desc: 'Invokes the God of rain to temporarily increase your Absorption and Attack Rating' },
    { iconFile: 'ms43 l_ghost.bmp', name: 'Phantom Call', reqLv: 43, type: 'Area Attack', useCode: 'RIGHT', alt: 'Land of Ghost', weapon: [11], desc: 'Calls a Cursed Phantom to deal massive damage to enemies nearby Phantom Call does +50% Damage against demon monsters.' },
    { iconFile: 'ms46 haunt.bmp', name: 'Haunt', reqLv: 46, type: 'Single Target', useCode: 'RIGHT', weapon: [11], desc: 'With help of the Phantom\'s strength a forceful blow damages an enemy and absorbs part of the damage into HP Haunt does +50% Damage against demon monsters.' },
    { iconFile: 'ms50 scratch.bmp', name: 'Scratch', reqLv: 50, type: 'Single Target', useCode: 'RIGHT', weapon: [11], desc: 'Deals damage through a fiercely scratch by a summoned Phantom Nail Scratch does 2 hits.' },
    { iconFile: 'ms60 r_knight.bmp', name: 'Crimson Knight', reqLv: 60, type: 'Summon', useCode: 'RIGHT', alt: 'Recall Bloody Knight', weapon: [11], desc: 'Through black magic and use of sorcery the Crimson Knight is summoned' },
    { iconFile: 'ms63 judge.bmp', name: 'Judgement', reqLv: 63, type: 'Single Target', useCode: 'RIGHT', weapon: [11], desc: 'Deals a large portion of damage by shooting a powerful energy beam of darkness at the enemy Judgment does +50% Damage against demon monsters.' },
    { iconFile: 'ms66 a_midranda.bmp', name: 'Advent Midranda', reqLv: 66, type: 'Buff', useCode: 'RIGHT', weapon: [11], desc: 'Invokes Midranda to temporarily increase the Attack Speed of you and your party members Advent Midranda chains Advent Migal\'s Attack Power by 50%. Cannot be used simultaneously with Advent Migal.' },
    { iconFile: 'ms70 m_pray.bmp', name: 'Mourning Pray', reqLv: 70, type: 'Area Attack', useCode: 'RIGHT', alt: 'Mourning of Pray', weapon: [11], desc: 'By using the sacred powers of Midranda and Migal you damage all nearby enemies Mourning Pray does +50% Damage against undead monsters.' },
    { iconFile: 'ms80 creed.bmp', name: 'Creed', reqLv: 80, type: 'Buff', useCode: 'RIGHT', weapon: [2], desc: 'By the use of powerful sorcery you grant extra Mana and Stamina' },
    { iconFile: 'ms83 p_deity.bmp', name: 'Press Deity', reqLv: 83, type: 'Target Area', useCode: 'RIGHT', alt: 'Press of Deity', weapon: [2], desc: 'Unleashes a hidden power that throws cursed damage to nearby enemies' },
    { iconFile: 'ms86 g_nail.bmp', name: 'Phantom Nail', reqLv: 86, type: 'Target Area', useCode: 'RIGHT', alt: 'Ghosty Nail', weapon: [2], desc: 'Calls upon the spirit of the earth to attack nearby enemies' },
    { iconFile: 'ms90 h_regene.bmp', name: 'Occult Life', reqLv: 90, type: 'Passive', useCode: 'RIGHT', alt: 'High Regeneration', weapon: [2], desc: 'Permanently increases your maximum health with the power of sorcery' },
  ],
};
export const SKILLS_PER_PAGE = 4;
export const SKILL_PAGES = 5;

// 各职业技能树 5 阶（T1-T5）进阶职业名（wartale 页序，原版转职体系）。
// T5 为最终职业；未来新增 T6 时在数组末尾追加。
export const CLASS_TIERS: Record<string, string[]> = {
  fighter: ['Fighter', 'Warrior', 'Champion', 'Immortal Warrior', 'Warlord'],
  mecha: ['Mechanician', 'Mechanic Master', 'Metal Leader', 'Heavy Metal', 'Titanium Chief'],
  archer: ['Archer', 'Huntress Master', "Dion's Disciple", 'Sagittarius', 'Phoenix Master'],
  pikeman: ['Pikeman', 'Combatant', 'Lancer', 'Lancelot', 'Phalanx'],
  atalanta: ['Atalanta', 'Valkyrie', 'Brynhild', 'Valhalla', 'Sentinel'],
  knight: ['Knight', 'Paladin', 'Holy Knight', 'Saint Knight', 'Crusader'],
  magician: ['Magician', 'Wizard', 'Royal Wizard', 'Arch Mage', 'Elemental Master'],
  priestess: ['Priestess', 'Saintess', 'Bishop', 'Celestial', 'Prophetess'],
  assassin: ['Assassin', 'Rogue', 'Hermit', 'Shadower', 'Nightwalker'],
  shaman: ['Shaman', 'Clairvoyant', 'Conjurer', 'Necromancer', 'Oracle'],
};

/** 普攻图标 URL（/res 资产：image/sinimage/skill/skill_normal.bmp，非职业目录） */
export const NORMAL_ATTACK_ICON = 'skill_normal';

export function normalAttackIconUrl(): string {
  return `/res/image/sinimage/skill/${NORMAL_ATTACK_ICON}.bmp`;
}

/** 技能图标 URL（/res 资产：image/sinimage/skill/{职业}/button/{文件}.bmp） */
export function skillIconUrl(classDir: string, iconFile: string): string {
  const seg = iconFile.split(' ').map(encodeURIComponent).join('%20');
  return `/res/image/sinimage/skill/${classDir}/button/${seg}`;
}

/** 需求武器图标 URL（/res 资产：image/sinimage/skill/WeaponIcon/{1..13}.bmp） */
export function weaponIconUrl(idx: number): string {
  return `/res/image/sinimage/skill/WeaponIcon/${idx}.bmp`;
}