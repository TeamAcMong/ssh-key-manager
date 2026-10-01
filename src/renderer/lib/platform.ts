import { api } from './api';

export function isMac(): boolean {
  return api().platform === 'darwin';
}

/** Primary shortcut modifier: Cmd on macOS, Ctrl elsewhere. */
export function isModKey(e: KeyboardEvent): boolean {
  return isMac() ? e.metaKey : e.ctrlKey;
}

/** Label of the primary modifier for UI text ("⌘" / "Ctrl"). */
export function modLabel(): string {
  return isMac() ? '⌘' : 'Ctrl';
}
