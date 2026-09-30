import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { OpenSshTool, PlatformPaths } from '../interfaces';

export class WinPaths implements PlatformPaths {
  defaultSshDir(): string {
    return path.join(os.homedir(), '.ssh');
  }

  appDataDir(): string {
    // Tests and e2e point this at a throwaway folder so they never touch real settings.
    const override = process.env.SKM_APPDATA_DIR;
    if (override) return path.resolve(override);
    const roaming = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(roaming, 'ssh-key-manager');
  }

  async findOpenSshBinDir(): Promise<string | null> {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const candidates = [
      path.join(systemRoot, 'System32', 'OpenSSH'),
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'OpenSSH'),
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'usr', 'bin')
    ];
    for (const dir of candidates) {
      try {
        await fs.access(path.join(dir, 'ssh-keygen.exe'));
        return dir;
      } catch {
        // try next candidate
      }
    }
    return null;
  }

  exe(binDir: string, tool: OpenSshTool): string {
    return path.join(binDir, `${tool}.exe`);
  }

  pipePath(id: string): string {
    return `\\\\.\\pipe\\${id}`;
  }
}
