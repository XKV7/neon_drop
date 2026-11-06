// README용 영웅/스킬/증강 표 생성 (데이터 파일에서 직접 추출)
import { HEROES, ROLE_NAMES, AUGMENTS, TIER_NAMES, HERO_BY_ID } from '../shared/src/index';
const out: string[] = [];
const keys = ['좌클릭', '우클릭', 'Q', 'E', 'R'];
for (const h of HEROES) {
  out.push(`#### ${h.name} — ${h.title} (${ROLE_NAMES[h.role]}, 난이도 ${'★'.repeat(h.difficulty)}${'☆'.repeat(3 - h.difficulty)})`);
  out.push(`체력 ${h.hp} · 이동 속도 ${h.speed}m/s · 궁극기 충전 ${h.ultReq} 피해`);
  out.push('');
  out.push('| 키 | 스킬 | 쿨타임 | 설명 |');
  out.push('|---|---|---:|---|');
  [h.basic, ...h.skills, h.ult].forEach((s, i) => out.push(`| ${keys[i]} | ${s.name}${i === 3 ? ' (이동기)' : i === 4 ? ' (궁극기)' : ''} | ${i === 4 ? '충전형' : s.cd + '초'} | ${s.desc} |`));
  const aug = AUGMENTS.filter(a => a.hero === h.id);
  out.push('');
  out.push(`전용 증강: ${aug.map(a => `**${a.name}**(${TIER_NAMES[a.tier]}) ${a.desc}`).join(' · ')}`);
  out.push('');
}
out.push('#### 공용 증강');
out.push('');
out.push('| 등급 | 증강 | 효과 |');
out.push('|---|---|---|');
for (const a of AUGMENTS.filter(a => !a.hero)) out.push(`| ${TIER_NAMES[a.tier]} | ${a.icon} ${a.name} | ${a.desc} |`);
void HERO_BY_ID;
const md = out.join('\n');
if (process.argv.includes('--write')) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const readme = new URL('../README.md', import.meta.url);
  const src = readFileSync(readme, 'utf8');
  writeFileSync(readme, src.replace(/<!-- HEROES:START -->[\s\S]*<!-- HEROES:END -->/, `<!-- HEROES:START -->\n${md}\n<!-- HEROES:END -->`));
  console.log('README.md 영웅/증강 표를 갱신했습니다.');
} else console.log(md);
