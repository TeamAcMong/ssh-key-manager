import { describe, expect, it } from 'vitest';
import { buildRows } from '../../src/renderer/lib/diffRows';

describe('side-by-side diff rows', () => {
  it('pairs a changed line on both sides with correct line numbers', () => {
    const rows = buildRows('Host a\n  HostName x\n', 'Host a\n  HostName y\n');
    expect(rows).toEqual([
      { kind: 'same', left: { no: 1, text: 'Host a' }, right: { no: 1, text: 'Host a' } },
      { kind: 'change', left: { no: 2, text: '  HostName x' }, right: { no: 2, text: '  HostName y' } }
    ]);
  });

  it('shows pure additions with an empty left side', () => {
    const rows = buildRows('', 'Host b\n  User git\n');
    expect(rows.every((r) => r.kind === 'change' && r.left === null)).toBe(true);
    expect(rows.map((r) => r.right?.no)).toEqual([1, 2]);
  });

  it('folds long unchanged runs but keeps context around changes', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n') + '\n';
    const after = before.replace('line10', 'LINE10');
    const rows = buildRows(before, after);
    const folds = rows.filter((r) => r.kind === 'fold');
    expect(folds).toHaveLength(2);
    const change = rows.find((r) => r.kind === 'change');
    expect(change?.left).toEqual({ no: 11, text: 'line10' });
    expect(change?.right).toEqual({ no: 11, text: 'LINE10' });
  });

  it('handles CRLF text', () => {
    const rows = buildRows('a\r\nb\r\n', 'a\r\nc\r\n');
    expect(rows.find((r) => r.kind === 'change')?.right?.text).toBe('c');
  });
});
