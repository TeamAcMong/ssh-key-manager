#!/usr/bin/env node
import { Command } from 'commander';
import type { GlobalOptions } from './runtime';
import { registerKeyCommands } from './commands/keys';
import { registerAgentCommands } from './commands/agent';
import { registerConfigCommands } from './commands/config';
import { registerTestCommand } from './commands/test';

const program = new Command();
program
  .name('skm')
  .description('SSH Key Manager — tạo và quản lý SSH key (OpenSSH trên Windows và macOS)')
  .version('0.1.3')
  .option('--ssh-dir <path>', 'thư mục SSH (mặc định theo Cài đặt, thường là ~/.ssh). Nên dùng thư mục sandbox khi thử nghiệm.')
  .showHelpAfterError();

const globals = (): GlobalOptions => program.opts<GlobalOptions>();
registerKeyCommands(program, globals);
registerAgentCommands(program, globals);
registerConfigCommands(program, globals);
registerTestCommand(program, globals);

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`Lỗi: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
