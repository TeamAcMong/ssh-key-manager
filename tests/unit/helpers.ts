import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { createContext, type CoreContext } from '../../src/core/context';
import { createPlatform } from '../../src/core/platform';
import { runProcess, type ProcessRunner, type RunOptions } from '../../src/core/process/ProcessRunner';

export const REPO = path.resolve(__dirname, '../..');
export const TMP_ROOT = path.join(REPO, '.tmp-test');

export interface Sandbox {
  root: string;
  sshDir: string;
  appData: string;
  ctx: CoreContext;
  /** Every process invocation made through ctx.run, for command-line assertions. */
  calls: { bin: string; args: string[]; env?: Record<string, string> }[];
  cleanup: () => Promise<void>;
}

export async function createSandbox(): Promise<Sandbox> {
  const root = path.join(TMP_ROOT, randomBytes(6).toString('hex'));
  const sshDir = path.join(root, 'ssh');
  const appData = path.join(root, 'appdata');
  await fs.mkdir(sshDir, { recursive: true });
  process.env.SKM_APPDATA_DIR = appData;

  const calls: Sandbox['calls'] = [];
  const recordingRun: ProcessRunner = (bin: string, args: readonly string[], opts?: RunOptions) => {
    calls.push({ bin, args: [...args], env: opts?.env });
    return runProcess(bin, args, opts);
  };
  const platform = createPlatform(recordingRun);
  const ctx = await createContext({
    sshDir,
    binDir: null,
    run: recordingRun,
    platform,
    askpass: { helperPath: path.join(REPO, 'resources', 'askpass', platform.info.askpassHelper), nodeExe: process.execPath, nodeEnv: {} }
  });
  if (path.resolve(ctx.sshDir).toLowerCase() === path.join(os.homedir(), '.ssh').toLowerCase()) {
    throw new Error('Refusing to run tests against the real ~/.ssh');
  }
  return { root, sshDir, appData, ctx, calls, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

/** Makes a private key readable by everyone, which OpenSSH refuses: Everyone ACE on Windows, chmod 644 on macOS. */
export async function makeWorldReadable(file: string): Promise<void> {
  if (process.platform === 'win32') {
    const icacls = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe');
    const r = await runProcess(icacls, [file, '/grant', '*S-1-1-0:(R)']); // Everyone, by SID (locale-independent)
    if (r.code !== 0) throw new Error(`icacls failed: ${r.stderr}`);
  } else {
    await fs.chmod(file, 0o644);
  }
}
