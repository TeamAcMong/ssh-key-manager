import vi from './vi.json';
import en from './en.json';
import type { Language } from '../../core/types';

export type MessageKey = keyof typeof vi;

const dictionaries: Record<Language, Partial<Record<MessageKey, string>>> = { vi, en };
let current: Language = 'vi';

export function setLanguage(lang: Language): void {
  current = lang;
}

/**
 * Looks up a UI string. en.json is intentionally incomplete: missing English entries use the
 * Vietnamese text, which is the reference language.
 */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const text = dictionaries[current][key] ?? vi[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
