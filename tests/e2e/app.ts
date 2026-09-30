import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export const REPO = path.resolve(__dirname, '../..');
// SKM_E2E_EXE runs the suite against a packaged exe; its screenshots go to .tmp-test, not docs/.
export const PACKAGED_EXE = process.env.SKM_E2E_EXE;
export const SHOTS = PACKAGED_EXE ? path.join(REPO, '.tmp-test', 'packaged-shots') : path.join(REPO, 'docs', 'screenshots');

export interface Launched {
  app: ElectronApplication;
  page: Page;
  root: string;
  sshDir: string;
  appData: string;
  close: () => Promise<void>;
}

/** Launches the built app against a fresh sandbox; never the real ~/.ssh or %APPDATA%. */
export async function launch(theme: 'light' | 'dark', opts: { extraArgs?: string[]; window?: { width: number; height: number } } = {}): Promise<Launched> {
  const root = path.join(REPO, '.tmp-test', `e2e-${randomBytes(4).toString('hex')}`);
  const sshDir = path.join(root, 'ssh');
  const appData = path.join(root, 'appdata');
  if (sshDir.toLowerCase().startsWith(path.join(os.homedir(), '.ssh').toLowerCase())) throw new Error('refusing real ~/.ssh');
  await fs.mkdir(sshDir, { recursive: true });
  await fs.mkdir(appData, { recursive: true });
  await fs.writeFile(
    path.join(appData, 'settings.json'),
    JSON.stringify({ schemaVersion: 1, sshDir, binDir: null, theme, language: 'vi', window: { x: 60, y: 40, width: opts.window?.width ?? 1200, height: opts.window?.height ?? 760, maximized: false } })
  );
  // VS Code (itself Electron) exports ELECTRON_RUN_AS_NODE to child shells; it would start Electron as plain Node.
  const env = { ...process.env, SKM_APPDATA_DIR: appData, SKM_SSH_DIR: sshDir } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = PACKAGED_EXE
    ? await electron.launch({ executablePath: PACKAGED_EXE, args: [...(opts.extraArgs ?? [])], env })
    : await electron.launch({ args: [...(opts.extraArgs ?? []), REPO], env });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="status-bar"]');
  return {
    app,
    page,
    root,
    sshDir,
    appData,
    close: async () => {
      await app.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300); // let Fluent transitions settle
  await fs.mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
