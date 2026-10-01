import type { Command } from 'commander';
import { createTwoFilesPatch } from 'diff';
import { STRICT_HOST_KEY_CHECKING, type HostEdit, type HostEntry, type HostFields } from '../../core/types';
import { ConfigStore, identityFileRef } from '../../core/config/ConfigStore';
import { SkmError } from '../../core/errors/SkmError';
import { confirm, createRuntime, reportError, type GlobalOptions, type Runtime } from '../runtime';
import { print, table } from '../format';

interface HostOpts {
  hostname?: string;
  user?: string;
  port?: string;
  identity?: string;
  identitiesOnly?: string;
  strictHostKeyChecking?: string;
  yes?: boolean;
}

function findHost(hosts: HostEntry[], alias: string): HostEntry {
  const h = hosts.find((x) => x.kind === 'host' && x.patterns.includes(alias));
  if (!h) throw new SkmError('NOT_FOUND', `Không có Host "${alias}" trong config.`);
  return h;
}

/** Empty string on the command line = remove the directive. */
function apply(base: HostFields, o: HostOpts, rt: Runtime): HostFields {
  const f = { ...base };
  const val = (v: string | undefined, cur: string | null): string | null => (v === undefined ? cur : v === '' ? null : v);
  f.hostName = val(o.hostname, f.hostName);
  f.user = val(o.user, f.user);
  if (o.port !== undefined) f.port = o.port === '' ? null : Number(o.port);
  if (o.identity !== undefined) {
    // A bare key name refers to a key inside the SSH dir.
    const ref = o.identity === '' ? null : /[\\/~]/.test(o.identity) ? o.identity : identityFileRef(rt.ctx.sshDir, rt.platform.paths.defaultSshDir(), rt.ctx.guard.resolveFile(o.identity).split(/[\\/]/).pop() as string);
    f.identityFiles = ref ? [ref, ...f.identityFiles.slice(1)] : f.identityFiles.slice(1);
  }
  if (o.identitiesOnly !== undefined) {
    if (!['yes', 'no', ''].includes(o.identitiesOnly)) throw new SkmError('INVALID_INPUT', '--identities-only chỉ nhận yes, no hoặc "".');
    f.identitiesOnly = (o.identitiesOnly || null) as HostFields['identitiesOnly'];
  }
  if (o.strictHostKeyChecking !== undefined) {
    const v = o.strictHostKeyChecking.toLowerCase();
    if (v !== '' && !(STRICT_HOST_KEY_CHECKING as readonly string[]).includes(v)) throw new SkmError('INVALID_INPUT', `--strict-host-key-checking chỉ nhận ${STRICT_HOST_KEY_CHECKING.join(', ')} hoặc "".`);
    f.strictHostKeyChecking = (v || null) as HostFields['strictHostKeyChecking'];
  }
  return f;
}

/** Shows a unified diff, asks for confirmation (or --yes), then writes with backup. */
async function previewAndWrite(rt: Runtime, edits: HostEdit[], yes: boolean): Promise<void> {
  const store = new ConfigStore(rt.ctx);
  const p = await store.preview(edits);
  if (p.before === p.after) return print('Không có thay đổi nào.');
  print(createTwoFilesPatch('a/config', 'b/config', p.before, p.after, 'hiện tại', 'sau khi ghi', { context: 3 }));
  if (!(await confirm('Ghi thay đổi này vào config?', yes))) return print('Đã huỷ, không ghi gì.');
  const r = await store.write(edits, p.hash);
  print(`Đã ghi ${store.file}${r.backupPath ? `\nBản sao lưu: ${r.backupPath}` : ''}`);
}

