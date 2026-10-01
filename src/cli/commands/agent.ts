import type { Command } from 'commander';
import { AgentKeys } from '../../core/agent/AgentKeys';
import { KeyService } from '../../core/keys/KeyService';
import { SkmError } from '../../core/errors/SkmError';
import { createRuntime, promptHidden, readStdinLine, reportError, type GlobalOptions } from '../runtime';
import { print, table } from '../format';

const STATE_VI: Record<string, string> = {
  running: 'Đang chạy',
  stopped: 'Đã dừng',
  disabled: 'Bị tắt (Disabled)',
  'not-installed': 'Chưa cài',
  unknown: 'Không rõ'
};

export function registerAgentCommands(program: Command, globals: () => GlobalOptions): void {
  const agent = program.command('agent').description('Quản lý ssh-agent');

  agent
    .command('status')
    .description('Trạng thái service ssh-agent')
    .action(async () => {
      try {
        const rt = await createRuntime(globals());
        const st = await rt.platform.agentService.status();
        print(`ssh-agent: ${STATE_VI[st.state] ?? st.state} (kiểu khởi động: ${st.startType ?? '-'})`);
        if (st.state !== 'running' && rt.platform.info.os === 'macos') print('Chạy "skm agent start" để xem cách bật lại.');
      } catch (err) {
        reportError(err);
      }
    });

  agent
    .command('start')
    .description('Khởi động ssh-agent (Windows: báo rõ nếu cần quyền Administrator)')
    .action(async () => {
      try {
        const rt = await createRuntime(globals());
        const r = await rt.platform.agentService.start();
        print(r.messageVi);
        if (r.needsAdmin) {
          print(`\nChạy lệnh sau trong cửa sổ PowerShell/CMD "Run as administrator":\n  ${r.adminCommand ?? ''}`);
          process.exitCode = 2;
        } else if (!r.started) {
          if (r.adminCommand) print(`\n  ${r.adminCommand}`);
          process.exitCode = 2;
        }
      } catch (err) {
        reportError(err);
      }
    });

  agent
    .command('list')
    .description('Key đang nạp trong agent')
    .action(async () => {
      try {
        const rt = await createRuntime(globals());
        const keys = await new AgentKeys(rt.ctx).list();
        if (keys.length === 0) return print('Agent chưa có key nào.');
        print(table(['LOẠI', 'BITS', 'FINGERPRINT', 'COMMENT'], keys.map((k) => [k.type.toUpperCase(), String(k.bits ?? '-'), k.fingerprint, k.comment])));
      } catch (err) {
        reportError(err);
      }
    });

  agent
    .command('add <key>')
    .description('Thêm key trong thư mục SSH vào agent (hỏi passphrase nếu key có passphrase)')
    .option('--passphrase-stdin', 'đọc passphrase từ dòng đầu tiên của stdin')
    .option('--keychain', 'macOS: lưu passphrase vào Keychain (ssh-add --apple-use-keychain)')
    .action(async (key: string, o: { passphraseStdin?: boolean; keychain?: boolean }) => {
      let secret: string | undefined;
      try {
        const rt = await createRuntime(globals());
        const keys = new KeyService(rt.ctx);
        const d = await keys.detail(key);
        if (d.hasPassphrase) secret = o.passphraseStdin ? await readStdinLine() : await promptHidden(`Passphrase của ${d.id}: `);
        await new AgentKeys(rt.ctx).add(await keys.privateKeyPath(key), secret, { useKeychain: o.keychain === true });
        print(`Đã thêm ${d.id} (${d.fingerprint}) vào ssh-agent.`);
        if (rt.platform.info.os === 'windows') print('Lưu ý: Windows ssh-agent giữ key này cả sau khi khởi động lại máy. Gỡ bằng "skm agent remove".');
        else if (!o.keychain && d.hasPassphrase) print('Lưu ý: ssh-agent của macOS quên key khi đăng xuất. Thêm --keychain để lưu passphrase vào Keychain.');
      } catch (err) {
        reportError(err, secret ? [secret] : []);
      }
    });

  agent
    .command('remove <keyOrFingerprint>')
    .description('Gỡ key khỏi agent (theo tên key trong thư mục SSH hoặc theo fingerprint SHA256:...)')
    .action(async (target: string) => {
      try {
        const rt = await createRuntime(globals());
        let fingerprint = target;
        if (!/^SHA256:/.test(target)) {
          const d = await new KeyService(rt.ctx).detail(target);
          if (!d.fingerprint) throw new SkmError('NOT_FOUND', `Không đọc được fingerprint của ${target}.`);
          fingerprint = d.fingerprint;
        }
        await new AgentKeys(rt.ctx).removeByFingerprint(fingerprint, rt.tmpDir);
        print(`Đã gỡ ${fingerprint} khỏi ssh-agent.`);
      } catch (err) {
        reportError(err);
      }
    });
}
