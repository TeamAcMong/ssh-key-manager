import { isNonKeyFileName } from '../security/PathGuard';

export type FileKind = 'private' | 'public' | 'other';

export interface ScannedFile {
  name: string;
  kind: FileKind;
}

export interface KeyFilePair {
  /** Private file name, or the .pub name when there is no private half. */
  id: string;
  privateFile: string | null;
  publicFile: string | null;
}

/** Classifies a file from its name and first bytes. Only the header is inspected. */
export function classifyFile(name: string, head: string): FileKind {
  if (isNonKeyFileName(name)) return 'other';
  const text = head.replace(/^﻿/, '').trimStart();
  if (/^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text) || /^PuTTY-User-Key-File-\d+:/.test(text)) return 'private';
  if (/^(ssh-(ed25519|rsa|dss)|ecdsa-sha2-nistp\d+|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com) /.test(text)) {
    // A public key must be in a .pub file to be paired; a bare public key file is still listed.
    return 'public';
  }
  return 'other';
}

/**
 * Pairs private keys with their "<name>.pub" sibling (case-insensitive, as on NTFS).
 * Public keys without a private half and private keys without a .pub are kept as their own entry.
 */
export function pairKeyFiles(files: readonly ScannedFile[]): KeyFilePair[] {
  const privates = files.filter((f) => f.kind === 'private');
  const publics = files.filter((f) => f.kind === 'public');
  const publicByLower = new Map(publics.map((p) => [p.name.toLowerCase(), p.name]));
  const usedPublics = new Set<string>();
  const pairs: KeyFilePair[] = [];

  for (const priv of privates) {
    const pubName = publicByLower.get(`${priv.name}.pub`.toLowerCase()) ?? null;
    if (pubName) usedPublics.add(pubName);
    pairs.push({ id: priv.name, privateFile: priv.name, publicFile: pubName });
  }
  for (const pub of publics) {
    if (!usedPublics.has(pub.name)) pairs.push({ id: pub.name, privateFile: null, publicFile: pub.name });
  }
  return pairs.sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: 'base' }));
}
