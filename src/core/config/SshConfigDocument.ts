import { STRICT_HOST_KEY_CHECKING, type HostEdit, type HostEntry, type HostFields, type StrictHostKeyChecking } from '../types';
import { SkmError } from '../errors/SkmError';

// Lossless ssh_config model: every original line is kept byte-for-byte (including EOL, BOM,
// comments, `=` separators and unknown directives). Edits touch only the lines they must.

interface Line {
  text: string;
  eol: string;
}

interface Directive {
  indent: string;
  key: string;
  sep: string;
  value: string;
  trailing: string;
}

interface Block {
  kind: 'host' | 'match';
  header: number;
  /** Exclusive. */
  end: number;
}

const DIRECTIVE = /^(\s*)([A-Za-z][A-Za-z0-9]*)(\s*=\s*|\s+)(.*?)(\s*)$/;
const MANAGED_SINGLE = ['hostname', 'user', 'port', 'identitiesonly', 'stricthostkeychecking'] as const;
const CANONICAL: Record<string, string> = {
  hostname: 'HostName',
  user: 'User',
  port: 'Port',
  identityfile: 'IdentityFile',
  identitiesonly: 'IdentitiesOnly',
  stricthostkeychecking: 'StrictHostKeyChecking'
};

export function parseDirective(text: string): Directive | null {
  if (/^\s*(#|$)/.test(text)) return null;
  const m = DIRECTIVE.exec(text);
  if (!m) return null;
  return { indent: m[1] ?? '', key: m[2] ?? '', sep: m[3] ?? ' ', value: m[4] ?? '', trailing: m[5] ?? '' };
}

/** Splits a directive value into tokens, honouring double quotes like OpenSSH does. */
export function tokenize(value: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) out.push(m[1] ?? m[2] ?? '');
  return out;
}

function isStrictValue(v: string): v is StrictHostKeyChecking {
  return (STRICT_HOST_KEY_CHECKING as readonly string[]).includes(v);
}

export function formatValue(v: string): string {
  return /[\s#]/.test(v) ? `"${v}"` : v;
}

export function validateHostFields(f: HostFields): HostFields {
  const bad = (msg: string): never => {
    throw new SkmError('INVALID_INPUT', msg);
  };
  if (!Array.isArray(f.patterns) || f.patterns.length === 0) bad('Host cần ít nhất một tên/pattern.');
  for (const p of f.patterns) {
    if (typeof p !== 'string' || !/^[^\s"#=]{1,255}$/.test(p)) bad(`Host pattern "${String(p)}" không hợp lệ (không chứa khoảng trắng, dấu ", # hoặc =).`);
  }
  if (f.hostName !== null && (typeof f.hostName !== 'string' || !/^[A-Za-z0-9._:%[\]-]{1,255}$/.test(f.hostName))) bad('HostName không hợp lệ.');
  if (f.user !== null && (typeof f.user !== 'string' || !/^[A-Za-z0-9._\\@$-]{1,128}$/.test(f.user))) bad('User không hợp lệ.');
  if (f.port !== null && (!Number.isInteger(f.port) || f.port < 1 || f.port > 65535)) bad('Port phải là số từ 1 đến 65535.');
  if (!Array.isArray(f.identityFiles)) bad('IdentityFile không hợp lệ.');
  for (const i of f.identityFiles) {
    if (typeof i !== 'string' || i.length === 0 || i.length > 1024 || /["\r\n\0]/.test(i)) bad('Đường dẫn IdentityFile không hợp lệ.');
  }
  if (f.identitiesOnly !== null && f.identitiesOnly !== 'yes' && f.identitiesOnly !== 'no') bad('IdentitiesOnly chỉ nhận yes hoặc no.');
  if (f.strictHostKeyChecking !== null && !STRICT_HOST_KEY_CHECKING.includes(f.strictHostKeyChecking)) bad(`StrictHostKeyChecking chỉ nhận ${STRICT_HOST_KEY_CHECKING.join(', ')}.`);
  return f;
}

export class SshConfigDocument {
  private constructor(
    private readonly bom: string,
    private lines: Line[],
    private readonly eol: string
  ) {}

  static parse(text: string): SshConfigDocument {
    const bom = text.startsWith('﻿') ? '﻿' : '';
    const body = bom ? text.slice(1) : text;
    const lines: Line[] = [];
    const re = /([^\r\n]*)(\r\n|\n|\r|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      if (m[0] === '' && re.lastIndex >= body.length) break;
      lines.push({ text: m[1] ?? '', eol: m[2] ?? '' });
      if (m[2] === '') break;
    }
    const firstEol = lines.find((l) => l.eol)?.eol ?? '\n';
    return new SshConfigDocument(bom, lines, firstEol);
  }

  serialize(): string {
    return this.bom + this.lines.map((l) => l.text + l.eol).join('');
  }

  private blocks(): Block[] {
    const blocks: Block[] = [];
    this.lines.forEach((l, i) => {
      const d = parseDirective(l.text);
      const k = d?.key.toLowerCase();
      if (k === 'host' || k === 'match') {
        const prev = blocks[blocks.length - 1];
        if (prev) prev.end = i;
        blocks.push({ kind: k, header: i, end: this.lines.length });
      }
    });
    return blocks;
  }

  hosts(): HostEntry[] {
    return this.blocks().map((b, index) => {
      const header = parseDirective(this.lines[b.header]?.text ?? '');
      const entry: HostEntry = {
        index,
        kind: b.kind,
        patterns: b.kind === 'host' ? tokenize(header?.value ?? '') : [header?.value ?? ''],
        hostName: null,
        user: null,
        port: null,
        identityFiles: [],
        identitiesOnly: null,
        strictHostKeyChecking: null,
        otherDirectives: []
      };
      for (let i = b.header + 1; i < b.end; i++) {
        const d = parseDirective(this.lines[i]?.text ?? '');
        if (!d) continue;
        const k = d.key.toLowerCase();
        const first = tokenize(d.value)[0] ?? '';
        // ssh uses the first value it finds, so only the first occurrence is reported.
        if (k === 'hostname') entry.hostName ??= first;
        else if (k === 'user') entry.user ??= first;
        else if (k === 'port') entry.port ??= Number.parseInt(first, 10) || null;
        else if (k === 'identitiesonly') entry.identitiesOnly ??= first.toLowerCase() === 'yes' ? 'yes' : 'no';
        else if (k === 'identityfile') entry.identityFiles.push(first);
        else if (k === 'stricthostkeychecking' && isStrictValue(first.toLowerCase())) entry.strictHostKeyChecking ??= first.toLowerCase() as StrictHostKeyChecking;
        else entry.otherDirectives.push({ key: d.key, value: d.value });
      }
      return entry;
    });
  }

  /**
   * Applies edits whose indices refer to the document as it was when `hosts()` was read.
   * Updates run first, then deletes (highest index first), then adds.
   */
  applyEdits(edits: readonly HostEdit[]): void {
    const count = this.blocks().length;
    for (const e of edits) {
      if (e.op !== 'add' && (!Number.isInteger(e.index) || e.index < 0 || e.index >= count)) {
        throw new SkmError('INVALID_INPUT', 'Host block không tồn tại (config có thể đã thay đổi).');
      }
      if (e.op !== 'delete') validateHostFields(e.fields);
    }
    for (const e of edits) if (e.op === 'update') this.update(e.index, e.fields);
    const deletes = edits.filter((e): e is Extract<HostEdit, { op: 'delete' }> => e.op === 'delete').map((e) => e.index);
    for (const idx of [...new Set(deletes)].sort((a, b) => b - a)) this.remove(idx);
    for (const e of edits) if (e.op === 'add') this.add(e.fields);
  }

  private indentUnit(): string {
    for (const l of this.lines) {
      const d = parseDirective(l.text);
      if (d && d.indent && !['host', 'match'].includes(d.key.toLowerCase())) return d.indent;
    }
    return '    ';
  }

  private makeLine(key: string, value: string): Line {
    return { text: `${this.indentUnit()}${key} ${formatValue(value)}`, eol: this.eol };
  }

  private rewrite(i: number, value: string): void {
    const line = this.lines[i];
    const d = line ? parseDirective(line.text) : null;
    if (!line || !d) return;
    line.text = `${d.indent}${d.key}${d.sep}${value}${d.trailing}`;
  }

  private update(index: number, f: HostFields): void {
    const block = this.blocks()[index];
    if (!block) throw new SkmError('INVALID_INPUT', 'Host block không tồn tại.');
    if (block.kind !== 'host') throw new SkmError('INVALID_INPUT', 'Không sửa được khối Match bằng form; hãy sửa ở tab Raw.');

    const header = parseDirective(this.lines[block.header]?.text ?? '');
    if (header && tokenize(header.value).join(' ') !== f.patterns.join(' ')) {
      this.rewrite(block.header, f.patterns.map(formatValue).join(' '));
    }

    const desired: Record<(typeof MANAGED_SINGLE)[number], string | null> = {
      hostname: f.hostName,
      user: f.user,
      port: f.port === null ? null : String(f.port),
      identitiesonly: f.identitiesOnly,
      stricthostkeychecking: f.strictHostKeyChecking
    };
    const unknownStrict = this.linesWithKey(index, 'stricthostkeychecking').some((i) => !isStrictValue((tokenize(parseDirective(this.lines[i]?.text ?? '')?.value ?? '')[0] ?? '').toLowerCase()));
    for (const key of MANAGED_SINGLE) if (!(key === 'stricthostkeychecking' && unknownStrict)) this.setSingle(index, key, desired[key]);
    this.setIdentityFiles(index, f.identityFiles);
  }

  private linesWithKey(index: number, key: string): number[] {
    const b = this.blocks()[index];
    if (!b) return [];
    const out: number[] = [];
    for (let i = b.header + 1; i < b.end; i++) {
      if (parseDirective(this.lines[i]?.text ?? '')?.key.toLowerCase() === key) out.push(i);
    }
    return out;
  }

  /** Insertion point after the last directive of the block (keeps trailing comments/blank lines in place). */
  private insertionPoint(index: number): number {
    const b = this.blocks()[index];
    if (!b) return this.lines.length;
    let at = b.header + 1;
    for (let i = b.header + 1; i < b.end; i++) if (parseDirective(this.lines[i]?.text ?? '')) at = i + 1;
    return at;
  }

  private insertLines(at: number, lines: Line[]): void {
    // Inserting after an unterminated last line needs that line terminated first.
    const prev = this.lines[at - 1];
    if (prev && prev.eol === '') prev.eol = this.eol;
    if (at === this.lines.length && lines.length) {
      const last = lines[lines.length - 1];
      if (last) last.eol = this.eol;
    }
    this.lines.splice(at, 0, ...lines);
  }

  private setSingle(index: number, key: string, value: string | null): void {
    const existing = this.linesWithKey(index, key);
    if (value === null) {
      for (const i of existing.reverse()) this.lines.splice(i, 1);
      return;
    }
    const first = existing[0];
    if (first !== undefined) {
      const d = parseDirective(this.lines[first]?.text ?? '');
      if (d && (tokenize(d.value)[0] ?? '') !== value) this.rewrite(first, formatValue(value));
      return;
    }
    this.insertLines(this.insertionPoint(index), [this.makeLine(CANONICAL[key] ?? key, value)]);
  }

  private setIdentityFiles(index: number, files: readonly string[]): void {
    const existing = this.linesWithKey(index, 'identityfile');
    const common = Math.min(existing.length, files.length);
    for (let i = 0; i < common; i++) {
      const lineIdx = existing[i] as number;
      const d = parseDirective(this.lines[lineIdx]?.text ?? '');
      if (d && (tokenize(d.value)[0] ?? '') !== files[i]) this.rewrite(lineIdx, formatValue(files[i] as string));
    }
    for (const i of existing.slice(common).reverse()) this.lines.splice(i, 1);
    if (files.length > common) {
      const after = existing.length ? (existing[existing.length - 1] as number) + 1 : this.insertionPoint(index);
      this.insertLines(after, files.slice(common).map((f) => this.makeLine('IdentityFile', f)));
    }
  }

  private remove(index: number): void {
    const b = this.blocks()[index];
    if (!b) return;
    // The line before a header always has an EOL, so removal never leaves an unterminated line.
    this.lines.splice(b.header, b.end - b.header);
  }

  private add(f: HostFields): void {
    const block: Line[] = [{ text: `Host ${f.patterns.map(formatValue).join(' ')}`, eol: this.eol }];
    const push = (k: string, v: string | null): void => {
      if (v !== null) block.push(this.makeLine(k, v));
    };
    push('HostName', f.hostName);
    push('User', f.user);
    push('Port', f.port === null ? null : String(f.port));
    for (const i of f.identityFiles) push('IdentityFile', i);
    push('IdentitiesOnly', f.identitiesOnly);
    push('StrictHostKeyChecking', f.strictHostKeyChecking);

    // ssh uses the first value found, so a new host must come before a catch-all "Host *".
    const catchAll = this.blocks().find((b) => b.kind === 'host' && tokenize(parseDirective(this.lines[b.header]?.text ?? '')?.value ?? '').join(' ') === '*');
    if (catchAll) {
      let at = catchAll.header;
      while (at > 0 && /^\s*#/.test(this.lines[at - 1]?.text ?? '')) at--; // keep the comment above "Host *" attached to it
      this.lines.splice(at, 0, ...block, { text: '', eol: this.eol });
      return;
    }
    const last = this.lines[this.lines.length - 1];
    const lead: Line[] = last && last.text.trim() !== '' ? [{ text: '', eol: this.eol }] : [];
    this.insertLines(this.lines.length, [...lead, ...block]);
  }
}
