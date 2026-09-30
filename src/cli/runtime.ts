import path from 'node:path';
import readline from 'node:readline';
import { createPlatform, type Platform } from '../core/platform';
import { runProcess } from '../core/process/ProcessRunner';
import { createContext, type CoreContext } from '../core/context';
import { SettingsStore, isSandboxDir } from '../core/store/SettingsStore';
import { SkmError, toErrorData } from '../core/errors/SkmError';

export interface GlobalOptions {
  sshDir?: string;
}

export interface Runtime {
  ctx: CoreContext;
  platform: Platform;
  tmpDir: string;
}

// out/node/cli/*.js -> repo root (resources/ sits next to out/).
const ASKPASS = path.resolve(__dirname, '..', '..', '..', 'resources', 'askpass', 'askpass.cmd');

export async function createRuntime(opts: GlobalOptions): Promise<Runtime> {
  const platform = createPlatform(runProcess);
  const settings = await new SettingsStore(platform.paths).load();
  const sshDir = opts.sshDir ? path.resolve(opts.sshDir) : settings.sshDir;
  const sandbox = isSandboxDir(sshDir, platform.paths.defaultSshDir());
  if (!sandbox) process.stderr.write(`Lưu ý: đang dùng thư mục SSH thật (${sshDir}). Dùng --ssh-dir để chọn thư mục khác.\n`);
  const ctx = await createContext({
    sshDir,
    binDir: settings.binDir,
    run: runProcess,
    platform,
    ensureSshDir: sandbox,
    askpass: { helperPath: ASKPASS, nodeExe: process.execPath, nodeEnv: {} }
  });
  return { ctx, platform, tmpDir: path.join(platform.paths.appDataDir(), 'tmp') };
}

/** Prints a redacted Vietnamese error and sets a non-zero exit code. */
export function reportError(err: unknown, secrets: string[] = []): void {
  const data = toErrorData(err, secrets);
  process.stderr.write(`Lỗi: ${data.messageVi}\n`);
  if (data.detail) process.stderr.write(`\nChi tiết kỹ thuật:\n${data.detail.trim()}\n`);
  if (data.fix === 'fix-perms') process.stderr.write('\nGợi ý: chạy "skm fix-perms --all".\n');
  if (data.fix === 'add-to-agent') process.stderr.write('\nGợi ý: chạy "skm agent add <key>".\n');
  if (data.fix === 'start-agent') process.stderr.write('\nGợi ý: chạy "skm agent start".\n');
  process.exitCode = 1;
}

/** Reads a secret from the terminal without echoing it. Never accepts secrets as arguments. */
export function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return Promise.reject(new SkmError('INVALID_INPUT', 'Không có terminal để nhập passphrase. Dùng --passphrase-stdin (đọc dòng đầu tiên từ stdin) hoặc --no-passphrase.'));
  }
  return new Promise((resolve, reject) => {
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
    };
    const onData = (chunk: string): void => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          cleanup();
          process.stderr.write('\n');
          resolve(buf);
          return;
        }
        if (c === '\u0003') {
          cleanup();
          process.stderr.write('\n');
          reject(new SkmError('CANCELLED', 'Đã huỷ.'));
          return;
        }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

let stdinLines: string[] | null = null;

/** Reads the next line from piped stdin (for scripts). Lines are consumed in order. */
export async function readStdinLine(): Promise<string> {
  if (stdinLines === null) {
    if (process.stdin.isTTY) throw new SkmError('INVALID_INPUT', '--passphrase-stdin cần dữ liệu được pipe vào stdin.');
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    stdinLines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
  }
  const line = stdinLines.shift();
  if (line === undefined) throw new SkmError('INVALID_INPUT', 'stdin không đủ dòng passphrase.');
  return line;
}

/** Asks for a passphrase + confirmation on a TTY; from stdin the confirmation is not needed. */
export async function newPassphrase(fromStdin: boolean): Promise<string> {
  if (fromStdin) return readStdinLine();
  const a = await promptHidden('Passphrase mới (để trống = không có passphrase): ');
  const b = await promptHidden('Nhập lại passphrase: ');
  if (a !== b) throw new SkmError('INVALID_INPUT', 'Hai passphrase không khớp.');
  return a;
}

/** y/N confirmation; without a TTY the caller must pass --yes. */
export async function confirm(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) throw new SkmError('INVALID_INPUT', 'Thao tác này cần xác nhận. Thêm --yes để xác nhận khi chạy không có terminal.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => rl.question(`${question} [y/N] `, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}
