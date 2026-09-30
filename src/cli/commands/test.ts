import type { Command } from 'commander';
import { ConnectionTester } from '../../core/test/ConnectionTester';
import { SkmError } from '../../core/errors/SkmError';
import { createRuntime, reportError, type GlobalOptions } from '../runtime';
import { print } from '../format';

export function registerTestCommand(program: Command, globals: () => GlobalOptions): void {
  program
    .command('test <host>')
    .description('Chạy "ssh -T -o BatchMode=yes <host>" và giải thích lỗi')
    .option('--timeout <sec>', 'timeout kết nối (giây, 1-120)', '10')
    .action(async (host: string, o: { timeout: string }) => {
      try {
        const rt = await createRuntime(globals());
        const ac = new AbortController();
        process.once('SIGINT', () => ac.abort());
        print(`> ssh -T -o BatchMode=yes ${host}`);
        const r = await new ConnectionTester(rt.ctx).run({
          host,
          timeoutSec: Number(o.timeout),
          signal: ac.signal,
          onOutput: (stream, chunk) => (stream === 'stdout' ? process.stdout : process.stderr).write(chunk)
        });
        if (r.success) return print(`\nThành công: kết nối và xác thực được (${r.durationMs} ms).`);
        throw r.error ? new SkmError(r.error.code, r.error.messageVi, r.error.detail, r.error.fix) : new SkmError('PROCESS_FAILED', 'Kết nối thất bại.');
      } catch (err) {
        reportError(err);
      }
    });
}
