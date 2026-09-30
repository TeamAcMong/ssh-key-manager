import fs from 'node:fs/promises';
import path from 'node:path';
import type { AclReport, GenerateKeyRequest, KeyDetail, KeyInfo, RenameResult } from '../types';
import { ECDSA_BITS, RSA_BITS } from '../types';
import type { CoreContext } from '../context';
import { SkmError, toErrorData } from '../errors/SkmError';
import { processFailed } from '../errors/errorMap';
import { validateNewKeyFileName } from '../security/PathGuard';
import { passphraseAnswerer } from '../process/AskpassBroker';
import { classifyFile, pairKeyFiles, type KeyFilePair, type ScannedFile } from './pairing';
import { parseFingerprintLine, parsePublicKeyLine, parseRandomart } from './fingerprint';
import { exists } from '../store/fsutil';
import { validateNotes, validateTags } from '../store/MetadataStore';
import { SshConfigDocument } from '../config/SshConfigDocument';

const HEAD_BYTES = 64;
const MAX_IMPORT_BYTES = 64 * 1024;
const MAX_COMMENT_LEN = 200;
const MIN_PASSPHRASE_LEN = 5;

export function validatePassphrase(p: unknown, allowEmpty: boolean): string {
  if (typeof p !== 'string') throw new SkmError('INVALID_INPUT', 'Passphrase không hợp lệ.');
  if (/[\r\n\0]/.test(p)) throw new SkmError('INVALID_INPUT', 'Passphrase không được chứa ký tự xuống dòng.');
  if (p.length === 0 && !allowEmpty) throw new SkmError('INVALID_INPUT', 'Passphrase không được để trống.');
  if (p.length > 0 && p.length < MIN_PASSPHRASE_LEN) throw new SkmError('INVALID_INPUT', `Passphrase phải có ít nhất ${MIN_PASSPHRASE_LEN} ký tự (yêu cầu của OpenSSH).`);
  if (p.length > 1024) throw new SkmError('INVALID_INPUT', 'Passphrase quá dài.');
  return p;
}

export function validateComment(c: unknown): string {
  if (typeof c !== 'string' || c.length > MAX_COMMENT_LEN || /[\r\n\0]/.test(c)) {
    throw new SkmError('INVALID_INPUT', `Comment không hợp lệ (một dòng, tối đa ${MAX_COMMENT_LEN} ký tự).`);
  }
  return c;
}

export function validateGenerateRequest(req: GenerateKeyRequest): GenerateKeyRequest {
  if (!['ed25519', 'rsa', 'ecdsa'].includes(req.type)) throw new SkmError('INVALID_INPUT', 'Loại key không hợp lệ.');
  let bits: number | undefined;
  if (req.type === 'rsa') {
    bits = req.bits ?? 3072;
    if (!(RSA_BITS as readonly number[]).includes(bits)) throw new SkmError('INVALID_INPUT', 'RSA chỉ hỗ trợ 3072 hoặc 4096 bit.');
  } else if (req.type === 'ecdsa') {
    bits = req.bits ?? 256;
    if (!(ECDSA_BITS as readonly number[]).includes(bits)) throw new SkmError('INVALID_INPUT', 'ECDSA chỉ hỗ trợ 256, 384 hoặc 521 bit.');
  } else if (req.bits !== undefined) {
    throw new SkmError('INVALID_INPUT', 'Ed25519 không có tuỳ chọn số bit.');
  }
  const nameErr = validateNewKeyFileName(req.fileName);
  if (nameErr) throw new SkmError('INVALID_INPUT', nameErr);
  const out: GenerateKeyRequest = {
    type: req.type,
    comment: validateComment(req.comment),
    fileName: req.fileName,
    passphrase: validatePassphrase(req.passphrase, true)
  };
  if (bits !== undefined) out.bits = bits;
  return out;
}

