import type { DetectedKeyType } from '../types';

export interface FingerprintLine {
  bits: number | null;
  fingerprint: string;
  comment: string;
  type: DetectedKeyType;
}

export function keyTypeFromLabel(label: string): DetectedKeyType {
  switch (label.toUpperCase()) {
    case 'ED25519':
      return 'ed25519';
    case 'RSA':
      return 'rsa';
    case 'ECDSA':
      return 'ecdsa';
    case 'DSA':
      return 'dsa';
    case 'ED25519-SK':
      return 'ed25519-sk';
    case 'ECDSA-SK':
      return 'ecdsa-sk';
    default:
      return 'unknown';
  }
}

export function keyTypeFromAlgorithm(algo: string): DetectedKeyType {
  if (algo === 'ssh-ed25519') return 'ed25519';
  if (algo === 'ssh-rsa') return 'rsa';
  if (algo.startsWith('ecdsa-sha2-')) return 'ecdsa';
  if (algo === 'ssh-dss') return 'dsa';
  if (algo === 'sk-ssh-ed25519@openssh.com') return 'ed25519-sk';
  if (algo === 'sk-ecdsa-sha2-nistp256@openssh.com') return 'ecdsa-sk';
  return 'unknown';
}

/**
 * Parses one line of `ssh-keygen -l` / `ssh-add -l`:
 *   "256 SHA256:abc... user@host (ED25519)"
 * The comment may contain spaces; OpenSSH prints "no comment" when it is empty.
 */
export function parseFingerprintLine(line: string): FingerprintLine | null {
  const m = /^(\d+)\s+(SHA256:[A-Za-z0-9+/=]+|MD5:[0-9a-f:]+)\s+(.*?)\s*\(([A-Z0-9-]+)\)\s*$/.exec(line.trim());
  if (!m) return null;
  const comment = m[3] ?? '';
  return {
    bits: Number(m[1]),
    fingerprint: m[2] ?? '',
    comment: comment === 'no comment' ? '' : comment,
    type: keyTypeFromLabel(m[4] ?? '')
  };
}

/** Parses every fingerprint line in a multi-line output (e.g. `ssh-add -l`). */
export function parseFingerprintList(output: string): FingerprintLine[] {
  return output
    .split(/\r?\n/)
    .map((l) => parseFingerprintLine(l))
    .filter((x): x is FingerprintLine => x !== null);
}

/** Extracts the randomart box from `ssh-keygen -lv` output. */
export function parseRandomart(output: string): string | null {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\+-+\[.*\]-*\+$/.test(l.trim()));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^\+-+\[SHA256\]-+\+$/.test(l.trim()));
  if (end < 0) return null;
  return lines.slice(start, end + 1).join('\n');
}

export interface PublicKeyLine {
  algorithm: string;
  base64: string;
  comment: string;
}

export function parsePublicKeyLine(text: string): PublicKeyLine | null {
  const m = /^\s*([a-z0-9@.-]+)\s+([A-Za-z0-9+/]+={0,3})(?:\s+(.*?))?\s*$/.exec(text.split(/\r?\n/)[0] ?? '');
  if (!m) return null;
  return { algorithm: m[1] ?? '', base64: m[2] ?? '', comment: m[3] ?? '' };
}

/** "SHA256:t/uddeqFFc6H…" style short form for list views. */
export function shortFingerprint(fp: string | null): string {
  if (!fp) return '';
  const body = fp.replace(/^SHA256:/, '');
  return body.length > 12 ? `${body.slice(0, 12)}…` : body;
}
