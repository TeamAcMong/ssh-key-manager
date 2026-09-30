import { spawn } from 'node:child_process';
import { SkmError } from '../errors/SkmError';

export interface RunOptions {
  timeoutMs?: number;
  /** Extra variables merged over process.env. */
  env?: Record<string, string>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

export type ProcessRunner = (bin: string, args: readonly string[], opts?: RunOptions) => Promise<RunResult>;

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Runs a binary with an argument array. Never uses a shell, and stdin is closed so no tool
 * can block waiting for console input (secrets go through the askpass pipe instead).
 */
export const runProcess: ProcessRunner = (bin, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts.env ? { ...process.env, ...opts.env } : process.env
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      stdout += d;
      opts.onStdout?.(d);
    });
    child.stderr.on('data', (d: string) => {
      stderr += d;
      opts.onStderr?.(d);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const onAbort = (): void => {
      cancelled = true;
      child.kill();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (): void => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    };

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      finish();
      if (err.code === 'ENOENT') {
        reject(new SkmError('BINARY_NOT_FOUND', `Không tìm thấy chương trình: ${bin}. Kiểm tra đường dẫn OpenSSH trong Cài đặt.`));
      } else {
        reject(new SkmError('PROCESS_FAILED', `Không chạy được ${bin}.`, err.message));
      }
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      finish();
      resolve({ code, stdout, stderr, timedOut, cancelled });
    });
  });
