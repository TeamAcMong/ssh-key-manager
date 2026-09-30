import path from 'node:path';
import { BrowserWindow, nativeTheme, screen, type Rectangle } from 'electron';
import type { WindowBounds } from '../core/types';

export const MIN_WIDTH = 1000;
export const MIN_HEIGHT = 650;

/** Hardened web preferences; asserted by the e2e security test. */
export function secureWebPreferences(preload: string): Electron.WebPreferences {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    experimentalFeatures: false,
    spellcheck: false,
    navigateOnDragDrop: false
  };
}

function visibleOnSomeDisplay(b: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: w }) => b.x < w.x + w.width - 100 && b.x + b.width > w.x + 100 && b.y >= w.y - 10 && b.y < w.y + w.height - 100);
}

export function createMainWindow(saved: WindowBounds | null, onBoundsChanged: (b: WindowBounds) => void): BrowserWindow {
  const restore = saved && visibleOnSomeDisplay(saved) ? saved : null;
  const win = new BrowserWindow({
    width: Math.max(restore?.width ?? 1200, MIN_WIDTH),
    height: Math.max(restore?.height ?? 760, MIN_HEIGHT),
    ...(restore ? { x: restore.x, y: restore.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: 'SSH Key Manager',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#fafafa',
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(path.join(__dirname, '../preload/index.js'))
  });
  if (restore?.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  let timer: NodeJS.Timeout | undefined;
  const save = (): void => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const b = win.getNormalBounds();
    onBoundsChanged({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() });
  };
  const debounced = (): void => {
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  win.on('resize', debounced);
  win.on('move', debounced);
  win.on('close', () => {
    clearTimeout(timer);
    save();
  });
  return win;
}
