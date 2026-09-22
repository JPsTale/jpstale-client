// 拳套入库后的客户端自检
import { itemDefById, itemDefByCode } from '../src/game/data/itemDefs.js';
import { getWeaponTypeFromIdCode, getHandTypeFromIdCode, getSheatheSlot, getWeaponSemantics } from '../src/char/weapon-type.js';

const ID = 1227, CODE = 0x010b0100;
const d = itemDefById(ID);
console.log('itemDefById(' + ID + ') =', d ? `${d.name} / icon=${d.icon} / folder=${d.folder} / class=${d.class}` : '✗ 未找到');
console.log('itemDefByCode(0x010b0100) =', itemDefByCode(CODE)?.name ?? '✗ 未找到');
console.log('type =', getWeaponTypeFromIdCode(CODE), '| hand =', getHandTypeFromIdCode(CODE), '| 收械 =', JSON.stringify(getSheatheSlot(CODE)));
const sem = getWeaponSemantics(CODE);
console.log('语义表命中 =', sem ? `${sem.type}/${sem.hand}/${sem.attackClass}/primary=${sem.primaryClass}` : '✗ 无');
// 全部 34 条的解析
let ok = 0, bad: string[] = [];
for (let i = 0; i < 34; i++) {
  const id = 1227 + i;
  const def = itemDefById(id);
  if (def && getWeaponTypeFromIdCode(def.code) === 'KNUCKLE' && getHandTypeFromIdCode(def.code) === '1H') ok++;
  else bad.push(String(id));
}
console.log(`34 条拳套：id→def 可解析且 type=KNUCKLE/hand=1H 的有 ${ok} 条`, bad.length ? '✗ 异常: ' + bad.join(',') : '✓');
