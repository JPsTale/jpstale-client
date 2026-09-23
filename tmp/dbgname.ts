import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync('src/game/data/source/skill-mapping.json', 'utf8')) as {
  mapping: Array<{ index: number; class: string | null; our_name: string | null; eu_name: string | null }>;
};
for (const m of j.mapping) {
  if (/^\d+$/.test(process.argv[2] ?? '')) {
    if ([...process.argv.slice(2)].map(Number).includes(m.index)) console.log(m.index + ' ' + String(m.class) + ' our=' + m.our_name + ' eu=' + m.eu_name);
  } else {
    console.log(String(m.index).padStart(4) + ' ' + String(m.class).padEnd(14) + ' our=' + String(m.our_name).padEnd(22) + ' eu=' + m.eu_name);
  }
}
