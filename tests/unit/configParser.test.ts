import { describe, expect, it } from 'vitest';
import { SshConfigDocument, tokenize } from '../../src/core/config/SshConfigDocument';
import type { HostFields } from '../../src/core/types';

const SAMPLE_LF = `# Global options
Include ~/.ssh/config.d/*
AddKeysToAgent yes

# Work GitHub
Host github-work
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_work
    # keep this comment
    IdentitiesOnly yes
    ServerAliveInterval 60

Host=legacy  old-box
\tHostName=10.0.0.5
\tPort   2222
\tIdentityFile "C:/Users/My Name/.ssh/id_rsa"

Match host *.internal exec "true"
    ForwardAgent no

# defaults
Host *
    User me
`;

const fields = (over: Partial<HostFields> = {}): HostFields => ({
  patterns: ['new-host'],
  hostName: 'example.com',
  user: 'git',
  port: null,
  identityFiles: ['~/.ssh/id_ed25519'],
  identitiesOnly: 'yes',
  ...over
});

describe('SshConfigDocument round-trip', () => {
  const variants: Record<string, string> = {
    lf: SAMPLE_LF,
    crlf: SAMPLE_LF.replace(/\n/g, '\r\n'),
    bom: '\uFEFF' + SAMPLE_LF,
    noTrailingNewline: SAMPLE_LF.trimEnd(),
    empty: '',
    onlyComments: '# nothing\n\n# here',
    trailingSpaces: 'Host a   \n  HostName b  \t\n\n\n'
  };
  for (const [name, text] of Object.entries(variants)) {
    it(`serializes ${name} byte-for-byte`, () => {
      expect(SshConfigDocument.parse(text).serialize()).toBe(text);
    });
  }
});

describe('SshConfigDocument.hosts', () => {
  const hosts = SshConfigDocument.parse(SAMPLE_LF).hosts();

  it('lists Host and Match blocks in order', () => {
    expect(hosts.map((h) => [h.kind, h.patterns.join(' ')])).toEqual([
      ['host', 'github-work'],
      ['host', 'legacy old-box'],
      ['match', 'host *.internal exec "true"'],
      ['host', '*']
    ]);
  });

  it('reads managed fields including = separators, tabs and quoted paths', () => {
    expect(hosts[0]).toMatchObject({ hostName: 'github.com', user: 'git', identityFiles: ['~/.ssh/id_ed25519_work'], identitiesOnly: 'yes' });
    expect(hosts[0]?.otherDirectives).toEqual([{ key: 'ServerAliveInterval', value: '60' }]);
    expect(hosts[1]).toMatchObject({ hostName: '10.0.0.5', port: 2222, identityFiles: ['C:/Users/My Name/.ssh/id_rsa'] });
  });

  it('tokenizes quoted values', () => {
    expect(tokenize('a "b c" d')).toEqual(['a', 'b c', 'd']);
  });
});

