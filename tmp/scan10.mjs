import {readFileSync} from 'node:fs';
const g=JSON.parse(readFileSync('src/game/data/skill-motion-src.generated.json','utf8'));
for(const j of [1,4,8]){
  console.log('== job'+j);
  for(const r of g.rows.filter(r=>r.job===j)) console.log('  ',r.icon.padEnd(28),'motion='+String(r.motionSrc).padEnd(6),'sound='+String(r.soundSrc).padEnd(6),'weaponSfx='+r.weaponSfx, 'lines', JSON.stringify(r.motionLines), JSON.stringify(r.soundLines));
}
console.log('== all attack:', g.rows.filter(r=>r.motionSrc==='attack').map(r=>r.classDir+':'+r.name).join(', '));
console.log('== all mixed :', g.rows.filter(r=>r.motionSrc==='mixed').map(r=>r.classDir+':'+r.name).join(', '));
console.log('== all weapon:', g.rows.filter(r=>r.soundSrc==='weapon').map(r=>r.classDir+':'+r.name+'('+r.icon+')').join(', '));
