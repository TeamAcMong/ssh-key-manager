// macOS platform pieces, tested with fakes so they run on any OS (the real Mac run is not covered here).
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPlatform } from '../../src/core/platform';
import { MAX_SOCKET_PATH, MacPaths } from '../../src/core/platform/mac/MacPaths';
import { evaluateMode } from '../../src/core/platform/mac/PosixPermissions';
import { LAUNCHD_ENABLE_COMMAND, MacAgentService, canConnect } from '../../src/core/platform/mac/MacAgentService';
import { AgentKeys } from '../../src/core/agent/AgentKeys';
import type { ProcessRunner } from '../../src/core/process/ProcessRunner';
import type { CoreContext } from '../../src/core/context';

const noRun: ProcessRunner = async () => ({ code: 0, stdout: '', stderr: '', timedOut: false, cancelled: false });

describe('createPlatform', () => {
  it('returns the macOS implementation on darwin', () => {
    const p = createPlatform(noRun, 'darwin');
    expect(p.info).toMatchObject({ os: 'macos', askpassHelper: 'askpass.sh', agentKeychain: true });
    expect(p.paths.exe('/usr/bin', 'ssh-keygen')).toBe(path.join('/usr/bin', 'ssh-keygen'));
  });

  it('keeps Windows unchanged and rejects other systems', () => {
    expect(createPlatform(noRun, 'win32').info).toMatchObject({ os: 'windows', askpassHelper: 'askpass.cmd', agentKeychain: false });
    expect(() => createPlatform(noRun, 'linux')).toThrow(/linux/);
  });
});

describe('POSIX permission check (the rule OpenSSH applies)', () => {
  it('accepts 600 and 400 owned by the user', () => {
    expect(evaluateMode('k', 0o600, 501, 501)).toMatchObject({ safe: true, offending: [] });
    expect(evaluateMode('k', 0o400, 501, 501).safe).toBe(true);
  });

  it('flags any group/other bit and a foreign owner', () => {
    expect(evaluateMode('k', 0o644, 501, 501)).toMatchObject({ safe: false, offending: ['group', 'others'] });
    expect(evaluateMode('k', 0o640, 501, 501).offending).toEqual(['group']);
    expect(evaluateMode('k', 0o600, 0, 501)).toMatchObject({ safe: false, offending: ['owner (uid 0)'] });
    expect(evaluateMode('k', 0o644, 501, 501).entries.map((e) => `${e.principal}:${e.rights}`)).toEqual(['owner (bạn):rw-', 'group:r--', 'others:r--']);
  });
});

describe('MacPaths', () => {
  it('builds a short socket path in the per-user temp dir', () => {
    const tmp = '/var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T';
    const p = new MacPaths(() => tmp).pipePath(`skm-askpass-${randomBytes(16).toString('hex')}`);
    expect(path.dirname(p)).toBe(path.normalize(tmp));
    expect(path.basename(p)).toMatch(/^skm-[0-9a-f]{16}\.sock$/);
    expect(Buffer.byteLength(p)).toBeLessThanOrEqual(MAX_SOCKET_PATH);
  });

  it('refuses a temp dir too long for a unix socket instead of failing later in listen()', () => {
    expect(() => new MacPaths(() => '/' + 'x'.repeat(100)).pipePath('id')).toThrow(/TMPDIR/);
  });

  it('stores settings under Application Support unless overridden', () => {
    const saved = process.env.SKM_APPDATA_DIR;
    delete process.env.SKM_APPDATA_DIR;
    try {
      expect(new MacPaths().appDataDir()).toBe(path.join(os.homedir(), 'Library', 'Application Support', 'ssh-key-manager'));
    } finally {
      if (saved !== undefined) process.env.SKM_APPDATA_DIR = saved;
    }
  });
});

describe('MacAgentService', () => {
  it('is running when the launchd socket accepts connections', async () => {
    const svc = new MacAgentService(() => ({ SSH_AUTH_SOCK: '/tmp/x/Listeners' }), async () => true);
    expect(await svc.status()).toEqual({ state: 'running', startType: 'launchd' });
    expect(await svc.start()).toMatchObject({ started: true });
  });

  it('explains the Terminal fix (no admin) when SSH_AUTH_SOCK is missing or dead', async () => {
    const missing = await new MacAgentService(() => ({}), async () => true).start();
    expect(missing).toMatchObject({ started: false, needsAdmin: false, adminCommand: LAUNCHD_ENABLE_COMMAND });
    expect(missing.messageVi).toContain('SSH_AUTH_SOCK');
    const dead = new MacAgentService(() => ({ SSH_AUTH_SOCK: '/tmp/x' }), async () => false);
    expect((await dead.status()).state).toBe('stopped');
    expect((await dead.start()).messageVi).toContain('launchd');
    await expect(dead.launchElevatedEnable()).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('canConnect detects a live socket and a missing one', async () => {
    const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\skm-test-${randomBytes(6).toString('hex')}` : path.join(os.tmpdir(), `skm-test-${randomBytes(6).toString('hex')}.sock`);
    const server = net.createServer((s) => s.end());
    await new Promise<void>((resolve) => server.listen(endpoint, resolve));
    try {
      expect(await canConnect(endpoint)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(await canConnect(endpoint, 500)).toBe(false);
  });
});

describe('ssh-add with the macOS Keychain', () => {
  function fakeCtx(agentKeychain: boolean) {
    const calls: string[][] = [];
    const ctx = {
      bin: { ssh: 'ssh', keygen: 'ssh-keygen', add: 'ssh-add' },
      run: (async (_bin, args) => {
        calls.push([...args]);
        return { code: 0, stdout: '', stderr: '', timedOut: false, cancelled: false };
      }) as ProcessRunner,
      askpass: { withAnswers: (_a: unknown, fn: (env: Record<string, string>) => Promise<unknown>) => fn({}) },
      platform: { info: { agentKeychain } }
    } as unknown as Pick<CoreContext, 'bin' | 'run' | 'askpass' | 'platform'>;
    return { agent: new AgentKeys(ctx), calls };
  }

  it('passes --apple-use-keychain only when asked', async () => {
    const { agent, calls } = fakeCtx(true);
    await agent.add('/Users/me/.ssh/id_ed25519', 'secret-pass', { useKeychain: true });
    await agent.add('/Users/me/.ssh/id_ed25519', 'secret-pass');
    expect(calls).toEqual([['--apple-use-keychain', '/Users/me/.ssh/id_ed25519'], ['/Users/me/.ssh/id_ed25519']]);
  });

  it('refuses the Keychain option where ssh-add does not support it (Windows)', async () => {
    const { agent, calls } = fakeCtx(false);
    await expect(agent.add('C:/k', 'secret-pass', { useKeychain: true })).rejects.toThrow(/Keychain/);
    expect(calls).toEqual([]);
  });
});
