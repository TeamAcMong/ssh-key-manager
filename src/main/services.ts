import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { EnvInfo, Settings } from '../core/types';
import { createPlatform, type Platform } from '../core/platform';
import { runProcess } from '../core/process/ProcessRunner';
import { createContext, opensshVersion, type CoreContext } from '../core/context';
import { SettingsStore, isSandboxDir } from '../core/store/SettingsStore';
import { KeyService } from '../core/keys/KeyService';
import { AgentKeys } from '../core/agent/AgentKeys';
import { ConfigStore } from '../core/config/ConfigStore';
import { ConnectionTester } from '../core/test/ConnectionTester';
import { SkmError } from '../core/errors/SkmError';
import { exists } from '../core/store/fsutil';

/** Core services bound to the current settings; rebuilt whenever the SSH dir or bin dir changes. */
export class AppServices {
  readonly platform: Platform = createPlatform(runProcess);
  readonly settingsStore = new SettingsStore(this.platform.paths);
  settings!: Settings;
  ctx!: CoreContext;
  keys!: KeyService;
  agent!: AgentKeys;
  config!: ConfigStore;
  tester!: ConnectionTester;
  private version: string | null = null;

  /** `initialSshDir` seeds the SSH dir only on first run (no settings file yet), e.g. the dev sandbox. */
  async init(initialSshDir?: string): Promise<void> {
    const firstRun = !(await exists(this.settingsStore.file));
    this.settings = await this.settingsStore.load();
    if (firstRun && initialSshDir) {
      this.settings = await this.settingsStore.save({ sshDir: path.resolve(initialSshDir) });
    }
    // Dev / e2e: force the SSH dir from the environment so the real ~/.ssh is never touched.
    const forced = process.env.SKM_SSH_DIR;
    if (forced && path.resolve(forced) !== this.settings.sshDir) {
      this.settings = await this.settingsStore.save({ sshDir: path.resolve(forced) });
    }
    await this.rebuild();
  }

  async rebuild(): Promise<void> {
    this.ctx = await createContext({
      sshDir: this.settings.sshDir,
      binDir: this.settings.binDir,
      run: runProcess,
      platform: this.platform,
      ensureSshDir: isSandboxDir(this.settings.sshDir, this.platform.paths.defaultSshDir()),
      askpass: {
        // Packaged: electron-builder copies the helper next to app.asar (a .cmd inside an asar cannot run).
        helperPath: app.isPackaged
          ? path.join(process.resourcesPath, 'askpass', 'askpass.cmd')
          : path.join(app.getAppPath(), 'resources', 'askpass', 'askpass.cmd'),
        nodeExe: process.execPath,
        nodeEnv: { ELECTRON_RUN_AS_NODE: '1' }
      }
    });
    this.keys = new KeyService(this.ctx);
    this.agent = new AgentKeys(this.ctx);
    this.config = new ConfigStore(this.ctx);
    this.tester = new ConnectionTester(this.ctx);
    this.version = await opensshVersion(this.ctx);
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    if (patch.sshDir !== undefined) {
      const st = await fs.stat(patch.sshDir).catch(() => null);
      if (st && !st.isDirectory()) throw new SkmError('INVALID_INPUT', 'Đường dẫn thư mục SSH đang trỏ tới một file, không phải thư mục.');
    }
    this.settings = await this.settingsStore.save(patch);
    if (patch.sshDir !== undefined || patch.binDir !== undefined) await this.rebuild();
    return this.settings;
  }

  envInfo(): EnvInfo & { defaultComment: string } {
    const defaultSshDir = this.platform.paths.defaultSshDir();
    return {
      opensshVersion: this.version,
      sshDir: this.ctx.sshDir,
      defaultSshDir,
      isSandbox: isSandboxDir(this.ctx.sshDir, defaultSshDir),
      platform: process.platform,
      devMode: !app.isPackaged,
      defaultComment: `${os.userInfo().username}@${process.env.COMPUTERNAME ?? os.hostname()}`
    };
  }
}
