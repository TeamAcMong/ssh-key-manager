import path from 'node:path';
import type { ConnectionTestResult } from '../types';
import type { CoreContext } from '../context';
import { SkmError, toErrorData } from '../errors/SkmError';
import { mapSshError } from '../errors/errorMap';
import { exists } from '../store/fsutil';

// Git hosting services close the session with exit code 1 even when the key is accepted.
const AUTH_OK = /successfully authenticated|Welcome to GitLab|authenticated via (a deploy key|ssh key)|You can use git to connect|Shell access is not supported/i;

export function validateHost(host: unknown): string {
  if (typeof host !== 'string' || !/^[A-Za-z0-9._@%:[\]-]{1,255}$/.test(host) || host.startsWith('-')) {
    throw new SkmError('INVALID_INPUT', 'Tên host không hợp lệ.');
  }
  return host;
}

function quoteOpt(p: string): string {
  return `"${p.replace(/\\/g, '/')}"`;
}

export interface TestRunOptions {
  host: string;
  timeoutSec: number;
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void;
  signal?: AbortSignal;
}

export class ConnectionTester {
  constructor(private readonly ctx: Pick<CoreContext, 'sshDir' | 'bin' | 'run'>) {}

  /** Arguments are built so ssh only reads config/known_hosts from the configured SSH dir. */
  async buildArgs(host: string, timeoutSec: number): Promise<string[]> {
    const config = path.join(this.ctx.sshDir, 'config');
    const knownHosts = path.join(this.ctx.sshDir, 'known_hosts');
    return [
      '-T',
      '-o', 'BatchMode=yes',
      '-o', `ConnectTimeout=${timeoutSec}`,
      '-F', (await exists(config)) ? config : 'none',
      '-o', `UserKnownHostsFile=${quoteOpt(knownHosts)}`,
      '--',
      host
    ];
  }

  async run(opts: TestRunOptions): Promise<ConnectionTestResult> {
    const host = validateHost(opts.host);
    const timeoutSec = Math.min(Math.max(Math.trunc(opts.timeoutSec) || 10, 1), 120);
    const started = Date.now();
    try {
      const r = await this.ctx.run(this.ctx.bin.ssh, await this.buildArgs(host, timeoutSec), {
        timeoutMs: (timeoutSec + 5) * 1000,
        onStdout: (c) => opts.onOutput?.('stdout', c),
        onStderr: (c) => opts.onOutput?.('stderr', c),
        signal: opts.signal
      });
      const durationMs = Date.now() - started;
      if (r.cancelled) return { success: false, exitCode: r.code, durationMs, error: new SkmError('CANCELLED', 'Đã huỷ kiểm tra.').toData() };
      if (r.code === 0 || AUTH_OK.test(r.stdout + r.stderr)) return { success: true, exitCode: r.code, durationMs };
      const mapped = mapSshError(r.stderr, { timedOut: r.timedOut }) ?? new SkmError('PROCESS_FAILED', `ssh kết thúc với mã ${r.code ?? 'không rõ'}.`, r.stderr);
      return { success: false, exitCode: r.code, durationMs, error: mapped.toData() };
    } catch (err) {
      return { success: false, exitCode: null, durationMs: Date.now() - started, error: toErrorData(err) };
    }
  }
}
