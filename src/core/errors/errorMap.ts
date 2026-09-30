import { SkmError } from './SkmError';

interface Rule {
  test: RegExp;
  build: (stderr: string) => SkmError;
}

// Order matters: an unprotected key file is also followed by "Permission denied (publickey)",
// and the root cause is the file permission, not the server.
const RULES: Rule[] = [
  {
    test: /UNPROTECTED PRIVATE KEY FILE|bad permissions/i,
    build: (s) =>
      new SkmError(
        'UNPROTECTED_PRIVATE_KEY',
        'File private key có quyền truy cập quá rộng (người dùng khác cũng đọc được), nên OpenSSH từ chối dùng nó. Hãy sửa quyền file để chỉ tài khoản của bạn truy cập được.',
        s,
        'fix-perms'
      )
  },
  {
    test: /REMOTE HOST IDENTIFICATION HAS CHANGED/i,
    build: (s) =>
      new SkmError(
        'HOST_KEY_CHANGED',
        'Host key của máy chủ đã thay đổi so với lần trước. Có thể máy chủ vừa cài lại, hoặc đang có tấn công xen giữa (MITM). Hãy xác minh với quản trị viên trước khi xoá dòng cũ trong known_hosts.',
        s
      )
  },
  {
    test: /Host key verification failed/i,
    build: (s) =>
      new SkmError(
        'HOST_KEY_VERIFICATION_FAILED',
        'Không xác minh được host key của máy chủ: máy chủ chưa có trong known_hosts. Hãy kết nối thủ công một lần bằng ssh để kiểm tra và chấp nhận fingerprint.',
        s
      )
  },
  {
    test: /Could not open a connection to your authentication agent|Error connecting to agent|communication with agent failed|agent refused operation/i,
    build: (s) =>
      new SkmError('AGENT_NOT_RUNNING', 'Không kết nối được tới ssh-agent. Hãy khởi động service ssh-agent.', s, 'start-agent')
  },
  {
    test: /incorrect passphrase|bad passphrase/i,
    build: (s) => new SkmError('INCORRECT_PASSPHRASE', 'Passphrase không đúng.', s)
  },
  {
    test: /Permission denied \(publickey/i,
    build: (s) =>
      new SkmError(
        'PERMISSION_DENIED_PUBLICKEY',
        'Máy chủ từ chối key của bạn. Kiểm tra: public key đã được thêm lên máy chủ/dịch vụ chưa, đúng User chưa, và key đã được nạp vào ssh-agent hoặc khai báo IdentityFile trong config chưa.',
        s,
        'add-to-agent'
      )
  },
  {
    test: /Connection timed out|Operation timed out|timed out/i,
    build: (s) =>
      new SkmError(
        'CONNECTION_TIMEOUT',
        'Hết thời gian chờ kết nối. Kiểm tra địa chỉ máy chủ, cổng, mạng/VPN hoặc tường lửa.',
        s
      )
  },
  {
    test: /Connection refused/i,
    build: (s) =>
      new SkmError('CONNECTION_REFUSED', 'Máy chủ từ chối kết nối: sai cổng, hoặc dịch vụ SSH không chạy trên máy chủ.', s)
  },
  {
    test: /Could not resolve hostname|No such host is known|Name or service not known/i,
    build: (s) => new SkmError('HOST_NOT_FOUND', 'Không phân giải được tên máy chủ. Kiểm tra lại HostName.', s)
  }
];

/**
 * Maps OpenSSH stderr to a Vietnamese explanation.
 * Returns null when nothing matches; callers must then report a generic PROCESS_FAILED with the raw detail.
 */
export function mapSshError(stderr: string, opts: { timedOut?: boolean } = {}): SkmError | null {
  for (const rule of RULES) {
    if (rule.test.test(stderr)) return rule.build(stderr);
  }
  if (opts.timedOut) {
    return new SkmError('CONNECTION_TIMEOUT', 'Hết thời gian chờ. Tiến trình ssh đã bị dừng.', stderr);
  }
  return null;
}

export function processFailed(tool: string, code: number | null, stderr: string): SkmError {
  return mapSshError(stderr) ?? new SkmError('PROCESS_FAILED', `${tool} kết thúc với mã lỗi ${code ?? 'không rõ'}.`, stderr);
}
