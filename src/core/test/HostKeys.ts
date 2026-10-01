import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { HostKeyScan, ScannedHostKey } from '../types';
import type { CoreContext } from '../context';
import { SkmError } from '../errors/SkmError';
import { mapSshError } from '../errors/errorMap';
import { publicKeyFingerprint } from '../agent/AgentKeys';
import { backupBeforeWrite } from '../store/BackupService';
import { exists, writeFileAtomic } from '../store/fsutil';
import { quoteOpt, validateHost } from './ConnectionTester';

/**
 * Host key fingerprints the providers publish on their docs pages. A scanned key is trusted
 * automatically only when it matches one of these; any mismatch is treated as a possible MITM.
 */
const PUBLISHED: readonly {
  provider: string;
  hosts: readonly string[];
  fingerprints: readonly string[];
}[] = [
  {
    provider: 'GitHub',
    hosts: ['github.com', 'ssh.github.com'],
    fingerprints: ['SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU', 'SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM', 'SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s']
  },
  {
    provider: 'GitLab.com',
    hosts: ['gitlab.com', 'altssh.gitlab.com'],
    fingerprints: ['SHA256:eUXGGm1YGsMAS7vkcx6JOJdOGHPem5gQp4taiCfCLB8', 'SHA256:HbW3g8zUjNSksFbqTiUWPWg2Bq1x8xdGUrliXFzSnUw', 'SHA256:ROQFvPThGrW4RuWLoL9tq9I9zJ42fK4XywyRtbOz/EQ']
  },
  {
    provider: 'Bitbucket',
    hosts: ['bitbucket.org', 'altssh.bitbucket.org'],
    fingerprints: ['SHA256:ybgmFkzwOSotHTHLJgHO0QN8L0xErw6vd0VhFA9m3SM', 'SHA256:FC73VB6C4OQLSCrjEayhMp9UMxS97caD/Yyi2bhW/J0', 'SHA256:46OSHA1Rmj8E8ERTC6xkNcmGOw9oFxYr0WF6zWW8l1E']
  }
];

export function publishedFor(hostName: string): (typeof PUBLISHED)[number] | null {
  const h = hostName.toLowerCase();
  return PUBLISHED.find((p) => p.hosts.includes(h)) ?? null;
}

export interface ResolvedTarget {
  hostName: string;
  port: number;
}

/** Parses `ssh -G` output (lowercase "key value" lines). */
export function parseSshG(stdout: string): ResolvedTarget {
  const get = (k: string): string | null => new RegExp(`^${k} (.+)$`, 'm').exec(stdout.replace(/\r/g, ''))?.[1]?.trim() ?? null;
  const hostName = get('hostname');
  const port = Number(get('port') ?? '22');
  if (!hostName || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SkmError('INVALID_INPUT', 'Không đọc được HostName/Port của host này từ config.', stdout);
  }
  return { hostName, port };
}

export interface KnownHostLine {
  type: string;
  fingerprint: string;
  /** "<host-field> <type> <base64>" exactly as it goes into known_hosts. */
  line: string;
}

/** Parses plain (unhashed) known_hosts lines, as written by ssh with HashKnownHosts=no. */
export function parseKnownHosts(text: string): KnownHostLine[] {
  const out: KnownHostLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/);
    if (parts.length < 3 || parts[0]?.startsWith('#') || parts[0]?.startsWith('@')) continue;
    const [host, type, blob] = parts as [string, string, string];
    if (!/^[A-Za-z0-9+/]+={0,3}$/.test(blob)) continue;
    out.push({ type, fingerprint: publicKeyFingerprint(blob), line: `${host} ${type} ${blob}` });
  }
  return out;
}

/** Appends lines that are not already present, keeping the existing content and line endings intact. */
export function appendKnownHosts(existing: string, lines: readonly string[]): { content: string; added: number } {
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const present = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const fresh = lines.filter((l) => !present.has(l));
  if (fresh.length === 0) return { content: existing, added: 0 };
  const sep = existing === '' || existing.endsWith('\n') ? '' : eol;
  return { content: existing + sep + fresh.join(eol) + eol, added: fresh.length };
}

export class HostKeyService {
  constructor(private readonly ctx: Pick<CoreContext, 'sshDir' | 'bin' | 'run'>) {}

  private async configArg(): Promise<string> {
    const config = path.join(this.ctx.sshDir, 'config');
    return (await exists(config)) ? config : 'none';
  }

