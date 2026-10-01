// Runs the real ssh-keygen / icacls against a throwaway directory under .tmp-test/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSandbox, type Sandbox } from './helpers';
import { KeyService } from '../../src/core/keys/KeyService';
import { ConfigStore, identityFileRef } from '../../src/core/config/ConfigStore';
import { ConnectionTester } from '../../src/core/test/ConnectionTester';
import { AgentKeys } from '../../src/core/agent/AgentKeys';
import { runProcess } from '../../src/core/process/ProcessRunner';

const ICACLS = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe');
const PASS = 'correct horse battery 42';
const PASS2 = 'another-passphrase-99';

let sb: Sandbox;
let keys: KeyService;

beforeAll(async () => {
  sb = await createSandbox();
  keys = new KeyService(sb.ctx);
});
afterAll(async () => {
  await sb.cleanup();
});

function assertNoSecretOnCommandLine(secret: string): void {
  for (const c of sb.calls) {
    for (const a of c.args) expect(a.includes(secret), `argument of ${path.basename(c.bin)} leaked the passphrase`).toBe(false);
    for (const v of Object.values(c.env ?? {})) expect(v.includes(secret), 'env leaked the passphrase').toBe(false);
  }
}

describe('generate + inventory', () => {
  it('generates an Ed25519 key without passphrase and locks its ACL', async () => {
    const d = await keys.generate({ type: 'ed25519', comment: 'test@sandbox', fileName: 'id_ed25519_plain', passphrase: '' });
    expect(d).toMatchObject({ type: 'ed25519', bits: 256, comment: 'test@sandbox', hasPassphrase: false, aclSafe: true, hasPublic: true });
    expect(d.fingerprint).toMatch(/^SHA256:/);
    expect(d.randomart).toContain('[ED25519 256]');
    expect(d.publicKey).toMatch(/^ssh-ed25519 AAAA\S+ test@sandbox$/);
    const acl = await sb.ctx.platform.permissions.check(path.join(sb.sshDir, 'id_ed25519_plain'));
    expect(acl.entries).toHaveLength(1);
  });

  it('generates a passphrase-protected key through askpass, never via argv/env', async () => {
    sb.calls.length = 0;
    const d = await keys.generate({ type: 'ed25519', comment: 'enc', fileName: 'id_enc', passphrase: PASS });
    expect(d.hasPassphrase).toBe(true);
    const gen = sb.calls.find((c) => c.args.includes('-t'));
    expect(gen?.args).not.toContain('-N');
    assertNoSecretOnCommandLine(PASS);
  });

  it('generates RSA 3072 and ECDSA 384', async () => {
    const rsa = await keys.generate({ type: 'rsa', bits: 3072, comment: 'r', fileName: 'id_rsa_t', passphrase: '' });
    expect(rsa).toMatchObject({ type: 'rsa', bits: 3072 });
    const ec = await keys.generate({ type: 'ecdsa', bits: 384, comment: 'e', fileName: 'id_ecdsa_t', passphrase: '' });
    expect(ec).toMatchObject({ type: 'ecdsa', bits: 384 });
  }, 60_000);

  it('refuses to overwrite an existing key and rejects bad input', async () => {
    await expect(keys.generate({ type: 'ed25519', comment: '', fileName: 'id_ed25519_plain', passphrase: '' })).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    await expect(keys.generate({ type: 'rsa', bits: 1024, comment: '', fileName: 'weak', passphrase: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(keys.generate({ type: 'ed25519', comment: '', fileName: '../escape', passphrase: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(keys.generate({ type: 'ed25519', comment: '', fileName: 'short', passphrase: 'abc' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('lists and pairs keys, ignoring config/known_hosts, keeping orphans', async () => {
    await fs.writeFile(path.join(sb.sshDir, 'config'), 'Host x\n  HostName y\n');
    await fs.writeFile(path.join(sb.sshDir, 'known_hosts'), 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n');
    const pub = await fs.readFile(path.join(sb.sshDir, 'id_rsa_t.pub'), 'utf8');
    await fs.writeFile(path.join(sb.sshDir, 'orphan.pub'), pub);
    const list = await keys.list();
    expect(list.map((k) => k.id)).toEqual(['id_ecdsa_t', 'id_ed25519_plain', 'id_enc', 'id_rsa_t', 'orphan.pub']);
    expect(list.find((k) => k.id === 'orphan.pub')).toMatchObject({ hasPrivate: false, hasPublic: true, type: 'rsa', hasPassphrase: null, aclSafe: null });
    expect(list.every((k) => !k.error)).toBe(true);
  });
});

describe('key actions', () => {
  it('changes, then removes a passphrase (wrong old passphrase is reported)', async () => {
    sb.calls.length = 0;
    await expect(keys.changePassphrase('id_enc', 'wrong-passphrase', PASS2)).rejects.toMatchObject({ code: 'INCORRECT_PASSPHRASE' });
    await keys.changePassphrase('id_enc', PASS, PASS2);
    expect((await keys.detail('id_enc')).hasPassphrase).toBe(true);
    await keys.changePassphrase('id_enc', PASS2, '');
    expect((await keys.detail('id_enc')).hasPassphrase).toBe(false);
    assertNoSecretOnCommandLine(PASS);
    assertNoSecretOnCommandLine(PASS2);
  });

  it('stores tags/notes by fingerprint and keeps them across rename', async () => {
    const before = await keys.detail('id_ecdsa_t');
    await keys.setMeta('id_ecdsa_t', ['github', 'work'], 'ghi chú');
    const cfg = new ConfigStore(sb.ctx);
    const snap = await cfg.read();
    await cfg.write([{ op: 'add', fields: { patterns: ['gh'], hostName: 'github.com', user: 'git', port: null, identityFiles: [identityFileRef(sb.sshDir, 'C:/not-default', 'id_ecdsa_t')], identitiesOnly: 'yes', strictHostKeyChecking: null } }], snap.hash);

    const res = await keys.rename('id_ecdsa_t', 'id_ecdsa_renamed');
    expect(res.key).toMatchObject({ id: 'id_ecdsa_renamed', fingerprint: before.fingerprint, tags: ['github', 'work'] });
    expect(res.configReferences).toEqual(['gh']);
    expect((await keys.detail('id_ecdsa_renamed')).notes).toBe('ghi chú');
    await expect(keys.rename('id_ecdsa_renamed', 'id_rsa_t')).rejects.toMatchObject({ code: 'FILE_EXISTS' });

    const meta = await fs.readFile(path.join(sb.appData, 'metadata.json'), 'utf8');
    expect(meta).not.toMatch(/PRIVATE KEY|AAAA/);
  });

  it('detects and fixes an unsafe ACL, including explicit entries for other principals', async () => {
    const file = path.join(sb.sshDir, 'id_rsa_t');
    const r = await runProcess(ICACLS, [file, '/grant', '*S-1-1-0:(R)']); // Everyone, by SID (locale-independent)
    expect(r.code).toBe(0);
    expect((await keys.list()).find((k) => k.id === 'id_rsa_t')?.aclSafe).toBe(false);
    const [report] = await keys.fixPermissions(['id_rsa_t']);
    expect(report?.safe).toBe(true);
    expect((await sb.ctx.platform.permissions.check(file)).offending).toEqual([]);
  });

  it('imports a key from outside the SSH dir without overwriting', async () => {
    const outside = path.join(sb.root, 'incoming');
    await fs.mkdir(outside);
    await fs.copyFile(path.join(sb.sshDir, 'id_ed25519_plain'), path.join(outside, 'imported_key'));
    await fs.copyFile(path.join(sb.sshDir, 'id_ed25519_plain.pub'), path.join(outside, 'imported_key.pub'));
    const info = await keys.import(path.join(outside, 'imported_key'));
    expect(info).toMatchObject({ id: 'imported_key', hasPublic: true, aclSafe: true });
    await expect(keys.import(path.join(outside, 'imported_key'))).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    await fs.writeFile(path.join(outside, 'not_a_key'), 'hello');
    await expect(keys.import(path.join(outside, 'not_a_key'))).rejects.toMatchObject({ code: 'NOT_A_KEY' });
  });

  it('deletes only with confirmation', async () => {
    await expect(keys.delete('imported_key', false)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await keys.delete('imported_key', true);
    expect((await keys.list()).some((k) => k.id === 'imported_key')).toBe(false);
  });
});

describe('config store', () => {
  it('backs up before every write and refuses stale writes', async () => {
    const cfg = new ConfigStore(sb.ctx);
    const snap = await cfg.read();
    const { backupPath } = await cfg.write([{ op: 'delete', index: 0 }], snap.hash);
    expect(backupPath).toMatch(/config\.\d{8}-\d{6}-\d{3}\.bak$/);
    expect(await fs.readFile(backupPath as string, 'utf8')).toBe(snap.raw);
    await expect(cfg.write([], snap.hash)).rejects.toMatchObject({ code: 'CONFIG_CHANGED' });
  });
});

describe('connection test', () => {
  it('maps a refused connection and streams output', async () => {
    const chunks: string[] = [];
    const tester = new ConnectionTester(sb.ctx);
    const res = await tester.run({ host: 'git@127.0.0.1', timeoutSec: 5, onOutput: (_s, c) => chunks.push(c) });
    // Port 22 on localhost: either nothing listens (refused) or a local sshd rejects BatchMode auth.
    expect(res.success).toBe(false);
    expect(['CONNECTION_REFUSED', 'PERMISSION_DENIED_PUBLICKEY', 'HOST_KEY_VERIFICATION_FAILED']).toContain(res.error?.code);
    expect(chunks.join('')).not.toBe('');
  }, 20_000);

  it('only reads config/known_hosts from the sandbox', async () => {
    const args = await new ConnectionTester(sb.ctx).buildArgs('h', 5);
    expect(args).toContain(path.join(sb.sshDir, 'config'));
    expect(args.find((a) => a.startsWith('UserKnownHostsFile='))).toContain(sb.sshDir.replace(/\\/g, '/'));
    expect(args[args.length - 2]).toBe('--');
  });
});

describe('ssh-agent (skipped unless the service is running)', () => {
  it('adds and removes a sandbox key', async (t) => {
    const status = await sb.ctx.platform.agentService.status();
    if (status.state !== 'running') t.skip();
    const agent = new AgentKeys(sb.ctx);
    const priv = await keys.privateKeyPath('id_ed25519_plain');
    await agent.add(priv);
    const fp = (await keys.detail('id_ed25519_plain')).fingerprint;
    expect((await agent.list()).some((k) => k.fingerprint === fp)).toBe(true);
    await agent.remove(await keys.agentRemovePath('id_ed25519_plain'));
    expect((await agent.list()).some((k) => k.fingerprint === fp)).toBe(false);
  });
});
