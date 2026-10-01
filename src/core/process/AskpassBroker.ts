import net from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Returns the secret for a prompt, or null to cancel (the tool then fails cleanly). */
export type AnswerFn = (prompt: string) => string | null;

export interface AskpassConfig {
  /** Absolute path to the helper in resources/askpass (askpass.cmd on Windows, askpass.sh on macOS). */
  helperPath: string;
  /** Executable that runs askpass.js (node, or the Electron binary with ELECTRON_RUN_AS_NODE). */
  nodeExe: string;
  /** Extra env for the helper runtime, e.g. { ELECTRON_RUN_AS_NODE: '1' }. */
  nodeEnv: Record<string, string>;
  /** Builds a platform IPC endpoint name (Windows named pipe / unix socket). */
  pipePath: (id: string) => string;
}

const MAX_REQUEST_BYTES = 4096;

/**
 * Hands secrets to ssh-keygen / ssh-add without putting them on the command line or in the
 * environment: OpenSSH runs the askpass helper (SSH_ASKPASS_REQUIRE=force), the helper asks
 * this broker over a one-shot named pipe, and prints the answer to OpenSSH on stdout.
 */
export class AskpassBroker {
  constructor(private readonly cfg: AskpassConfig) {}

  async withAnswers<T>(answer: AnswerFn, fn: (env: Record<string, string>) => Promise<T>): Promise<T> {
    const id = randomBytes(16).toString('hex');
    const token = randomBytes(32).toString('hex');
    const pipe = this.cfg.pipePath(`skm-askpass-${id}`);

    const server = net.createServer((sock) => {
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('data', (d: string) => {
        buf += d;
        if (buf.length > MAX_REQUEST_BYTES) {
          sock.destroy();
          return;
        }
        const nl = buf.indexOf('\n');
        if (nl < 0) return;
        let reply: { answer?: string; cancel?: boolean } = { cancel: true };
        try {
          const req = JSON.parse(buf.slice(0, nl)) as { token?: unknown; prompt?: unknown };
          if (typeof req.token === 'string' && safeEqual(req.token, token) && typeof req.prompt === 'string') {
            const a = answer(req.prompt);
            reply = a === null ? { cancel: true } : { answer: a };
          }
        } catch {
          reply = { cancel: true };
        }
        sock.end(JSON.stringify(reply) + '\n');
      });
      sock.on('error', () => sock.destroy());
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipe, () => {
        server.off('error', reject);
        resolve();
      });
    });

    try {
      return await fn({
        SSH_ASKPASS: this.cfg.helperPath,
        SSH_ASKPASS_REQUIRE: 'force',
        DISPLAY: 'skm',
        SKM_ASKPASS_PIPE: pipe,
        SKM_ASKPASS_TOKEN: token,
        SKM_ASKPASS_NODE: this.cfg.nodeExe,
        ...this.cfg.nodeEnv
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface PassphraseAnswers {
  /** Current passphrase of an existing key (ssh-keygen -p "old", ssh-add, ssh-keygen -y). */
  current?: string;
  /** New passphrase (generation, or ssh-keygen -p "new"); '' removes the passphrase. */
  next?: string;
}

/**
 * Maps OpenSSH prompts to answers. Each kind of prompt is answered at most once for "current"
 * (a repeated prompt means the passphrase was wrong) and twice for "next" (enter + confirm),
 * so a wrong passphrase can never loop forever.
 */
export function passphraseAnswerer(answers: PassphraseAnswers): AnswerFn {
  let currentAsked = 0;
  let nextAsked = 0;
  return (prompt) => {
    const p = prompt.toLowerCase();
    const isNext = p.includes('new passphrase') || p.includes('empty for no passphrase') || p.includes('same passphrase again');
    if (isNext) {
      if (answers.next === undefined || nextAsked >= 2) return null;
      nextAsked++;
      return answers.next;
    }
    if (p.includes('passphrase')) {
      if (answers.current === undefined || currentAsked >= 1) return null;
      currentAsked++;
      return answers.current;
    }
    // Unknown prompt (e.g. host key confirmation): never answer blindly.
    return null;
  };
}
