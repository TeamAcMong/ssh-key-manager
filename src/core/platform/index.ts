import type { Platform } from './interfaces';
import type { ProcessRunner } from '../process/ProcessRunner';
import { WinPaths } from './windows/WinPaths';
import { WinAcl } from './windows/WinAcl';
import { WinAgentService } from './windows/WinAgentService';
import { SkmError } from '../errors/SkmError';

export function createPlatform(run: ProcessRunner): Platform {
  if (process.platform === 'win32') {
    return { paths: new WinPaths(), permissions: new WinAcl(run), agentService: new WinAgentService(run) };
  }
  throw new SkmError('UNKNOWN', `Hệ điều hành ${process.platform} chưa được hỗ trợ (hiện chỉ hỗ trợ Windows).`);
}

export type { Platform, PlatformPaths, FilePermissionService, AgentService, OpenSshTool } from './interfaces';
