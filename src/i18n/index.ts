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

/** 翻译不到（t 回退为 key 自身）时回退到 fallback 原文，避免显示 "error.xxx" 样式的 key。 */
export function tOr(key: string, fallback: string, params?: Record<string, string | number>): string {
  const msg = t(key, params);
  return msg === key && fallback !== undefined ? fallback : msg;
}

export function setLocale(loc: string): void {
  locale = loc;
  localStorage.setItem('locale', loc);
}

export function getLocale(): string { return locale; }