  /** Resolves an alias through the SSH dir's config, the same way ConnectionTester's ssh call does. */
  async resolve(host: string): Promise<ResolvedTarget> {
    const r = await this.ctx.run(this.ctx.bin.ssh, ['-G', '-F', await this.configArg(), '--', validateHost(host)], { timeoutMs: 10_000 });
    if (r.code !== 0) throw new SkmError('PROCESS_FAILED', 'ssh -G không đọc được cấu hình của host này.', r.stderr);
    return parseSshG(r.stdout);
  }

  /**
   * Gets the host key the server presents, using ssh itself (ssh-keyscan is not answered by every server,
   * e.g. Hugging Face). ssh records the key into a throwaway known_hosts file with accept-new and stops
   * before authenticating ("none" is the only method offered), so no key or password is ever sent.
   */
  private async fetchKeys(host: string): Promise<{ target: ResolvedTarget; keys: KnownHostLine[] }> {
    const target = await this.resolve(host);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skm-hostkey-'));
    const file = path.join(dir, 'known_hosts');
    try {
      const o = (opt: string): string[] => ['-o', opt];
      const r = await this.ctx.run(
        this.ctx.bin.ssh,
        [
          '-T',
          '-F', await this.configArg(),
          ...o('BatchMode=yes'),
          ...o('ConnectTimeout=10'),
          ...o('StrictHostKeyChecking=accept-new'),
          ...o(`UserKnownHostsFile=${quoteOpt(file)}`),
          ...o('GlobalKnownHostsFile=none'),
          ...o('HashKnownHosts=no'),
          ...o('CheckHostIP=no'),
          ...o('UpdateHostKeys=no'),
          ...o('PreferredAuthentications=none'),
          ...o('PubkeyAuthentication=no'),
          ...o('ControlPath=none'),
          '--',
          host
        ],
        { timeoutMs: 20_000 }
      );
      const keys = parseKnownHosts(await fs.readFile(file, 'utf8').catch(() => ''));
      if (keys.length === 0) {
        // Only network errors are meaningful here: auth errors are expected because no auth method is offered.
        const mapped = mapSshError(r.stderr, { timedOut: r.timedOut });
        if (mapped && ['CONNECTION_TIMEOUT', 'CONNECTION_REFUSED', 'HOST_NOT_FOUND'].includes(mapped.code)) throw mapped;
        throw new SkmError('PROCESS_FAILED', `Không lấy được host key từ ${target.hostName}:${target.port}. Kiểm tra HostName/Port và kết nối mạng.`, r.stderr);
      }
      return { target, keys };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  async scan(host: string): Promise<HostKeyScan> {
    const { target, keys } = await this.fetchKeys(validateHost(host));
    const pub = publishedFor(target.hostName);
    const scanned: ScannedHostKey[] = keys.map((k) => ({ type: k.type, fingerprint: k.fingerprint, published: pub ? pub.fingerprints.includes(k.fingerprint) : null }));
    return { hostName: target.hostName, port: target.port, provider: pub?.provider ?? null, keys: scanned };
  }

  /**
   * Fetches the key again and appends the approved keys to known_hosts (after a .bak backup). Refuses when
   * a key no longer matches what the user approved, or when a provider's key differs from its published list.
   */
  async trust(host: string, approved: readonly string[]): Promise<{ added: number; backupPath: string | null }> {
    if (approved.length === 0) throw new SkmError('INVALID_INPUT', 'Chưa chọn host key nào để tin cậy.');
    const { target, keys } = await this.fetchKeys(validateHost(host));
    const pub = publishedFor(target.hostName);
    if (pub && keys.some((k) => !pub.fingerprints.includes(k.fingerprint))) {
      throw new SkmError('HOST_KEY_CHANGED', `Host key nhận được KHÔNG khớp với fingerprint ${pub.provider} công bố. Có thể đang bị tấn công xen giữa (MITM) — không thêm vào known_hosts.`);
    }
    const chosen = keys.filter((k) => approved.includes(k.fingerprint));
    if (chosen.length !== new Set(approved).size) {
      throw new SkmError('HOST_KEY_CHANGED', 'Host key của máy chủ vừa thay đổi so với lúc bạn xem. Hãy xem lại fingerprint trước khi tin cậy.');
    }
    const file = path.join(this.ctx.sshDir, 'known_hosts');
    const existing = (await exists(file)) ? await fs.readFile(file, 'utf8') : '';
    const { content, added } = appendKnownHosts(existing, chosen.map((k) => k.line));
    if (added === 0) return { added, backupPath: null };
    const backupPath = await backupBeforeWrite(file);
    await writeFileAtomic(file, content);
    return { added, backupPath };
  }
}