function hostOptions(cmd: Command): Command {
  return cmd
    .option('--hostname <host>', 'HostName ("" để xoá)')
    .option('--user <user>', 'User ("" để xoá)')
    .option('--port <port>', 'Port ("" để xoá)')
    .option('--identity <key>', 'IdentityFile: tên key trong thư mục SSH hoặc đường dẫn ("" để xoá)')
    .option('--identities-only <yes|no>', 'IdentitiesOnly ("" để xoá)')
    .option('--strict-host-key-checking <value>', 'StrictHostKeyChecking: accept-new = tự thêm host key mới vào known_hosts nhưng vẫn chặn key bị đổi ("" để xoá)')
    .option('-y, --yes', 'không hỏi xác nhận trước khi ghi');
}

export function registerConfigCommands(program: Command, globals: () => GlobalOptions): void {
  const config = program.command('config').description('Xem/sửa các khối Host trong config (luôn hiện diff và sao lưu trước khi ghi)');

  config
    .command('list')
    .description('Liệt kê các khối Host/Match')
    .action(async () => {
      try {
        const rt = await createRuntime(globals());
        const snap = await new ConfigStore(rt.ctx).read();
        if (!snap.exists) return print(`Chưa có file ${snap.path}.`);
        if (snap.hosts.length === 0) return print('Config chưa có Host nào — dùng "skm config add <alias> ...".');
        print(
          table(
            ['HOST', 'HOSTNAME', 'USER', 'PORT', 'IDENTITYFILE', 'IDENTITIESONLY'],
            snap.hosts.map((h) => [
              h.kind === 'match' ? `Match ${h.patterns[0] ?? ''}` : h.patterns.join(' '),
              h.hostName ?? '-',
              h.user ?? '-',
              h.port === null ? '-' : String(h.port),
              h.identityFiles.join(', ') || '-',
              h.identitiesOnly ?? '-'
            ])
          )
        );
      } catch (err) {
        reportError(err);
      }
    });

  config
    .command('show')
    .description('In nguyên văn file config')
    .action(async () => {
      try {
        const rt = await createRuntime(globals());
        const snap = await new ConfigStore(rt.ctx).read();
        print(snap.exists ? snap.raw : `Chưa có file ${snap.path}.`);
      } catch (err) {
        reportError(err);
      }
    });

  hostOptions(config.command('add <alias...>').description('Thêm khối Host mới (đặt trước "Host *" nếu có)')).action(async (alias: string[], o: HostOpts) => {
    try {
      const rt = await createRuntime(globals());
      const snap = await new ConfigStore(rt.ctx).read();
      for (const a of alias) if (snap.hosts.some((h) => h.patterns.includes(a))) throw new SkmError('FILE_EXISTS', `Host "${a}" đã có trong config — dùng "skm config set".`);
      const fields = apply({ patterns: alias, hostName: null, user: null, port: null, identityFiles: [], identitiesOnly: null, strictHostKeyChecking: null }, o, rt);
      await previewAndWrite(rt, [{ op: 'add', fields }], o.yes === true);
    } catch (err) {
      reportError(err);
    }
  });

  hostOptions(config.command('set <alias>').description('Sửa khối Host có sẵn (chỉ đổi các trường được truyền)')).action(async (alias: string, o: HostOpts) => {
    try {
      const rt = await createRuntime(globals());
      const h = findHost((await new ConfigStore(rt.ctx).read()).hosts, alias);
      const fields = apply({ patterns: h.patterns, hostName: h.hostName, user: h.user, port: h.port, identityFiles: h.identityFiles, identitiesOnly: h.identitiesOnly, strictHostKeyChecking: h.strictHostKeyChecking }, o, rt);
      await previewAndWrite(rt, [{ op: 'update', index: h.index, fields }], o.yes === true);
    } catch (err) {
      reportError(err);
    }
  });

  config
    .command('rm <alias>')
    .description('Xoá khối Host')
    .option('-y, --yes', 'không hỏi xác nhận')
    .action(async (alias: string, o: { yes?: boolean }) => {
      try {
        const rt = await createRuntime(globals());
        const h = findHost((await new ConfigStore(rt.ctx).read()).hosts, alias);
        await previewAndWrite(rt, [{ op: 'delete', index: h.index }], o.yes === true);
      } catch (err) {
        reportError(err);
      }
    });
}
