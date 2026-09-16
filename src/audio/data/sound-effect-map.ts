/**
 * 怪物音效 ID → 音效目录名。
 * 等价于 C++ effectsnd.cpp 的 snFindEffects[] 表。
 * 数值与服务端 MonsterEffectId 枚举一致。
 *
 * 目录是 assets/wav/effects/monster/ 或 npc/ 下的子目录名（小写）。
 * 有些怪物共享同一套音效（如 ICEGOBLIN → heavygoblin 目录）。
 *
 * S_ 前缀条目（0x51xx~0x53xx）是精英变体，C++ 没有独立条目，
 * 服务端可将其 effect 设为对应基础怪的枚举值以复用音效。
 */

export const MONSTER_EFFECT_DIR: Record<number, string> = {
  // ── 0x10xx: 基础怪 ──
  0x1000: 'cyclops',
  0x1010: 'hob goblin',   // 原版目录含空格
  0x1020: 'imp',
  0x1030: 'minig',
  0x1040: 'plant',
  0x1050: 'skeleton',
  0x1060: 'zombi',
  0x1070: 'obit',

  0x1080: 'hopt',
  0x1090: 'bargon',
  0x10A0: 'leech',
  0x10B0: 'mushroom',

  0x10C0: 'arma',
  0x10D0: 'scorpion',

  // ── 0x11xx ──
  0x1100: 'headcutter',
  0x1110: 'sandlem',
  0x1120: 'web',
  0x1130: 'hopyking',
  0x1140: 'crip',
  0x1150: 'buma',
  0x1160: 'decoy',
  0x1170: 'doral',
  0x1180: 'figon',
  0x1190: 'stonegiant',
  0x11A0: 'greven',
  0x11B0: 'illusionknight',
  0x11C0: 'skeletonrange',
  0x11D0: 'skeletonmelee',
  0x11E0: 'wolverin',

  // ── 0x12xx ──
  0x1200: 'rabie',
  0x1210: 'mudy',
  0x1220: 'sen',
  0x1230: 'egan',
  0x1240: 'beedog',
  0x1250: 'mutantplant',
  0x1260: 'mutantrabie',
  0x1270: 'mutanttree',
  0x1280: 'avelisk',
  0x1290: 'naz',
  0x12A0: 'mummy',
  0x12B0: 'hulk',
  0x12C0: 'succubus',
  0x12D0: 'dawlin',
  0x12E0: 'shadow',
  0x12F0: 'berserker',

  // ── 0x13xx ──
  0x1300: 'ironguard',
  0x1310: 'fury',
  0x1320: 'sliver',
  0x1330: 'hungky',

  0x1340: 'ratoo',
  0x1350: 'stygianlord',
  0x1360: 'omicron',
  0x1370: 'd-machine',
  0x1380: 'metron',

  0x1390: 'mrghost',

  0x13A0: 'vampiricbat',
  0x13B0: 'mirekeeper',
  0x13C0: 'muffin',
  0x13D0: 'solidsnail',
  0x13E0: 'beevil',
  0x13F0: 'beevil',        // DIREBEE → 复用 beevil 目录
  0x1400: 'nightmare',
  0x1410: 'stonegolem',
  0x1420: 'thorncrawler',
  0x1430: 'heavygoblin',
  0x1440: 'evilplant',
  0x1450: 'hauntingplant',
  0x1460: 'darkknight',
  0x1470: 'guardian-saint',

  // ── 0x15xx ──
  0x1500: 'chaingolem',
  0x1510: 'deadzone',
  0x1520: 'grotesque',
  0x1530: 'hypermachine',
  0x1540: 'ironfist',
  0x1550: 'morgon',
  0x1560: 'mountain',
  0x1570: 'rampage',
  0x1580: 'runicguardian',
  0x1590: 'sadness',
  0x15A0: 'towergolem',
  0x15B0: 'vampiricbee',
  0x15C0: 'vampiricmachine',
  0x15D0: 'omu',

  0x15E0: 'avelinarcher',
  0x15F0: 'avelinqueen',

  // ── 0x16xx ──
  0x1600: 'babel',

  0x1610: 'mystic',
  0x1620: 'heavygoblin',  // ICEGOBLIN → 复用 heavygoblin
  0x1630: 'coldeye',
  0x1640: 'frozen',
  0x1650: 'stonegolem',   // ICEGOLEM → 复用 stonegolem
  0x1660: 'frost',
  0x1670: 'chaoscara',
  0x1680: 'deathknight',

  // ── 0x17xx ──
  0x1700: 'greven',       // GREATE_GREVEN → 复用 greven
  0x1710: 'lizardfolk',
  0x1720: 'm_lord',
  0x1730: 'spider',
  0x1740: 'stingray',
  0x1750: 'strider',

  // ── 0x18xx ──
  0x1800: 'turtlecannon',
  0x1810: 'devilbird',
  0x1820: 'blizzardgiant',
  0x1830: 'kelvezu',

  0x1840: 'darkphalanx',
  0x1850: 'bloodyknight',
  0x1860: 'chimera',
  0x1870: 'fireworm',
  0x1880: 'hellhound',
  0x1890: 'darkguard',
  0x18A0: 'darkmage',

  0x18B0: 'monmokova',
  0x18C0: 'montempleguard',
  0x18D0: 'monseto',
  0x18E0: 'monkingspider',

  0x18F0: 'd_kn',
  0x1900: 'd_magi',
  0x1910: 'd_ar',
  0x1920: 'd_atal',
  0x1930: 'd_fi',
  0x1940: 'd_meca',
  0x1950: 'd_pa',
  0x1960: 'd_pr',
  0x1970: 'deadhopt',
  0x1980: 'deadkinghopy',
  0x1990: 'gorgon',
  0x19A0: 'hobogolem',

  0x19B0: 'niken',
  0x19C0: 'mimic',
  0x19D0: 'kingbat',
  0x19E0: 'goblinshaman',
  0x19F0: 'hest',

  // ── 0x1Axx: NPC ──
  0x1A00: 'worldcup',

  // ── 0x20xx: NPC ──
  0x2010: 'morif',
  0x2012: 'mollywolf',
  0x2020: 'skillmaster',
  0x2030: 'magicmaster',

  // ── 0x21xx: 节日/特殊怪 ──
  0x2100: 'ruca',
  0x2110: 'nazsenior',
  0x2120: 'igolation',
  0x2130: 'kakoa',
  0x2140: 'sprin',
  0x2150: 'undeadmaple',
  0x2160: 'xetan',
  0x2170: 'bebechick',
  0x2180: 'papachick',
  0x21A0: 'bear',
  0x21C0: 'snowman',
  0x21D0: 'devilshy',
  0x21F1: 'brazilbear',

  // ── 0x22xx: 冰系 ──
  0x2200: 'iceserpent',
  0x2210: 'iceworm',
  0x2220: 'vampiricbat',  // ICEBAT → 复用 vampiricbat
  0x2230: 'minegolem',
  0x2240: 'sealcrasher',
  0x2250: 'tarantulika',
  0x2260: 'tulla',
  0x2270: 'undeadminer',
  0x2280: 'undeadmanager',

  // ── 0x23xx: 11 职业新怪 ──
  0x2300: 'itechnician',
  0x2301: 'ltechnician',
  0x2302: 'lengineer',
  0x2303: 'isoldier',
  0x2304: 'ibomber',
  0x2305: 'lguardian',
  0x2306: 'ielite',
  0x2307: 'draxos',
  0x2308: 'acero',
  0x2309: 'nihil',
  0x2310: 'chalybs',
  0x2311: 'figon',        // GREEDY / FIRE_ELEMENTAL 共用 hex
  0x2312: 'midranda',
  0x2313: 'flamo',
  0x2314: 'igniculus',
  0x2315: 'insec',
  0x2316: 'lavaarcher',
  0x2317: 'lavaarmor',
  0x2318: 'lavagiant',
  0x2319: 'lavagolem',
  0x2320: 'flamemaiden',
  0x2321: 'draxos',       // DRAXOS_1 → 复用 draxos
  0x2322: 'lizard_elder',
  0x2323: 'hongky',
  0x2324: 'hestian',
  0x2325: 'hestian',      // TYRCUS → 复用 hestian（同族火系）
  0x2326: 'ignis',

  // ── 0x30xx: 技能召唤物 ──
  0x3010: 'wolverin',     // S_WOLVERLIN → 复用 wolverin
  0x3020: 'metalgolem',   // S_METALGOLEM
  0x3030: 'figon',        // S_F_ELEMENTAL → 复用 figon

  // ── 0x50xx: 攻城/城堡 ──
  0x5010: 'castledoor',
  0x5020: 'crystal_r',
  0x5021: 'crystal_g',
  0x5022: 'crystal_b',
  0x5023: 'crystal_r',    // crystal_n 不存在，复用 crystal_r
  0x5030: 'tower-b',      // CASTLE_TOWER_B

  0x5100: 'soldier_a',    // CASTLE_SOLDER_A
  0x5110: 'soldier_b',    // CASTLE_SOLDER_B
  0x5120: 'soldier_c',    // CASTLE_SOLDER_C

  0x5130: 'watermelon',
};
