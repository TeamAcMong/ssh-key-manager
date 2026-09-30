/** Renders rows as a left-aligned text table (header underlined with dashes). */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ').trimEnd();
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

export function yesNo(v: boolean | null): string {
  return v === null ? '?' : v ? 'có' : 'không';
}

export function print(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

export function printJson(value: unknown): void {
  print(JSON.stringify(value, null, 2));
}