describe('SshConfigDocument edits', () => {
  it('updates only changed lines and keeps comments and unknown directives', () => {
    const doc = SshConfigDocument.parse(SAMPLE_LF);
    doc.applyEdits([{ op: 'update', index: 0, fields: fields({ patterns: ['github-work'], hostName: 'ssh.github.com', port: 443, identityFiles: ['~/.ssh/id_ed25519_work'] }) }]);
    const out = doc.serialize();
    expect(out).toContain('    HostName ssh.github.com\n');
    expect(out).toContain('    # keep this comment\n');
    expect(out).toContain('    ServerAliveInterval 60\n    Port 443\n');
    // Everything outside the block is untouched.
    expect(out.slice(out.indexOf('Host=legacy'))).toBe(SAMPLE_LF.slice(SAMPLE_LF.indexOf('Host=legacy')));
  });

  it('preserves "=" separators and tab indentation when rewriting a value', () => {
    const doc = SshConfigDocument.parse(SAMPLE_LF);
    const h = doc.hosts()[1]!;
    doc.applyEdits([{ op: 'update', index: 1, fields: { ...fields(), patterns: h.patterns, hostName: '10.0.0.6', user: null, port: 2222, identityFiles: h.identityFiles, identitiesOnly: null } }]);
    const out = doc.serialize();
    expect(out).toContain('\tHostName=10.0.0.6\n');
    expect(out).toContain('\tPort   2222\n');
    expect(out).toContain('\tIdentityFile "C:/Users/My Name/.ssh/id_rsa"\n');
  });

  it('removes a directive when set to null', () => {
    const doc = SshConfigDocument.parse(SAMPLE_LF);
    doc.applyEdits([{ op: 'update', index: 0, fields: fields({ patterns: ['github-work'], hostName: 'github.com', identityFiles: [], identitiesOnly: null }) }]);
    const block = doc.serialize().split('Host=legacy')[0]!;
    expect(block).not.toContain('IdentityFile');
    expect(block).not.toContain('IdentitiesOnly');
  });

  it('adds a new host before the catch-all "Host *" and its comment', () => {
    const doc = SshConfigDocument.parse(SAMPLE_LF);
    doc.applyEdits([{ op: 'add', fields: fields() }]);
    const out = doc.serialize();
    expect(out).toContain('Host new-host\n    HostName example.com\n    User git\n    IdentityFile ~/.ssh/id_ed25519\n    IdentitiesOnly yes\n\n# defaults\nHost *\n');
    expect(doc.hosts().map((h) => h.patterns[0])).toEqual(['github-work', 'legacy', 'host *.internal exec "true"', 'new-host', '*']);
  });

  it('appends to a file without trailing newline and to an empty file, using the file EOL', () => {
    const doc = SshConfigDocument.parse('Host a\r\n  HostName b');
    doc.applyEdits([{ op: 'add', fields: fields({ identityFiles: ['C:/Users/My Name/k'] }) }]);
    expect(doc.serialize()).toBe('Host a\r\n  HostName b\r\n\r\nHost new-host\r\n  HostName example.com\r\n  User git\r\n  IdentityFile "C:/Users/My Name/k"\r\n  IdentitiesOnly yes\r\n');

    const empty = SshConfigDocument.parse('');
    empty.applyEdits([{ op: 'add', fields: fields({ identityFiles: [] }) }]);
    expect(empty.serialize()).toBe('Host new-host\n    HostName example.com\n    User git\n    IdentitiesOnly yes\n');
  });

  it('deletes a block and keeps the others intact', () => {
    const doc = SshConfigDocument.parse(SAMPLE_LF);
    doc.applyEdits([{ op: 'delete', index: 1 }]);
    const out = doc.serialize();
    expect(out).not.toContain('legacy');
    expect(out).toContain('Match host *.internal');
    expect(SshConfigDocument.parse(out).hosts()).toHaveLength(3);
  });

  it('applies multiple edits against the original indices', () => {
    const doc = SshConfigDocument.parse(SAMPLE_LF);
    doc.applyEdits([
      { op: 'delete', index: 0 },
      { op: 'update', index: 1, fields: fields({ patterns: ['legacy'], hostName: '10.0.0.9', user: null, identityFiles: [], identitiesOnly: null }) },
      { op: 'add', fields: fields() }
    ]);
    expect(doc.hosts().map((h) => [h.patterns.join(' '), h.hostName])).toEqual([
      ['legacy', '10.0.0.9'],
      ['host *.internal exec "true"', null],
      ['new-host', 'example.com'],
      ['*', null]
    ]);
  });

  it('rejects invalid fields and Match edits', () => {
    const doc = SshConfigDocument.parse(SAMPLE_LF);
    expect(() => doc.applyEdits([{ op: 'add', fields: fields({ patterns: ['bad host'] }) }])).toThrow(/không hợp lệ/);
    expect(() => doc.applyEdits([{ op: 'add', fields: fields({ port: 70000 }) }])).toThrow(/Port/);
    expect(() => doc.applyEdits([{ op: 'add', fields: fields({ identityFiles: ['a"b'] }) }])).toThrow(/IdentityFile/);
    expect(() => doc.applyEdits([{ op: 'update', index: 2, fields: fields() }])).toThrow(/Match/);
    expect(() => doc.applyEdits([{ op: 'delete', index: 9 }])).toThrow(/không tồn tại/);
  });
});
