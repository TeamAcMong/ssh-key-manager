import { describe, expect, it } from 'vitest';
import * as v from '../../src/main/validate';

describe('IPC input validation (main)', () => {
  it('rejects key ids that carry paths', () => {
    expect(v.keyId('id_ed25519')).toBe('id_ed25519');
    for (const bad of ['..', '../x', 'a\\b', 'C:x', 'a/b', '', 42, null, { id: 'x' }]) expect(() => v.keyId(bad)).toThrow();
  });

  it('accepts "all" or an array of ids for fixPerms', () => {
    expect(v.keyIds('all')).toBe('all');
    expect(v.keyIds(['a', 'b'])).toEqual(['a', 'b']);
    expect(() => v.keyIds(['../a'])).toThrow();
    expect(() => v.keyIds('a')).toThrow();
  });

  it('validates generate requests structurally', () => {
    expect(v.generateRequest({ type: 'rsa', bits: 4096, comment: 'c', fileName: 'f', passphrase: '' })).toEqual({ type: 'rsa', bits: 4096, comment: 'c', fileName: 'f', passphrase: '' });
    expect(() => v.generateRequest({ type: 'dsa', comment: '', fileName: 'f', passphrase: '' })).toThrow();
    expect(() => v.generateRequest({ type: 'rsa', bits: '4096', comment: '', fileName: 'f', passphrase: '' })).toThrow();
    expect(() => v.generateRequest({ type: 'ed25519', comment: 'x'.repeat(201), fileName: 'f', passphrase: '' })).toThrow();
  });

  it('only allows whitelisted settings fields', () => {
    expect(v.settingsPatch({ theme: 'dark' })).toEqual({ theme: 'dark' });
    expect(() => v.settingsPatch({ window: { x: 0 } })).toThrow();
    expect(() => v.settingsPatch({ sshDir: 5 })).toThrow();
  });

  it('validates host edits and timeouts', () => {
    const fields = { patterns: ['h'], hostName: null, user: null, port: 22, identityFiles: [], identitiesOnly: 'yes' };
    expect(v.hostEdits([{ op: 'add', fields }, { op: 'delete', index: 1 }])).toHaveLength(2);
    expect(() => v.hostEdits([{ op: 'update', index: 1.5, fields }])).toThrow();
    expect(() => v.hostEdits([{ op: 'rm', index: 0 }])).toThrow();
    expect(() => v.hostEdits([{ op: 'add', fields: { ...fields, identitiesOnly: 'maybe' } }])).toThrow();
    expect(v.timeoutSec(10)).toBe(10);
    expect(() => v.timeoutSec(0)).toThrow();
    expect(() => v.timeoutSec(1000)).toThrow();
  });
});
