import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { HostKeyService, appendKnownHosts, parseKnownHosts, parseSshG } from '../../src/core/test/HostKeys';
import { runProcess, type ProcessRunner } from '../../src/core/process/ProcessRunner';
import { ConnectionTester } from '../../src/core/test/ConnectionTester';
import { TMP_ROOT, createSandbox } from './helpers';

// GitHub's real ED25519 host key (fingerprint published as SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU).
const GITHUB_ED25519 = 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
const fakeBlob = (): string => Buffer.concat([Buffer.from('\0\0\0\x0bssh-ed25519\0\0\0\x20', 'binary'), randomBytes(32)]).toString('base64');

describe('host key parsing', () => {
  it('reads HostName/Port from ssh -G', () => {
    expect(parseSshG('user git\r\nhostname ssh.github.com\r\nport 443\r\n')).toEqual({ hostName: 'ssh.github.com', port: 443 });
    expect(() => parseSshG('user git\n')).toThrow();
  });

  it('computes OpenSSH fingerprints and keeps known_hosts lines verbatim', () => {
    const [k] = parseKnownHosts(`# comment\n[ssh.github.com]:443 ssh-ed25519 ${GITHUB_ED25519}\n`);
    expect(k).toEqual({ type: 'ssh-ed25519', fingerprint: 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU', line: `[ssh.github.com]:443 ssh-ed25519 ${GITHUB_ED25519}` });
    expect(parseKnownHosts(`@revoked host ssh-ed25519 ${GITHUB_ED25519}`)).toEqual([]);
  });

  it('appends only new lines and keeps CRLF files CRLF', () => {
    expect(appendKnownHosts('', ['a k1'])).toEqual({ content: 'a k1\n', added: 1 });
    expect(appendKnownHosts('a k1\r\nb k2', ['a k1', 'c k3'])).toEqual({ content: 'a k1\r\nb k2\r\nc k3\r\n', added: 1 });
    expect(appendKnownHosts('a k1\n', ['a k1']).added).toBe(0);
  });
});

describe('HostKeyService with a fake server', () => {
  const sandboxes: { cleanup: () => Promise<void> }[] = [];
  afterAll(async () => Promise.all(sandboxes.map((s) => s.cleanup())));

  /**
   * `ssh -G` runs for real (offline config resolution). The probing ssh call is faked: it writes the next
   * server key into the throwaway UserKnownHostsFile, as ssh does with StrictHostKeyChecking=accept-new.
   */
  async function setup(config: string, serverLines: string[]) {
    const sb = await createSandbox();
    sandboxes.push(sb);
    await fs.writeFile(path.join(sb.sshDir, 'config'), config);
    const probes: string[][] = [];
    const run: ProcessRunner = async (bin, args, opts) => {
      if (!args.includes('StrictHostKeyChecking=accept-new')) return runProcess(bin, args, opts);
      probes.push([...args]);
      const opt = args.find((a) => a.startsWith('UserKnownHostsFile='));
      await fs.writeFile((opt as string).slice('UserKnownHostsFile='.length).replace(/"/g, ''), (serverLines.shift() ?? '') + '\n');
      return { code: 255, stdout: '', stderr: 'Permission denied (publickey).', timedOut: false, cancelled: false };
    };
    const svc = new HostKeyService({ sshDir: sb.sshDir, bin: sb.ctx.bin, run });
    return { svc, sshDir: sb.sshDir, probes };
  }

  it('never offers a key or password while probing, and never touches the real known_hosts', async () => {
    const { svc, sshDir, probes } = await setup('Host github.com\n  HostName ssh.github.com\n  Port 443\n', [`[ssh.github.com]:443 ssh-ed25519 ${GITHUB_ED25519}`]);
    const r = await svc.scan('github.com');
    expect(probes[0]).toEqual(expect.arrayContaining(['PreferredAuthentications=none', 'PubkeyAuthentication=no', 'BatchMode=yes', 'GlobalKnownHostsFile=none', 'HashKnownHosts=no']));
    expect(probes[0]?.slice(-2)).toEqual(['--', 'github.com']);
    expect(r).toEqual({ hostName: 'ssh.github.com', port: 443, provider: 'GitHub', keys: [{ type: 'ssh-ed25519', fingerprint: 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU', published: true }] });
    await expect(fs.stat(path.join(sshDir, 'known_hosts'))).rejects.toThrow();
  });

  it('trust appends the approved key to known_hosts with a backup of the old file', async () => {
    const line = `hf.co ssh-ed25519 ${fakeBlob()}`;
    const { svc, sshDir } = await setup('Host hf.co\n  User git\n', [line, line]);
    await fs.writeFile(path.join(sshDir, 'known_hosts'), 'old.example ssh-ed25519 AAAA\n');
    const scan = await svc.scan('hf.co');
    expect(scan).toMatchObject({ provider: null, keys: [{ published: null }] });
    const r = await svc.trust('hf.co', scan.keys.map((k) => k.fingerprint));
    expect(r.added).toBe(1);
    expect(await fs.readFile(path.join(sshDir, 'known_hosts'), 'utf8')).toBe(`old.example ssh-ed25519 AAAA\n${line}\n`);
    expect(await fs.readFile(r.backupPath as string, 'utf8')).toBe('old.example ssh-ed25519 AAAA\n');
  });

  it('refuses when the key changed between viewing and trusting', async () => {
    const { svc, sshDir } = await setup('Host box\n  HostName 10.0.0.5\n', [`10.0.0.5 ssh-ed25519 ${fakeBlob()}`, `10.0.0.5 ssh-ed25519 ${fakeBlob()}`]);
    const scan = await svc.scan('box');
    await expect(svc.trust('box', scan.keys.map((k) => k.fingerprint))).rejects.toMatchObject({ code: 'HOST_KEY_CHANGED' });
    await expect(fs.stat(path.join(sshDir, 'known_hosts'))).rejects.toThrow();
  });

  it('refuses a GitHub host whose key differs from the published fingerprints (possible MITM)', async () => {
    const forged = `github.com ssh-ed25519 ${fakeBlob()}`;
    const { svc, sshDir } = await setup('Host github.com\n  HostName github.com\n', [forged, forged]);
    const scan = await svc.scan('github.com');
    expect(scan.keys[0]?.published).toBe(false);
    await expect(svc.trust('github.com', scan.keys.map((k) => k.fingerprint))).rejects.toMatchObject({ code: 'HOST_KEY_CHANGED' });
    await expect(fs.stat(path.join(sshDir, 'known_hosts'))).rejects.toThrow();
  });

  it('reports the ssh error when no key could be fetched', async () => {
    const { svc } = await setup('Host box\n  HostName 10.0.0.5\n', ['']);
    await expect(svc.scan('box')).rejects.toMatchObject({ code: 'PROCESS_FAILED' });
  });
});

describe('Hugging Face greeting', () => {
  const fakeSsh = (stdout: string): ProcessRunner => async () => ({ code: 0, stdout, stderr: '', timedOut: false, cancelled: false });
  const tester = (stdout: string) => new ConnectionTester({ sshDir: path.join(TMP_ROOT, 'none'), bin: { ssh: 'ssh', keygen: 'k', add: 'a' }, run: fakeSsh(stdout) });

  it('counts a named greeting as authenticated', async () => {
    expect(await tester('Hi hcmyxconan12, welcome to Hugging Face.\n').run({ host: 'hf.co', timeoutSec: 5 })).toMatchObject({ success: true });
  });

  it('treats the anonymous greeting (exit 0) as "key not accepted"', async () => {
    const r = await tester('Hi anonymous, welcome to Hugging Face.\n').run({ host: 'hf.co', timeoutSec: 5 });
    expect(r).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED_PUBLICKEY' } });
  });
});
