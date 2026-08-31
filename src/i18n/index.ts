import zh from '../locales/zh.json';
import en from '../locales/en.json';

const locales: Record<string, typeof zh> = { zh, en };
let locale = localStorage.getItem('locale')
  ?? (navigator.language.startsWith('zh') ? 'zh' : 'en');

export function t(key: string, params?: Record<string, string | number>): string {
  const parts = key.split('.');
  let val: unknown = locales[locale] ?? locales['zh'];
  for (const p of parts) {
    if (val && typeof val === 'object') val = (val as Record<string, unknown>)[p];
    else { val = undefined; break; }
  }
  let msg = typeof val === 'string' ? val : key;
  if (params) {
    for (const [k, v] of Object.entries(params)) msg = msg.replace(`{${k}}`, String(v));
  }
  return msg;
}

export function setLocale(loc: string): void {
  locale = loc;
  localStorage.setItem('locale', loc);
}

export function getLocale(): string { return locale; }
