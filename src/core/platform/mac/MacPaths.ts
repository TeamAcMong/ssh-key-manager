import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { OpenSshTool, PlatformPaths } from '../interfaces';
import { SkmError } from '../../errors/SkmError';

// sockaddr_un.sun_path is 104 bytes on macOS, including the terminating NUL.
export const MAX_SOCKET_PATH = 103;

// Apple's OpenSSH comes first: only it supports `ssh-add --apple-use-keychain`.
export const OPENSSH_CANDIDATES = ['/usr/bin', '/opt/homebrew/bin', '/usr/local/bin'];

export class MacPaths implements PlatformPaths {
  constructor(private readonly tmpDir: () => string = os.tmpdir) {}

  defaultSshDir(): string {
    return path.join(os.homedir(), '.ssh');
  }

  appDataDir(): string {
    const override = process.env.SKM_APPDATA_DIR;
    if (override) return path.resolve(override);
    return path.join(os.homedir(), 'Library', 'Application Support', 'ssh-key-manager');
  }

  async findOpenSshBinDir(): Promise<string | null> {
    for (const dir of OPENSSH_CANDIDATES) {
      try {
        await fs.access(path.join(dir, 'ssh-keygen'), fs.constants.X_OK);
        return dir;
      } catch {
        // try next candidate
      }
    }
    return null;
  }

  exe(binDir: string, tool: OpenSshTool): string {
    return path.join(binDir, tool);
  }

  /**
   * Unix socket in the per-user temp dir (mode 0700 on macOS). The name is a hash of the random id so the
   * path stays under the 104-byte socket limit even with a long TMPDIR; the broker token still authenticates.
   */
  pipePath(id: string): string {
    const name = `skm-${createHash('sha256').update(id).digest('hex').slice(0, 16)}.sock`;
    const full = path.join(this.tmpDir(), name);
    if (Buffer.byteLength(full) > MAX_SOCKET_PATH) {
      throw new SkmError('INVALID_INPUT', `Thư mục tạm quá dài để tạo Unix socket (${full}). Hãy đặt biến TMPDIR ngắn hơn.`);
    }
    return full;
  }
}
