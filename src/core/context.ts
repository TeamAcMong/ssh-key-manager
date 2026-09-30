import fs from 'node:fs/promises';
import type { Platform } from './platform/interfaces';
import type { ProcessRunner } from './process/ProcessRunner';
import { AskpassBroker, type AskpassConfig } from './process/AskpassBroker';
import { PathGuard } from './security/PathGuard';
import { MetadataStore } from './store/MetadataStore';
import { SkmError } from './errors/SkmError';

/** Everything a core service needs, bound to one SSH directory. */
export interface CoreContext {
  sshDir: string;
  guard: PathGuard;
  bin: { ssh: string; keygen: string; add: string };
  run: ProcessRunner;
  askpass: AskpassBroker;
  platform: Platform;
  metadata: MetadataStore;
}

export interface CreateContextOptions {
  sshDir: string;
  binDir: string | null;
  run: ProcessRunner;
  platform: Platform;
  askpass: Omit<AskpassConfig, 'pipePath'>;
}

/** Creates the SSH dir (and parents) when missing; refuses if the path is a file. */
export async function ensureSshDir(dir: string): Promise<void> {
  const st = await fs.stat(dir).catch(() => null);
  if (st?.isDirectory()) return;
  if (st) throw new SkmError('INVALID_INPUT', `Đường dẫn thư mục SSH đang là một file, không phải thư mục: ${dir}`);
  await fs.mkdir(dir, { recursive: true });
}

export async function createContext(opts: CreateContextOptions): Promise<CoreContext> {
  const binDir = opts.binDir ?? (await opts.platform.paths.findOpenSshBinDir());
  if (!binDir) {
    throw new SkmError('BINARY_NOT_FOUND', 'Không tìm thấy OpenSSH (ssh-keygen.exe). Hãy cài "OpenSSH Client" của Windows hoặc chọn đường dẫn trong Cài đặt.');
  }
  const guard = new PathGuard(opts.sshDir);
  await ensureSshDir(guard.root);
  const paths = opts.platform.paths;
  return {
    sshDir: guard.root,
    guard,
    bin: { ssh: paths.exe(binDir, 'ssh'), keygen: paths.exe(binDir, 'ssh-keygen'), add: paths.exe(binDir, 'ssh-add') },
    run: opts.run,
    askpass: new AskpassBroker({ ...opts.askpass, pipePath: (id) => paths.pipePath(id) }),
    platform: opts.platform,
    metadata: new MetadataStore(paths.appDataDir())
  };
}

export async function opensshVersion(ctx: Pick<CoreContext, 'bin' | 'run'>): Promise<string | null> {
  try {
    const r = await ctx.run(ctx.bin.ssh, ['-V'], { timeoutMs: 5000 });
    const text = (r.stderr || r.stdout).trim();
    return text.split(/[,\r\n]/)[0] || null;
  } catch {
    return null;
  }
}
