import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapSshError } from '../../src/core/errors/errorMap';
import { SkmError, toErrorData } from '../../src/core/errors/SkmError';
import { PathGuard, validateNewKeyFileName } from '../../src/core/security/PathGuard';
import { containsPrivateKeyMaterial, redact } from '../../src/core/security/redact';
import { passphraseAnswerer } from '../../src/core/process/AskpassBroker';
import { validateNotes, validateTags } from '../../src/core/store/MetadataStore';
import { validateHost } from '../../src/core/test/ConnectionTester';

const FAKE_KEY = ['-----BEGIN OPENSSH PRIVATE KEY-----', 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmU=', '-----END OPENSSH PRIVATE KEY-----'].join('\n');

describe('error mapping', () => {
  const cases: [string, string][] = [
    ['git@github.com: Permission denied (publickey).', 'PERMISSION_DENIED_PUBLICKEY'],
    ['Host key verification failed.', 'HOST_KEY_VERIFICATION_FAILED'],
    ['ssh: connect to host 10.255.255.1 port 22: Connection timed out', 'CONNECTION_TIMEOUT'],
    ['ssh: connect to host 127.0.0.1 port 1: Connection refused', 'CONNECTION_REFUSED'],
    ['ssh: Could not resolve hostname nope: No such host is known.', 'HOST_NOT_FOUND'],
    ['@@@ WARNING: UNPROTECTED PRIVATE KEY FILE! @@@\nPermissions for \'k\' are too open.\nPermission denied (publickey).', 'UNPROTECTED_PRIVATE_KEY'],
    ['@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed.', 'HOST_KEY_CHANGED'],
    ['Error connecting to agent: No such file or directory', 'AGENT_NOT_RUNNING']
  ];
  for (const [stderr, code] of cases) {
    it(`maps to ${code}`, () => {
      const e = mapSshError(stderr);
      expect(e?.code).toBe(code);
      expect(e?.messageVi.length).toBeGreaterThan(10);
    });
  }

  it('suggests a fix button where one exists', () => {
    expect(mapSshError('UNPROTECTED PRIVATE KEY FILE')?.fix).toBe('fix-perms');
    expect(mapSshError('Permission denied (publickey)')?.fix).toBe('add-to-agent');
  });

  it('returns null for unknown output, timeout when the process was killed', () => {
    expect(mapSshError('something else')).toBeNull();
    expect(mapSshError('', { timedOut: true })?.code).toBe('CONNECTION_TIMEOUT');
  });
});

describe('redaction', () => {
  it('removes private key blocks, even unterminated ones, and given secrets', () => {
    const out = redact(`before\n${FAKE_KEY}\nafter pass=hunter22`, ['hunter22']);
    expect(out).not.toContain('b3BlbnNzaC1rZXkt');
    expect(out).not.toContain('hunter22');
    expect(out).toContain('before');
    expect(redact('-----BEGIN RSA PRIVATE KEY-----\nMIIE')).not.toContain('MIIE');
  });

  it('redacts errors converted for IPC', () => {
    const data = toErrorData(new SkmError('PROCESS_FAILED', 'x', `oops ${FAKE_KEY} secretpw`), ['secretpw']);
    expect(data.detail).not.toContain('secretpw');
    expect(containsPrivateKeyMaterial(data.detail ?? '')).toBe(false);
    expect(toErrorData(new Error('plain secretpw'), ['secretpw']).detail).toBe('plain [REDACTED]');
  });
});

describe('path validation', () => {
  const root = path.resolve('C:/sandbox/ssh');
  const guard = new PathGuard(root);

  it('resolves bare file names inside the root', () => {
    expect(guard.resolveFile('id_ed25519')).toBe(path.join(root, 'id_ed25519'));
  });

  it.each(['../evil', '..\\evil', 'sub/key', 'C:\\Windows\\x', 'C:evil', '..', '.', '', 'a\0b', '\\\\server\\share\\k'])('rejects %j', (name) => {
    expect(() => guard.resolveFile(name)).toThrow(SkmError);
  });

  it('rejects absolute paths outside the root, including sibling prefixes', () => {
    expect(() => guard.assertInside(path.resolve('C:/sandbox/ssh-evil/k'))).toThrow();
    expect(() => guard.assertInside(root)).toThrow();
    expect(() => guard.assertInside(path.join(root, 'k'))).not.toThrow();
    // path.relative only ignores case on Windows; elsewhere a differently-cased root is a different directory.
    const upperCased = () => guard.assertInside(path.join(root.toUpperCase(), 'k'));
    if (process.platform === 'win32') expect(upperCased).not.toThrow();
    else expect(upperCased).toThrow(SkmError);
  });

  it('validates new key file names', () => {
    expect(validateNewKeyFileName('id_ed25519_work')).toBeNull();
    for (const bad of ['', 'a b', 'con', 'NUL.txt', 'x.pub', 'config', 'known_hosts', '.hidden', 'a.', 'x/y', 'x'.repeat(101), 'k.bak']) {
      expect(validateNewKeyFileName(bad), bad).not.toBeNull();
    }
  });

  it('validates hosts for the connection test (no option injection)', () => {
    expect(validateHost('git@github.com')).toBe('git@github.com');
    for (const bad of ['-oProxyCommand=calc', 'a b', 'a;b', '', 'x'.repeat(256)]) expect(() => validateHost(bad)).toThrow();
  });
});

describe('askpass answers', () => {
  it('answers generation prompts twice and refuses a third time', () => {
    const a = passphraseAnswerer({ next: 'newpass' });
    expect(a('Enter passphrase (empty for no passphrase): ')).toBe('newpass');
    expect(a('Enter same passphrase again: ')).toBe('newpass');
    expect(a('Enter same passphrase again: ')).toBeNull();
  });

  it('answers the current passphrase once (wrong passphrase cannot loop)', () => {
    const a = passphraseAnswerer({ current: 'old', next: '' });
    expect(a('Enter old passphrase: ')).toBe('old');
    expect(a('Enter old passphrase: ')).toBeNull();
    expect(a('Enter new passphrase (empty for no passphrase): ')).toBe('');
  });

  it('never answers unknown prompts', () => {
    expect(passphraseAnswerer({ current: 'x' })('Are you sure you want to continue connecting (yes/no)?')).toBeNull();
  });
});

describe('metadata validation', () => {
  it('rejects private key material in notes', () => {
    expect(() => validateNotes(`my key:\n${FAKE_KEY}`)).toThrow(/private key/);
    expect(validateNotes('dùng cho GitHub công ty')).toBe('dùng cho GitHub công ty');
  });

  it('normalises and validates tags', () => {
    expect(validateTags([' github ', 'work', 'github'])).toEqual(['github', 'work']);
    expect(() => validateTags(['has space'])).toThrow();
    expect(() => validateTags('nope')).toThrow();
  });
});
