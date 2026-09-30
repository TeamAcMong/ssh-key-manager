import path from 'node:path';
import type { AgentServiceStatus, AgentStartResult } from '../../types';
import type { AgentService } from '../interfaces';
import type { ProcessRunner } from '../../process/ProcessRunner';
import { SkmError } from '../../errors/SkmError';

const SYSTEM32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const SC = path.join(SYSTEM32, 'sc.exe');
const POWERSHELL = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const SERVICE = 'ssh-agent';

export const ADMIN_ENABLE_COMMAND = 'sc.exe config ssh-agent start= auto && sc.exe start ssh-agent';

/** Parses `sc query` + `sc qc` output. Uses the numeric codes, which are not localized. */
export function parseServiceStatus(queryOut: string, qcOut: string): AgentServiceStatus {
  if (/FAILED\s+1060/.test(queryOut)) return { state: 'not-installed', startType: null };
  const stateNum = /STATE\s*:\s*(\d+)/.exec(queryOut)?.[1];
  const startMatch = /START_TYPE\s*:\s*(\d+)\s+(\S+)/.exec(qcOut);
  const startType = startMatch?.[2] ?? null;
  if (startMatch?.[1] === '4') return { state: 'disabled', startType };
  if (stateNum === '4') return { state: 'running', startType };
  if (stateNum === '1') return { state: 'stopped', startType };
  return { state: 'unknown', startType };
}

export class WinAgentService implements AgentService {
  constructor(private readonly run: ProcessRunner) {}

  async status(): Promise<AgentServiceStatus> {
    const q = await this.run(SC, ['query', SERVICE], { timeoutMs: 10_000 });
    const qc = await this.run(SC, ['qc', SERVICE], { timeoutMs: 10_000 });
    return parseServiceStatus(q.stdout + q.stderr, qc.stdout + qc.stderr);
  }

  async start(): Promise<AgentStartResult> {
    const before = await this.status();
    if (before.state === 'running') return { started: true, needsAdmin: false, messageVi: 'ssh-agent đang chạy.' };
    if (before.state === 'not-installed') {
      throw new SkmError('NOT_FOUND', 'Máy chưa cài service ssh-agent (tính năng OpenSSH Client của Windows).');
    }
    if (before.state === 'disabled') {
      return {
        started: false,
        needsAdmin: true,
        adminCommand: ADMIN_ENABLE_COMMAND,
        messageVi: 'Service ssh-agent đang bị tắt (Disabled). Cần quyền Administrator để bật service (một lần duy nhất).'
      };
    }
    const r = await this.run(SC, ['start', SERVICE], { timeoutMs: 15_000 });
    const out = r.stdout + r.stderr;
    if (/FAILED\s+5\b/.test(out)) {
      return {
        started: false,
        needsAdmin: true,
        adminCommand: ADMIN_ENABLE_COMMAND,
        messageVi: 'Windows từ chối (Access denied): tài khoản hiện tại không có quyền khởi động service. Cần chạy với quyền Administrator.'
      };
    }
    if (/FAILED\s+1058\b/.test(out)) {
      return { started: false, needsAdmin: true, adminCommand: ADMIN_ENABLE_COMMAND, messageVi: 'Service ssh-agent đang bị tắt. Cần quyền Administrator để bật.' };
    }
    if (r.code !== 0 && !/FAILED\s+1056\b/.test(out)) {
      throw new SkmError('PROCESS_FAILED', 'Không khởi động được ssh-agent.', out);
    }
    return { started: true, needsAdmin: false, messageVi: 'Đã khởi động ssh-agent.' };
  }

  async launchElevatedEnable(): Promise<void> {
    // Constant script, no user input. Start-Process -Verb RunAs shows the UAC prompt.
    const script = `Start-Process -FilePath cmd.exe -ArgumentList '/c','${ADMIN_ENABLE_COMMAND}' -Verb RunAs -WindowStyle Hidden -Wait`;
    const r = await this.run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 120_000 });
    if (r.code !== 0) {
      throw new SkmError('AGENT_NEEDS_ADMIN', 'Không được cấp quyền Administrator (UAC bị huỷ hoặc bị chặn).', r.stderr);
    }
  }
}
