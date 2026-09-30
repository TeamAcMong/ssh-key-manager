// Removes secrets from any text before it reaches a log, an error, IPC or the CLI output.

const PEM_PRIVATE_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;
const PUTTY_PRIVATE_LINES = /Private-Lines:\s*\d+[\s\S]*?(?=Private-MAC:|$)/g;

export const REDACTED = '[REDACTED]';

export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text.replace(PEM_PRIVATE_BLOCK, '[REDACTED PRIVATE KEY BLOCK]').replace(PUTTY_PRIVATE_LINES, 'Private-Lines: [REDACTED]\n');
  // Longest first so a secret that contains another one is fully masked.
  const sorted = [...secrets].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
  for (const secret of sorted) {
    out = out.split(secret).join(REDACTED);
  }
  return out;
}

/** True when the text contains something that looks like private key material. */
export function containsPrivateKeyMaterial(text: string): boolean {
  return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text) || /PuTTY-User-Key-File-\d+:/.test(text);
}
