import os from 'node:os';
import path from 'node:path';
import type { AclEntry, AclReport } from '../../types';
import type { FilePermissionService } from '../interfaces';
import type { ProcessRunner } from '../../process/ProcessRunner';
import { SkmError } from '../../errors/SkmError';

const ICACLS = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe');

// Same trust set OpenSSH for Windows accepts for a private key file.
const ALWAYS_ALLOWED = ['nt authority\\system', 'builtin\\administrators'];

export function currentUserPrincipal(): string {
  const domain = process.env.USERDOMAIN ?? os.hostname();
  return `${domain}\\${os.userInfo().username}`;
}

/** Parses `icacls <file>` output. Exported for unit tests. */
export function parseIcacls(output: string, file: string): AclEntry[] {
  const entries: AclEntry[] = [];
  const lines = output.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] ?? '';
    if (i === 0) {
      // First line starts with the file path itself.
      const idx = line.toLowerCase().indexOf(file.toLowerCase());
      if (idx >= 0) line = line.slice(idx + file.length);
    }
    line = line.trim();
    if (!line || /^Successfully processed|^Failed processing/i.test(line)) continue;
    const m = /^(.+?):((?:\([^)]*\))+)$/.exec(line);
    if (!m) continue;
    const principal = m[1] ?? '';
    const flags = m[2] ?? '';
    entries.push({
      principal,
      rights: flags,
      inherited: /\(I\)/.test(flags),
      deny: /\(DENY\)/i.test(flags)
    });
  }
  return entries;
}

export function evaluateAcl(file: string, entries: AclEntry[], user: string): AclReport {
  const allowed = new Set([...ALWAYS_ALLOWED, user.toLowerCase()]);
  const bareUser = user.split('\\').pop()?.toLowerCase() ?? '';
  const offending = entries
    .filter((e) => !e.deny)
    .map((e) => e.principal)
    .filter((p) => !allowed.has(p.toLowerCase()) && p.toLowerCase() !== bareUser);
  const unique = [...new Set(offending)];
  return { file, safe: unique.length === 0 && entries.length > 0, entries, offending: unique };
}

export class WinAcl implements FilePermissionService {
  constructor(private readonly run: ProcessRunner) {}

  async check(file: string): Promise<AclReport> {
    const r = await this.run(ICACLS, [file], { timeoutMs: 10_000 });
    if (r.code !== 0) {
      throw new SkmError('PROCESS_FAILED', 'Không đọc được quyền truy cập của file.', r.stderr || r.stdout);
    }
    return evaluateAcl(file, parseIcacls(r.stdout, file), currentUserPrincipal());
  }

  async restrictToCurrentUser(file: string): Promise<AclReport> {
    const user = currentUserPrincipal();
    const r = await this.run(ICACLS, [file, '/inheritance:r', '/grant:r', `${user}:F`], { timeoutMs: 10_000 });
    if (r.code !== 0) {
      throw new SkmError('PROCESS_FAILED', 'Không sửa được quyền truy cập của file.', r.stderr || r.stdout);
    }
    // `/inheritance:r /grant:r` keeps explicit entries of other principals (ssh-keygen itself adds
    // SYSTEM and Administrators). The spec asks for "only the current user", so remove them all;
    // check() still tolerates SYSTEM/Administrators like OpenSSH does.
    let report = await this.check(file);
    const bareUser = user.split('\\').pop()?.toLowerCase();
    const others = [
      ...new Set(report.entries.filter((e) => !e.deny && e.principal.toLowerCase() !== user.toLowerCase() && e.principal.toLowerCase() !== bareUser).map((e) => e.principal))
    ];
    for (const principal of others) {
      const rm = await this.run(ICACLS, [file, '/remove:g', principal], { timeoutMs: 10_000 });
      if (rm.code !== 0) {
        throw new SkmError('PROCESS_FAILED', `Không gỡ được quyền của ${principal}.`, rm.stderr || rm.stdout);
      }
    }
    if (others.length > 0) report = await this.check(file);
    if (!report.safe) {
      throw new SkmError('PROCESS_FAILED', 'Đã sửa quyền nhưng file vẫn chưa an toàn.', report.offending.join(', '));
    }
    return report;
  }
}
