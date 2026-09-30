import os from 'node:os';
import type { Command } from 'commander';
import type { GenerateKeyRequest, KeyType } from '../../core/types';
import { KeyService } from '../../core/keys/KeyService';
import { SkmError } from '../../core/errors/SkmError';
import { validateNewKeyFileName } from '../../core/security/PathGuard';
import { exists } from '../../core/store/fsutil';
import { createRuntime, newPassphrase, reportError, type GlobalOptions } from '../runtime';
import { print, printJson, table, yesNo } from '../format';

function shortFp(fp: string | null): string {
  if (!fp) return '-';
  const body = fp.replace(/^SHA256:/, '');
  return body.length > 16 ? `${body.slice(0, 16)}…` : body;
}

export function registerKeyCommands(program: Command, globals: () => GlobalOptions): void {
  program
    .command('gen')
    .description('Tạo SSH key mới (mặc định Ed25519). Không bao giờ ghi đè key có sẵn.')
    .option('-t, --type <type>', 'ed25519 | rsa | ecdsa', 'ed25519')
    .option('-b, --bits <bits>', 'RSA: 3072 | 4096, ECDSA: 256 | 384 | 521')
    .option('-C, --comment <comment>', 'comment của key', `${os.userInfo().username}@${process.env.COMPUTERNAME ?? os.hostname()}`)
    .option('-f, --file <name>', 'tên file trong thư mục SSH (mặc định id_<type>)')
    .option('--passphrase-stdin', 'đọc passphrase từ dòng đầu tiên của stdin')
    .option('--no-passphrase', 'tạo key KHÔNG có passphrase (không hỏi)')
    .option('--json', 'in kết quả dạng JSON')
    .action(async (o: { type: string; bits?: string; comment: string; file?: string; passphraseStdin?: boolean; passphrase: boolean; json?: boolean }) => {
      let secret = '';
      try {
        const rt = await createRuntime(globals());
        const type = o.type as KeyType;
        const fileName = o.file ?? `id_${type}`;
        // Fail on name problems before asking for a passphrase.
        const nameErr = validateNewKeyFileName(fileName);
        if (nameErr) throw new SkmError('INVALID_INPUT', nameErr);
        const target = rt.ctx.guard.resolveFile(fileName);
        if ((await exists(target)) || (await exists(`${target}.pub`))) throw new SkmError('FILE_EXISTS', `File "${fileName}" hoặc "${fileName}.pub" đã tồn tại. Không ghi đè key có sẵn.`);
        if (o.passphrase !== false) secret = await newPassphrase(o.passphraseStdin === true);
        if (!secret) process.stderr.write('Cảnh báo: key KHÔNG có passphrase — ai lấy được file key đều dùng được ngay.\n');
        const req: GenerateKeyRequest = { type, comment: o.comment, fileName, passphrase: secret };
        if (o.bits !== undefined) req.bits = Number(o.bits);
        const d = await new KeyService(rt.ctx).generate(req);
        if (o.json) return printJson(d);
        print(`Đã tạo ${d.id} (${d.type.toUpperCase()} ${d.bits ?? ''}) trong ${rt.ctx.sshDir}`);
        print(`Fingerprint: ${d.fingerprint}`);
        print(d.randomart ?? '');
        print(`Public key:\n${d.publicKey ?? ''}`);
      } catch (err) {
        reportError(err, [secret]);
      }
    });

  program
    .command('list')
    .description('Liệt kê key trong thư mục SSH')
    .option('--json', 'in dạng JSON')
    .action(async (o: { json?: boolean }) => {
      try {
        const rt = await createRuntime(globals());
        const keys = await new KeyService(rt.ctx).list();
        if (o.json) return printJson(keys);
        if (keys.length === 0) return print(`Chưa có key nào trong ${rt.ctx.sshDir} — chạy "skm gen" để tạo.`);
        print(
          table(
            ['TÊN', 'LOẠI', 'BITS', 'FINGERPRINT', 'PASSPHRASE', 'QUYỀN FILE', 'TAGS'],
            keys.map((k) => [
              k.id,
              k.type.toUpperCase(),
              String(k.bits ?? '-'),
              shortFp(k.fingerprint),
              yesNo(k.hasPassphrase),
              k.aclSafe === null ? '-' : k.aclSafe ? 'an toàn' : 'KHÔNG AN TOÀN',
              k.tags.join(',')
            ])
          )
        );
        const unsafe = keys.filter((k) => k.aclSafe === false).length;
        if (unsafe) print(`\n${unsafe} key có quyền không an toàn — chạy "skm fix-perms --all".`);
        for (const k of keys.filter((x) => x.error)) process.stderr.write(`Cảnh báo (${k.id}): ${k.error}\n`);
      } catch (err) {
        reportError(err);
      }
    });

  program
    .command('info <key>')
    .description('Chi tiết một key: fingerprint, randomart, public key')
    .option('--json', 'in dạng JSON')
    .action(async (key: string, o: { json?: boolean }) => {
      try {
        const rt = await createRuntime(globals());
        const d = await new KeyService(rt.ctx).detail(key);
        if (o.json) return printJson(d);
        print(
          table(
            ['THUỘC TÍNH', 'GIÁ TRỊ'],
            [
              ['Tên', d.id],
              ['Loại', `${d.type.toUpperCase()} ${d.bits ?? ''}`.trim()],
              ['Fingerprint', d.fingerprint ?? '-'],
              ['Comment', d.comment || '-'],
              ['Ngày tạo', d.createdAt ? new Date(d.createdAt).toLocaleString('vi-VN') : '-'],
              ['Passphrase', yesNo(d.hasPassphrase)],
              ['Quyền file', d.aclSafe === null ? '-' : d.aclSafe ? 'an toàn' : 'KHÔNG AN TOÀN'],
              ['Tags', d.tags.join(', ') || '-'],
              ['Ghi chú', d.notes || '-']
            ]
          )
        );
        if (d.randomart) print(`\n${d.randomart}`);
        print(`\nPublic key:\n${d.publicKey ?? '(không có)'}`);
      } catch (err) {
        reportError(err);
      }
    });

  program
    .command('fix-perms [keys...]')
    .description('Sửa quyền file private key để chỉ tài khoản hiện tại truy cập được')
    .option('--all', 'sửa mọi key không an toàn trong thư mục SSH')
    .action(async (keys: string[], o: { all?: boolean }) => {
      try {
        if (!o.all && keys.length === 0) throw new SkmError('INVALID_INPUT', 'Chỉ định tên key hoặc dùng --all.');
        const rt = await createRuntime(globals());
        const svc = new KeyService(rt.ctx);
        const before = new Map((await svc.list()).map((k) => [k.id, k.aclSafe]));
        const reports = await svc.fixPermissions(o.all ? 'all' : keys);
        const rows = reports.map((r) => {
          const name = r.file.split(/[\\/]/).pop() ?? r.file;
          const was = before.get(name);
          return [name, was === false ? 'KHÔNG AN TOÀN' : 'an toàn', r.safe ? 'an toàn' : 'KHÔNG AN TOÀN', r.entries.map((e) => e.principal).join(', ')];
        });
        print(rows.length ? table(['KEY', 'TRƯỚC', 'SAU', 'AI ĐƯỢC TRUY CẬP'], rows) : 'Không có private key nào.');
      } catch (err) {
        reportError(err);
      }
    });
}
