import {readFileSync} from 'node:fs';
const g=JSON.parse(readFileSync('src/game/data/skill-fx.json','utf8'));
for(const job of [4,8]){ console.log('=== job'+job); for(const r of g.rows.filter(r=>r.job===job)) console.log(' ', r.icon.padEnd(28), 'anim='+r.animIndex, 'cast='+JSON.stringify(r.cast.sfx), 'ev='+JSON.stringify(r.event.sfx), r.confidence); }
