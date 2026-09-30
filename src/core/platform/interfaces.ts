import type { AclReport, AgentServiceStatus, AgentStartResult } from '../types';

export type OpenSshTool = 'ssh' | 'ssh-keygen' | 'ssh-add';

export interface PlatformPaths {
  defaultSshDir(): string;
  /** Directory for settings.json and metadata.json (shared by GUI and CLI). */
  appDataDir(): string;
  /** Auto-detects the directory holding the OpenSSH client binaries, or null. */
  findOpenSshBinDir(): Promise<string | null>;
  exe(binDir: string, tool: OpenSshTool): string;
  /** IPC endpoint used by the askpass broker. */
  pipePath(id: string): string;
}

export interface FilePermissionService {
  check(file: string): Promise<AclReport>;
  /** Removes every access entry except the current user's full control, then re-checks. */
  restrictToCurrentUser(file: string): Promise<AclReport>;
}

export interface AgentService {
  status(): Promise<AgentServiceStatus>;
  /** Tries to start the service; reports needsAdmin instead of failing silently. */
  start(): Promise<AgentStartResult>;
  /** Opens an elevated prompt (UAC) that enables and starts the service. Returns when the prompt was launched. */
  launchElevatedEnable(): Promise<void>;
}

export interface Platform {
  paths: PlatformPaths;
  permissions: FilePermissionService;
  agentService: AgentService;
}
