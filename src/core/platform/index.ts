import type { Platform } from './interfaces';
import type { ProcessRunner } from '../process/ProcessRunner';
import { WinPaths } from './windows/WinPaths';
import { WinAcl } from './windows/WinAcl';
import { WinAgentService } from './windows/WinAgentService';
import { MacPaths } from './mac/MacPaths';
import { PosixPermissions } from './mac/PosixPermissions';
import { MacAgentService } from './mac/MacAgentService';
import { SkmError } from '../errors/SkmError';

export function createPlatform(run: ProcessRunner, os: NodeJS.Platform = process.platform): Platform {
  if (os === 'win32') {
    return {
      info: {
        os: 'windows',
        askpassHelper: 'askpass.cmd',
        agentKeychain: false,
        openSshMissingHint: 'Không tìm thấy OpenSSH (ssh-keygen.exe). Hãy cài "OpenSSH Client" của Windows hoặc chọn đường dẫn trong Cài đặt.'
      },
      paths: new WinPaths(),
      permissions: new WinAcl(run),
      agentService: new WinAgentService(run)
    };
  }
  if (os === 'darwin') {
    return {
      info: {
        os: 'macos',
        askpassHelper: 'askpass.sh',
        agentKeychain: true,
        openSshMissingHint: 'Không tìm thấy OpenSSH (ssh-keygen) trong /usr/bin, /opt/homebrew/bin hoặc /usr/local/bin. Hãy chọn đường dẫn trong Cài đặt.'
      },
      paths: new MacPaths(),
      permissions: new PosixPermissions(),
      agentService: new MacAgentService()
    };
  }
  throw new SkmError('UNKNOWN', `Hệ điều hành ${os} chưa được hỗ trợ (hiện hỗ trợ Windows và macOS).`);
}

export type { Platform, PlatformInfo, PlatformPaths, FilePermissionService, AgentService, OpenSshTool } from './interfaces';
