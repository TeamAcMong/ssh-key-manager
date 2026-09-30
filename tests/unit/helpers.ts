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
  const ctx = await createContext({
    sshDir,
    binDir: null,
    run: recordingRun,
    platform: createPlatform(recordingRun),
    askpass: { helperPath: path.join(REPO, 'resources', 'askpass', 'askpass.cmd'), nodeExe: process.execPath, nodeEnv: {} }
  });
  if (path.resolve(ctx.sshDir).toLowerCase() === path.join(os.homedir(), '.ssh').toLowerCase()) {
    throw new Error('Refusing to run tests against the real ~/.ssh');
  }
  return { root, sshDir, appData, ctx, calls, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}
