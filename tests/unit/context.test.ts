import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createContext, ensureSshDir } from '../../src/core/context';
import { createPlatform } from '../../src/core/platform';
import { runProcess } from '../../src/core/process/ProcessRunner';
import { KeyService } from '../../src/core/keys/KeyService';
import { REPO, TMP_ROOT } from './helpers';

const root = path.join(TMP_ROOT, `ctx-${randomBytes(4).toString('hex')}`);
afterAll(() => fs.rm(root, { recursive: true, force: true }));

describe('SSH dir is created when missing', () => {
  it('creates a missing dir including parents, and is a no-op when it exists', async () => {
    const dir = path.join(root, 'a', 'b', '.ssh');
    await ensureSshDir(dir);
    expect((await fs.stat(dir)).isDirectory()).toBe(true);
    await fs.writeFile(path.join(dir, 'marker'), 'x');
    await ensureSshDir(dir);
    expect(await fs.readFile(path.join(dir, 'marker'), 'utf8')).toBe('x');
  });

  it('refuses when the path is a file (never replaces it)', async () => {
    const file = path.join(root, 'not-a-dir');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(file, 'keep me');
    await expect(ensureSshDir(file)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await fs.readFile(file, 'utf8')).toBe('keep me');
  });

  it('createContext on a missing dir lets the key list start empty instead of failing', async () => {
    process.env.SKM_APPDATA_DIR = path.join(root, 'appdata');
    const dir = path.join(root, 'fresh', '.ssh');
    const ctx = await createContext({
      sshDir: dir,
      binDir: null,
      run: runProcess,
      platform: createPlatform(runProcess),
      askpass: { helperPath: path.join(REPO, 'resources', 'askpass', 'askpass.cmd'), nodeExe: process.execPath, nodeEnv: {} }
    });
    expect(await new KeyService(ctx).list()).toEqual([]);
  });
});
