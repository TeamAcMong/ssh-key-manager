import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ConfigPreview, ConfigSnapshot, HostEdit } from '../types';
import type { CoreContext } from '../context';
import { SkmError } from '../errors/SkmError';
import { containsPrivateKeyMaterial } from '../security/redact';
import { backupBeforeWrite } from '../store/BackupService';
import { exists, writeFileAtomic } from '../store/fsutil';
import { SshConfigDocument } from './SshConfigDocument';

export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Value to put in IdentityFile for a key inside the SSH dir: "~/.ssh/<name>" for the real
 * default dir (portable), an absolute forward-slash path for any other (sandbox) dir.
 */
export function identityFileRef(sshDir: string, defaultSshDir: string, fileName: string): string {
  if (path.resolve(sshDir).toLowerCase() === path.resolve(defaultSshDir).toLowerCase()) return `~/.ssh/${fileName}`;
  return path.join(sshDir, fileName).replace(/\\/g, '/');
}

export class ConfigStore {
  readonly file: string;

  constructor(private readonly ctx: Pick<CoreContext, 'sshDir' | 'guard'>) {
    this.file = ctx.guard.resolveFile('config');
  }

  async read(): Promise<ConfigSnapshot> {
    const present = await exists(this.file);
    const raw = present ? await fs.readFile(this.file, 'utf8') : '';
    return { path: this.file, exists: present, raw, hash: hashText(raw), hosts: SshConfigDocument.parse(raw).hosts() };
  }

  async preview(edits: readonly HostEdit[]): Promise<ConfigPreview> {
    const snap = await this.read();
    const doc = SshConfigDocument.parse(snap.raw);
    doc.applyEdits(edits);
    return { before: snap.raw, after: doc.serialize(), hash: snap.hash };
  }

  /**
   * Re-applies the edits to the file as it is on disk now. Refuses if the file changed since
   * `expectedHash` was read, so a diff the user approved is exactly what gets written.
   */
  async write(edits: readonly HostEdit[], expectedHash: string): Promise<{ backupPath: string | null; snapshot: ConfigSnapshot }> {
    const snap = await this.read();
    if (snap.hash !== expectedHash) {
      throw new SkmError('CONFIG_CHANGED', 'File config đã bị thay đổi bên ngoài kể từ lúc bạn mở. Hãy tải lại rồi thử lại.');
    }
    const doc = SshConfigDocument.parse(snap.raw);
    doc.applyEdits(edits);
    const next = doc.serialize();
    if (containsPrivateKeyMaterial(next)) throw new SkmError('INVALID_INPUT', 'Nội dung config chứa private key. Đã huỷ ghi.');
    const backupPath = await backupBeforeWrite(this.file);
    await writeFileAtomic(this.file, next);
    return { backupPath, snapshot: await this.read() };
  }
}
