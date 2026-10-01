import fs from 'node:fs/promises';
import type { AclEntry, AclReport } from '../../types';
import type { FilePermissionService } from '../interfaces';
import { SkmError } from '../../errors/SkmError';

function rwx(bits: number): string {
  return `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${bits & 1 ? 'x' : '-'}`;
}

/**
 * Same rule OpenSSH applies before using a private key: it must be owned by the user and grant
 * nothing to group or others (any bit in 077 makes it "UNPROTECTED PRIVATE KEY FILE").
 */
export function evaluateMode(file: string, mode: number, ownerUid: number, myUid: number): AclReport {
  const owner = (mode >> 6) & 7;
  const group = (mode >> 3) & 7;
  const others = mode & 7;
  const ownerName = ownerUid === myUid ? 'owner (bạn)' : `owner (uid ${ownerUid})`;
  const entries: AclEntry[] = [{ principal: ownerName, rights: rwx(owner), inherited: false, deny: false }];
  if (group) entries.push({ principal: 'group', rights: rwx(group), inherited: false, deny: false });
  if (others) entries.push({ principal: 'others', rights: rwx(others), inherited: false, deny: false });
  const offending: string[] = [];
  if (ownerUid !== myUid) offending.push(ownerName);
  if (group) offending.push('group');
  if (others) offending.push('others');
  return { file, safe: offending.length === 0, entries, offending };
}

/** POSIX mode bits (chmod), used on macOS. */
export class PosixPermissions implements FilePermissionService {
  constructor(private readonly myUid: () => number = () => process.getuid?.() ?? -1) {}

  async check(file: string): Promise<AclReport> {
    const st = await fs.stat(file);
    return evaluateMode(file, st.mode & 0o777, st.uid, this.myUid());
  }

  async restrictToCurrentUser(file: string): Promise<AclReport> {
    const st = await fs.stat(file);
    if (st.uid !== this.myUid()) {
      throw new SkmError('PROCESS_FAILED', `File thuộc về người dùng khác (uid ${st.uid}). Hãy đổi chủ sở hữu bằng: sudo chown "$USER" "${file}"`);
    }
    await fs.chmod(file, 0o600);
    const report = await this.check(file);
    if (!report.safe) throw new SkmError('PROCESS_FAILED', 'Đã chmod 600 nhưng file vẫn chưa an toàn.', report.offending.join(', '));
    return report;
  }
}
