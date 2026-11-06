import { AUGMENT_BY_ID, HEROES, HERO_BY_ID, type SkillDef, type HeroId, TIER_NAMES } from '@neon/shared';

export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function skillIcon(def: SkillDef, slot: number): string {
  if (slot === 4) return '✦';
  const a = def.actions[0];
  switch (a.t) {
    case 'melee': return '⚔';
    case 'projectile': return a.count && a.count > 1 ? '⋔' : '➶';
    case 'dash': return a.wire ? '⟿' : a.backward ? '⇐' : '»';
    case 'blink': return '✧';
    case 'aoe': return a.cone ? '◭' : '◎';
    case 'zone': return '◌';
    case 'beam': return '═';
    case 'deploy': return a.kind === 'trap' ? '⌗' : '⌖';
    case 'buff': return '◐';
    default: return '●';
  }
}

export function heroGlyph(id: HeroId): string {
  return { hammerdog: '拳', redline: '鋸', mirage: '影', silk: '絲', rail: '銃', hive: '蜂', glitch: '電', horizon: '重' }[id];
}

export function augTip(id: string): string {
  const a = AUGMENT_BY_ID[id];
  if (!a) return '';
  return `${a.name} (${TIER_NAMES[a.tier]}${a.hero ? ' · ' + HERO_BY_ID[a.hero].name + ' 전용' : ''})\n${a.desc}`;
}

export function toast(text: string) {
  const t = el('div', 'toast', esc(text));
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2700);
}

export function stars(n: number) { return '★'.repeat(n) + '☆'.repeat(3 - n); }
export { HEROES };