async function readHead(file: string): Promise<string> {
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

export class KeyService {
  constructor(private readonly ctx: CoreContext) {}

  private async scan(): Promise<KeyFilePair[]> {
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = await fs.readdir(this.ctx.sshDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new SkmError('NOT_FOUND', `Thư mục SSH không tồn tại: ${this.ctx.sshDir}`);
      }
      throw err;
    }
    const files: ScannedFile[] = [];
    for (const d of dirents) {
      if (!d.isFile()) continue; // symlinks and dirs are ignored on purpose
      // Unreadable files (locked, no access) are classified as non-keys rather than aborting the scan.
      const head = await readHead(path.join(this.ctx.sshDir, d.name)).catch(() => '');
      files.push({ name: d.name, kind: classifyFile(d.name, head) });
    }
    return pairKeyFiles(files);
  }

  private async findPair(id: string): Promise<KeyFilePair> {
    this.ctx.guard.resolveFile(id);
    const pair = (await this.scan()).find((p) => p.id.toLowerCase() === id.toLowerCase());
    if (!pair) throw new SkmError('NOT_FOUND', `Không tìm thấy key "${id}" trong thư mục SSH.`);
    return pair;
  }

  private privatePath(pair: KeyFilePair): string {
    if (!pair.privateFile) throw new SkmError('NOT_FOUND', `Key "${pair.id}" không có file private.`);
    return this.ctx.guard.resolveFile(pair.privateFile);
  }

  async list(): Promise<KeyInfo[]> {
    const pairs = await this.scan();
    return mapLimit(pairs, 4, (p) => this.info(p));
  }

  private async info(pair: KeyFilePair): Promise<KeyInfo> {
    const info: KeyInfo = {
      id: pair.id,
      hasPrivate: pair.privateFile !== null,
      hasPublic: pair.publicFile !== null,
      type: 'unknown',
      bits: null,
      fingerprint: null,
      comment: '',
      createdAt: null,
      hasPassphrase: null,
      aclSafe: null,
      tags: []
    };
    const problems: string[] = [];
    const fpSource = this.ctx.guard.resolveFile((pair.publicFile ?? pair.privateFile) as string);
    try {
      const st = await fs.stat(pair.privateFile ? this.ctx.guard.resolveFile(pair.privateFile) : fpSource);
      info.createdAt = st.birthtime.toISOString();
      const r = await this.ctx.run(this.ctx.bin.keygen, ['-l', '-E', 'sha256', '-f', fpSource], { timeoutMs: 10_000 });
      const fp = r.code === 0 ? parseFingerprintLine(r.stdout) : null;
      if (fp) {
        info.type = fp.type;
        info.bits = fp.bits;
        info.fingerprint = fp.fingerprint;
        info.comment = fp.comment;
      } else {
        problems.push(processFailed('ssh-keygen', r.code, r.stderr).messageVi);
      }
      if (pair.privateFile) {
        const priv = this.ctx.guard.resolveFile(pair.privateFile);
        info.hasPassphrase = await this.detectPassphrase(priv);
        info.aclSafe = (await this.ctx.platform.permissions.check(priv)).safe;
      }
      if (info.fingerprint) info.tags = (await this.ctx.metadata.get(info.fingerprint))?.tags ?? [];
    } catch (err) {
      problems.push(toErrorData(err).messageVi);
    }
    if (problems.length) info.error = problems.join(' ');
    return info;
  }

  /** `ssh-keygen -y -P ""` succeeds only for unencrypted keys. The key content never leaves ssh-keygen. */
  private async detectPassphrase(privPath: string): Promise<boolean | null> {
    const r = await this.ctx.run(this.ctx.bin.keygen, ['-y', '-P', '', '-f', privPath], { timeoutMs: 10_000 });
    if (r.code === 0) return false;
    if (/incorrect passphrase/i.test(r.stderr)) return true;
    return null;
  }

  async detail(id: string): Promise<KeyDetail> {
    const pair = await this.findPair(id);
    const info = await this.info(pair);
    const fpSource = this.ctx.guard.resolveFile((pair.publicFile ?? pair.privateFile) as string);
    const lv = await this.ctx.run(this.ctx.bin.keygen, ['-lv', '-E', 'sha256', '-f', fpSource], { timeoutMs: 10_000 });
    let publicKey: string | null = null;
    if (pair.publicFile) {
      publicKey = (await fs.readFile(this.ctx.guard.resolveFile(pair.publicFile), 'utf8')).trim();
    } else if (pair.privateFile && info.hasPassphrase === false) {
      const y = await this.ctx.run(this.ctx.bin.keygen, ['-y', '-P', '', '-f', this.privatePath(pair)], { timeoutMs: 10_000 });
      if (y.code === 0) publicKey = y.stdout.trim();
    }
    // Defence in depth: only a single "algo base64 comment" line may leave this function.
    if (publicKey !== null && !parsePublicKeyLine(publicKey)) publicKey = null;
    const meta = info.fingerprint ? await this.ctx.metadata.get(info.fingerprint) : null;
    return { ...info, publicKey, randomart: lv.code === 0 ? parseRandomart(lv.stdout) : null, notes: meta?.notes ?? '' };
  }

  async publicKey(id: string): Promise<string> {
    const d = await this.detail(id);
    if (!d.publicKey) throw new SkmError('NOT_FOUND', 'Không có public key (thiếu file .pub và private key có passphrase).');
    return d.publicKey;
  }

  async generate(input: GenerateKeyRequest): Promise<KeyDetail> {
    const req = validateGenerateRequest(input);
    const priv = this.ctx.guard.resolveFile(req.fileName);
    if ((await exists(priv)) || (await exists(`${priv}.pub`))) {
      throw new SkmError('FILE_EXISTS', `File "${req.fileName}" hoặc "${req.fileName}.pub" đã tồn tại. Không ghi đè key có sẵn.`);
    }
    const args = ['-t', req.type];
    if (req.bits !== undefined) args.push('-b', String(req.bits));
    args.push('-C', req.comment, '-f', priv);
    let r;
    if (req.passphrase === '') {
      r = await this.ctx.run(this.ctx.bin.keygen, [...args, '-N', ''], { timeoutMs: 120_000 });
    } else {
      r = await this.ctx.askpass.withAnswers(passphraseAnswerer({ next: req.passphrase }), (env) =>
        this.ctx.run(this.ctx.bin.keygen, args, { timeoutMs: 120_000, env })
      );
    }
    if (r.code !== 0 || !(await exists(priv))) throw processFailed('ssh-keygen', r.code, r.stderr);
    await this.ctx.platform.permissions.restrictToCurrentUser(priv);
    return this.detail(req.fileName);
  }

  /** oldPassphrase '' for keys without one; newPassphrase '' removes the passphrase. */
  async changePassphrase(id: string, oldPassphrase: string, newPassphrase: string): Promise<void> {
    validatePassphrase(oldPassphrase, true);
    validatePassphrase(newPassphrase, true);
    const priv = this.privatePath(await this.findPair(id));
    const r = await this.ctx.askpass.withAnswers(passphraseAnswerer({ current: oldPassphrase, next: newPassphrase }), (env) =>
      this.ctx.run(this.ctx.bin.keygen, ['-p', '-f', priv], { timeoutMs: 60_000, env })
    );
    if (r.code !== 0) {
      // A cancelled askpass (wrong old passphrase) surfaces as a generic failure; name it.
      if (/incorrect passphrase|failed to load key|bad passphrase/i.test(r.stderr)) {
        throw new SkmError('INCORRECT_PASSPHRASE', 'Passphrase hiện tại không đúng.', r.stderr);
      }
      throw processFailed('ssh-keygen', r.code, r.stderr);
    }
  }

  async rename(id: string, newName: string): Promise<RenameResult> {
    const nameErr = validateNewKeyFileName(newName);
    if (nameErr) throw new SkmError('INVALID_INPUT', nameErr);
    const pair = await this.findPair(id);
    const targetPriv = this.ctx.guard.resolveFile(newName);
    if (id.toLowerCase() !== newName.toLowerCase() && ((await exists(targetPriv)) || (await exists(`${targetPriv}.pub`)))) {
      throw new SkmError('FILE_EXISTS', `Đã có file tên "${newName}". Không ghi đè.`);
    }
    const info = await this.info(pair);
    if (pair.privateFile) await fs.rename(this.ctx.guard.resolveFile(pair.privateFile), targetPriv);
    if (pair.publicFile) await fs.rename(this.ctx.guard.resolveFile(pair.publicFile), `${targetPriv}.pub`);
    if (info.fingerprint) await this.ctx.metadata.updateFileName(info.fingerprint, newName);
    const renamedId = pair.privateFile ? newName : `${newName}.pub`;
    return { key: await this.info(await this.findPair(renamedId)), configReferences: await this.configReferences(pair.privateFile ?? pair.id) };
  }

  private async configReferences(fileName: string): Promise<string[]> {
    const configPath = path.join(this.ctx.sshDir, 'config');
    if (!(await exists(configPath))) return [];
    const doc = SshConfigDocument.parse(await fs.readFile(configPath, 'utf8'));
    const lower = fileName.toLowerCase();
    return doc
      .hosts()
      .filter((h) => h.identityFiles.some((f) => path.basename(f.replace(/\\/g, '/')).toLowerCase() === lower))
      .map((h) => h.patterns.join(' '));
  }

  /** Caller must have obtained explicit confirmation (dialog / --yes). */
  async delete(id: string, confirmed: boolean): Promise<void> {
    if (confirmed !== true) throw new SkmError('INVALID_INPUT', 'Xoá key cần xác nhận rõ ràng.');
    const pair = await this.findPair(id);
    const info = await this.info(pair);
    if (pair.privateFile) await fs.rm(this.ctx.guard.resolveFile(pair.privateFile));
    if (pair.publicFile) await fs.rm(this.ctx.guard.resolveFile(pair.publicFile));
    if (info.fingerprint) await this.ctx.metadata.remove(info.fingerprint);
  }

  /** Copies a key file from anywhere into the SSH dir (never overwrites), then locks its ACL. */
  async import(sourcePath: string): Promise<KeyInfo> {
    if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) throw new SkmError('INVALID_INPUT', 'Đường dẫn file không hợp lệ.');
    const st = await fs.stat(sourcePath).catch(() => null);
    if (!st || !st.isFile()) throw new SkmError('NOT_FOUND', 'Không tìm thấy file để import.');
    if (st.size > MAX_IMPORT_BYTES) throw new SkmError('NOT_A_KEY', 'File quá lớn để là một SSH key.');
    const name = path.basename(sourcePath);
    const kind = classifyFile(name, await readHead(sourcePath));
    if (kind === 'other') throw new SkmError('NOT_A_KEY', 'File này không phải SSH key (OpenSSH/PEM/PuTTY) được hỗ trợ.');

    const check = await this.ctx.run(this.ctx.bin.keygen, ['-l', '-f', sourcePath], { timeoutMs: 10_000 });
    if (check.code !== 0) throw new SkmError('NOT_A_KEY', 'ssh-keygen không đọc được file này như một SSH key.', check.stderr);

    const targetName = kind === 'public' && !name.toLowerCase().endsWith('.pub') ? `${name}.pub` : name;
    const baseName = kind === 'public' ? targetName.replace(/\.pub$/i, '') : targetName;
    const nameErr = validateNewKeyFileName(baseName);
    if (nameErr) throw new SkmError('INVALID_INPUT', `Tên file "${name}" không dùng được: ${nameErr}`);
    const target = this.ctx.guard.resolveFile(targetName);
    if (await exists(target)) throw new SkmError('FILE_EXISTS', `Thư mục SSH đã có file "${targetName}". Không ghi đè.`);

    await fs.copyFile(sourcePath, target, fs.constants.COPYFILE_EXCL);
    if (kind === 'private') {
      await this.ctx.platform.permissions.restrictToCurrentUser(target);
      const sibling = `${sourcePath}.pub`;
      const pubTarget = `${target}.pub`;
      if ((await exists(sibling)) && !(await exists(pubTarget))) await fs.copyFile(sibling, pubTarget, fs.constants.COPYFILE_EXCL);
    }
    return this.info(await this.findPair(targetName));
  }

  async fixPermissions(ids: string[] | 'all'): Promise<AclReport[]> {
    const pairs = await this.scan();
    const selected = ids === 'all' ? pairs.filter((p) => p.privateFile) : await Promise.all(ids.map((id) => this.findPair(id)));
    const reports: AclReport[] = [];
    for (const pair of selected) {
      if (!pair.privateFile) continue;
      const file = this.ctx.guard.resolveFile(pair.privateFile);
      const current = await this.ctx.platform.permissions.check(file);
      reports.push(current.safe ? current : await this.ctx.platform.permissions.restrictToCurrentUser(file));
    }
    return reports;
  }

  async setMeta(id: string, tags: unknown, notes: unknown): Promise<void> {
    const pair = await this.findPair(id);
    const info = await this.info(pair);
    if (!info.fingerprint) throw new SkmError('INVALID_INPUT', 'Không lưu được tag/ghi chú vì không đọc được fingerprint của key.');
    await this.ctx.metadata.set(info.fingerprint, { tags: validateTags(tags), notes: validateNotes(notes), lastKnownFile: pair.id });
  }

  /** Absolute private key path for ssh-add; validated inside the SSH dir. */
  async privateKeyPath(id: string): Promise<string> {
    const p = this.privatePath(await this.findPair(id));
    await this.ctx.guard.assertRealInside(p);
    return p;
  }

  /** Path ssh-add -d accepts (public file preferred). */
  async agentRemovePath(id: string): Promise<string> {
    const pair = await this.findPair(id);
    return this.ctx.guard.resolveFile((pair.publicFile ?? pair.privateFile) as string);
  }
}
