import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { AgentKey } from '../types';
import type { CoreContext } from '../context';
import { SkmError } from '../errors/SkmError';
import { processFailed } from '../errors/errorMap';
import { passphraseAnswerer } from '../process/AskpassBroker';
import { parseFingerprintList, parsePublicKeyLine } from '../keys/fingerprint';
import { validatePassphrase } from '../keys/KeyService';

/**
 * ssh-add wrapper. The Windows agent persists added keys in the registry (HKCU) across reboots; the
 * macOS agent forgets them at logout unless the passphrase is stored in the Keychain.
 */
export class AgentKeys {
  constructor(private readonly ctx: Pick<CoreContext, 'bin' | 'run' | 'askpass' | 'platform'>) {}

  async list(): Promise<AgentKey[]> {
    const r = await this.ctx.run(this.ctx.bin.add, ['-l', '-E', 'sha256'], { timeoutMs: 10_000 });
    if (r.code === 0) {
      return parseFingerprintList(r.stdout).map((f) => ({ bits: f.bits, fingerprint: f.fingerprint, comment: f.comment, type: f.type }));
    }
    if (/has no identities/i.test(r.stdout + r.stderr)) return [];
    throw processFailed('ssh-add', r.code, r.stderr || r.stdout);
  }

  /**
   * `passphrase` is used only if ssh-add asks for it (encrypted key). `useKeychain` (macOS only) also
   * stores the passphrase in the login Keychain, so the key can be reloaded after a reboot without asking.
   */
  async add(privateKeyPath: string, passphrase?: string, opts: { useKeychain?: boolean } = {}): Promise<void> {
    if (passphrase !== undefined) validatePassphrase(passphrase, true);
    if (opts.useKeychain && !this.ctx.platform.info.agentKeychain) {
      throw new SkmError('INVALID_INPUT', 'Lưu passphrase vào Keychain chỉ có trên macOS.');
    }
    const args = opts.useKeychain ? ['--apple-use-keychain', privateKeyPath] : [privateKeyPath];
    const r = await this.ctx.askpass.withAnswers(passphraseAnswerer({ current: passphrase }), (env) =>
      this.ctx.run(this.ctx.bin.add, args, { timeoutMs: 30_000, env })
    );
    if (r.code === 0) return;
    const out = r.stderr || r.stdout;
    if (/UNPROTECTED|bad permissions|Could not open a connection|Error connecting to agent/i.test(out)) throw processFailed('ssh-add', r.code, out);
    if (passphrase === undefined) {
      throw new SkmError('INCORRECT_PASSPHRASE', 'Key có passphrase. Hãy nhập passphrase để thêm vào ssh-agent.', out);
    }
    throw new SkmError('INCORRECT_PASSPHRASE', 'Passphrase không đúng hoặc ssh-add không nạp được key.', out);
  }

  async remove(keyPath: string): Promise<void> {
    const r = await this.ctx.run(this.ctx.bin.add, ['-d', keyPath], { timeoutMs: 10_000 });
    if (r.code !== 0) throw processFailed('ssh-add', r.code, r.stderr || r.stdout);
  }

  /**
   * Removes a loaded key by fingerprint, even if its file is not in the SSH dir: the public key
   * comes from `ssh-add -L` and is written to a temporary .pub under `tmpDir` for `ssh-add -d`.
   */
  async removeByFingerprint(fingerprint: string, tmpDir: string): Promise<void> {
    const r = await this.ctx.run(this.ctx.bin.add, ['-L'], { timeoutMs: 10_000 });
    if (r.code !== 0) throw processFailed('ssh-add', r.code, r.stderr || r.stdout);
    const line = r.stdout.split(/\r?\n/).find((l) => {
      const pk = parsePublicKeyLine(l);
      return pk !== null && publicKeyFingerprint(pk.base64) === fingerprint;
    });
    if (!line) throw new SkmError('NOT_FOUND', 'Key này không còn trong ssh-agent.');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmp = path.join(tmpDir, `agent-remove-${randomBytes(6).toString('hex')}.pub`);
    await fs.writeFile(tmp, line + '\n');
    try {
      await this.remove(tmp);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
}

/** OpenSSH SHA256 fingerprint of a public key blob (unpadded base64 of SHA-256). */
export function publicKeyFingerprint(base64Blob: string): string {
  return 'SHA256:' + createHash('sha256').update(Buffer.from(base64Blob, 'base64')).digest('base64').replace(/=+$/, '');
}
