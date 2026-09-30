import { diffLines } from 'diff';

export type Side = { no: number; text: string } | null;
export type Row = { kind: 'same' | 'change' | 'fold'; left: Side; right: Side; folded?: number };

const CONTEXT = 3;

function splitLines(value: string): string[] {
  const lines = value.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Builds side-by-side rows; removed/added runs are paired line by line, long unchanged runs are folded. */
export function buildRows(before: string, after: string): Row[] {
  const rows: Row[] = [];
  let l = 1;
  let r = 1;
  const parts = diffLines(before, after);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const lines = splitLines(p.value);
    if (!p.added && !p.removed) {
      const same = lines.map((text) => ({ kind: 'same' as const, left: { no: l++, text }, right: { no: r++, text } }));
      const isFirst = i === 0;
      const isLast = i === parts.length - 1;
      const keepHead = isFirst ? 0 : CONTEXT;
      const keepTail = isLast ? 0 : CONTEXT;
      if (same.length > keepHead + keepTail + 1) {
        rows.push(...same.slice(0, keepHead));
        rows.push({ kind: 'fold', left: null, right: null, folded: same.length - keepHead - keepTail });
        rows.push(...same.slice(same.length - keepTail));
      } else rows.push(...same);
      continue;
    }
    const removed = p.removed ? lines : [];
    let added: string[] = p.added ? lines : [];
    const next = parts[i + 1];
    if (p.removed && next?.added) {
      added = splitLines(next.value);
      i++;
    }
    const n = Math.max(removed.length, added.length);
    for (let k = 0; k < n; k++) {
      const lt = removed[k];
      const rt = added[k];
      rows.push({ kind: 'change', left: lt === undefined ? null : { no: l++, text: lt }, right: rt === undefined ? null : { no: r++, text: rt } });
    }
  }
  return rows;
}
