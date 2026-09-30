import { describe, expect, it } from 'vitest';
import { parseFingerprintLine, parseFingerprintList, parsePublicKeyLine, parseRandomart, shortFingerprint } from '../../src/core/keys/fingerprint';
import { classifyFile, pairKeyFiles } from '../../src/core/keys/pairing';
import { evaluateAcl, parseIcacls } from '../../src/core/platform/windows/WinAcl';
import { parseServiceStatus } from '../../src/core/platform/windows/WinAgentService';

describe('fingerprint parsing', () => {
  it('parses ssh-keygen -l output with spaces in the comment', () => {
    expect(parseFingerprintLine('256 SHA256:t/uddeqFFc6HTj++qSXVGXy47DzYS5iUbDzhT8/AGCI my laptop key (ED25519)\r\n')).toEqual({
      bits: 256,
      fingerprint: 'SHA256:t/uddeqFFc6HTj++qSXVGXy47DzYS5iUbDzhT8/AGCI',
      comment: 'my laptop key',
      type: 'ed25519'
    });
  });

  it('maps "no comment" to empty and recognises RSA/ECDSA/SK types', () => {
    expect(parseFingerprintLine('3072 SHA256:abc no comment (RSA)')).toMatchObject({ comment: '', type: 'rsa', bits: 3072 });
    expect(parseFingerprintLine('521 SHA256:abc x (ECDSA)')?.type).toBe('ecdsa');
    expect(parseFingerprintLine('256 SHA256:abc x (ED25519-SK)')?.type).toBe('ed25519-sk');
    expect(parseFingerprintLine('garbage')).toBeNull();
  });

  it('parses ssh-add -l lists and ignores other lines', () => {
    const out = '256 SHA256:aaa a@b (ED25519)\n4096 SHA256:bbb c (RSA)\nThe agent has no identities.\n';
    expect(parseFingerprintList(out).map((f) => f.fingerprint)).toEqual(['SHA256:aaa', 'SHA256:bbb']);
  });

  it('extracts the randomart box', () => {
    const out = [
      '256 SHA256:abc spike (ED25519)',
      '+--[ED25519 256]--+',
      '|        E . o .+.|',
      '+----[SHA256]-----+',
      ''
    ].join('\r\n');
    expect(parseRandomart(out)).toBe('+--[ED25519 256]--+\n|        E . o .+.|\n+----[SHA256]-----+');
    expect(parseRandomart('nothing')).toBeNull();
  });

  it('parses public key lines and shortens fingerprints', () => {
    expect(parsePublicKeyLine('ssh-ed25519 AAAAC3Nz user@host\n')).toEqual({ algorithm: 'ssh-ed25519', base64: 'AAAAC3Nz', comment: 'user@host' });
    expect(parsePublicKeyLine('-----BEGIN OPENSSH PRIVATE KEY-----')).toBeNull();
    expect(shortFingerprint('SHA256:t/uddeqFFc6HTj++qSX')).toBe('t/uddeqFFc6H…');
  });
});

describe('key pairing', () => {
  it('classifies files by header, not by name', () => {
    expect(classifyFile('id_ed25519', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn')).toBe('private');
    expect(classifyFile('server.pem', '-----BEGIN RSA PRIVATE KEY-----')).toBe('private');
    expect(classifyFile('work.ppk', 'PuTTY-User-Key-File-3: ssh-ed25519')).toBe('private');
    expect(classifyFile('id_ed25519.pub', 'ssh-ed25519 AAAA x')).toBe('public');
    expect(classifyFile('config', 'Host *')).toBe('other');
    expect(classifyFile('known_hosts', 'ssh-ed25519 AAAA')).toBe('other');
    expect(classifyFile('notes.txt', 'hello')).toBe('other');
  });

  it('pairs private/public case-insensitively and keeps orphans', () => {
    const pairs = pairKeyFiles([
      { name: 'id_ed25519', kind: 'private' },
      { name: 'ID_ED25519.pub', kind: 'public' },
      { name: 'id_rsa', kind: 'private' },
      { name: 'github.pub', kind: 'public' },
      { name: 'config', kind: 'other' }
    ]);
    expect(pairs).toEqual([
      { id: 'github.pub', privateFile: null, publicFile: 'github.pub' },
      { id: 'id_ed25519', privateFile: 'id_ed25519', publicFile: 'ID_ED25519.pub' },
      { id: 'id_rsa', privateFile: 'id_rsa', publicFile: null }
    ]);
  });
});

describe('Windows parsers', () => {
  const file = 'C:\\sandbox\\id_test';
  const icacls = [
    `${file} NT AUTHORITY\\SYSTEM:(I)(F)`,
    '            BUILTIN\\Administrators:(I)(F)',
    '            DESKTOP-1\\user:(F)',
    '            NT AUTHORITY\\Authenticated Users:(I)(M)',
    '            Everyone:(DENY)(W)',
    '',
    'Successfully processed 1 files; Failed processing 0 files',
    ''
  ].join('\r\n');

  it('parses icacls entries including principals with spaces', () => {
    const entries = parseIcacls(icacls, file);
    expect(entries.map((e) => e.principal)).toEqual(['NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators', 'DESKTOP-1\\user', 'NT AUTHORITY\\Authenticated Users', 'Everyone']);
    expect(entries[0]).toMatchObject({ inherited: true, deny: false });
    expect(entries[4]).toMatchObject({ deny: true });
  });

  it('flags principals outside user/SYSTEM/Administrators and ignores deny entries', () => {
    const report = evaluateAcl(file, parseIcacls(icacls, file), 'DESKTOP-1\\user');
    expect(report.safe).toBe(false);
    expect(report.offending).toEqual(['NT AUTHORITY\\Authenticated Users']);
    const onlyUser = evaluateAcl(file, parseIcacls(`${file} DESKTOP-1\\user:(F)\r\n`, file), 'DESKTOP-1\\user');
    expect(onlyUser).toMatchObject({ safe: true, offending: [] });
  });

  it('parses sc query/qc output by numeric codes', () => {
    const qc = (n: number, s: string): string => `        START_TYPE         : ${n}   ${s}\r\n`;
    expect(parseServiceStatus('        STATE              : 4  RUNNING\r\n', qc(2, 'AUTO_START'))).toEqual({ state: 'running', startType: 'AUTO_START' });
    expect(parseServiceStatus('        STATE              : 1  STOPPED\r\n', qc(3, 'DEMAND_START'))).toEqual({ state: 'stopped', startType: 'DEMAND_START' });
    expect(parseServiceStatus('        STATE              : 1  STOPPED\r\n', qc(4, 'DISABLED'))).toEqual({ state: 'disabled', startType: 'DISABLED' });
    expect(parseServiceStatus('[SC] EnumQueryServicesStatus:OpenService FAILED 1060:', '').state).toBe('not-installed');
  });
});
