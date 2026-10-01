import net from 'node:net';
import type { AgentServiceStatus, AgentStartResult } from '../../types';
import type { AgentService } from '../interfaces';
import { SkmError } from '../../errors/SkmError';

/** launchd job that serves the per-user agent socket (socket-activated: it starts on first connect). */
export const LAUNCHD_ENABLE_COMMAND =
  'launchctl enable gui/$(id -u)/com.openssh.ssh-agent && launchctl kickstart -k gui/$(id -u)/com.openssh.ssh-agent';

/** Resolves true when something accepts a connection on the socket within the timeout. */
export function canConnect(socketPath: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(socketPath);
    const done = (ok: boolean): void => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/**
 * macOS has no service to start: launchd gives every login session an agent socket in SSH_AUTH_SOCK.
 * "Running" therefore means the socket accepts connections.
 */
export class MacAgentService implements AgentService {
  constructor(
    private readonly env: () => NodeJS.ProcessEnv = () => process.env,
    private readonly connect: (socketPath: string) => Promise<boolean> = canConnect
  ) {}

  async status(): Promise<AgentServiceStatus> {
    const sock = this.env().SSH_AUTH_SOCK;
    if (!sock) return { state: 'stopped', startType: 'launchd' };
    return { state: (await this.connect(sock)) ? 'running' : 'stopped', startType: 'launchd' };
  }

  async start(): Promise<AgentStartResult> {
    const st = await this.status();
    if (st.state === 'running') return { started: true, needsAdmin: false, messageVi: 'ssh-agent đang chạy.' };
    const why = this.env().SSH_AUTH_SOCK
      ? 'Không kết nối được tới socket của ssh-agent (job launchd com.openssh.ssh-agent có thể đã bị tắt).'
      : 'Ứng dụng không nhận được biến SSH_AUTH_SOCK, nên không tìm thấy ssh-agent của phiên đăng nhập.';
    return {
      started: false,
      needsAdmin: false,
      adminCommand: LAUNCHD_ENABLE_COMMAND,
      messageVi: `${why} macOS tự chạy ssh-agent qua launchd. Hãy chạy lệnh dưới đây trong Terminal (không cần sudo), rồi đăng xuất và đăng nhập lại.`
    };
  }

  async launchElevatedEnable(): Promise<void> {
    throw new SkmError('INVALID_INPUT', 'macOS không cần quyền quản trị để bật ssh-agent.');
  }
}
