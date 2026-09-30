// Runtime validation of every IPC argument. No electron import so it can be unit-tested.
import type { GenerateKeyRequest, HostEdit, HostFields, Settings } from '../core/types';
import { SkmError } from '../core/errors/SkmError';

const fail = (what: string): never => {
  throw new SkmError('INVALID_INPUT', `Dữ liệu không hợp lệ: ${what}.`);
};

export function str(v: unknown, what: string, max = 4096): string {
  if (typeof v !== 'string' || v.length > max) fail(what);
  return v as string;
}

export function optStr(v: unknown, what: string, max = 4096): string | undefined {
  return v === undefined ? undefined : str(v, what, max);
}

export function keyId(v: unknown): string {
  const s = str(v, 'key id', 255);
  if (!s || /[\\/:\0]/.test(s) || s === '.' || s === '..') fail('key id');
  return s;
}

export function keyIds(v: unknown): string[] | 'all' {
  if (v === 'all') return 'all';
  if (!Array.isArray(v) || v.length > 500) fail('danh sách key');
  return (v as unknown[]).map(keyId);
}

export function stringArray(v: unknown, what: string, maxItems = 50, maxLen = 256): string[] {
  if (!Array.isArray(v) || v.length > maxItems) fail(what);
  return (v as unknown[]).map((x) => str(x, what, maxLen));
}

export function generateRequest(v: unknown): GenerateKeyRequest {
  if (typeof v !== 'object' || v === null) fail('yêu cầu tạo key');
  const o = v as Record<string, unknown>;
  const type = o.type;
  if (type !== 'ed25519' && type !== 'rsa' && type !== 'ecdsa') fail('loại key');
  const req: GenerateKeyRequest = {
    type: type as GenerateKeyRequest['type'],
    comment: str(o.comment, 'comment', 200),
    fileName: str(o.fileName, 'tên file', 100),
    passphrase: str(o.passphrase, 'passphrase', 1024)
  };
  if (o.bits !== undefined) {
    if (typeof o.bits !== 'number' || !Number.isInteger(o.bits)) fail('số bit');
    req.bits = o.bits as number;
  }
  return req;
}

export function settingsPatch(v: unknown): Partial<Pick<Settings, 'sshDir' | 'binDir' | 'theme' | 'language'>> {
  if (typeof v !== 'object' || v === null) fail('cài đặt');
  const o = v as Record<string, unknown>;
  const allowed = new Set(['sshDir', 'binDir', 'theme', 'language']);
  for (const k of Object.keys(o)) if (!allowed.has(k)) fail(`trường cài đặt "${k}"`);
  const out: Partial<Pick<Settings, 'sshDir' | 'binDir' | 'theme' | 'language'>> = {};
  if (o.sshDir !== undefined) out.sshDir = str(o.sshDir, 'thư mục SSH', 1024);
  if (o.binDir !== undefined) out.binDir = o.binDir === null ? null : str(o.binDir, 'thư mục OpenSSH', 1024);
  if (o.theme !== undefined) out.theme = str(o.theme, 'theme', 16) as Settings['theme'];
  if (o.language !== undefined) out.language = str(o.language, 'ngôn ngữ', 8) as Settings['language'];
  return out;
}

function hostFields(v: unknown): HostFields {
  if (typeof v !== 'object' || v === null) fail('host');
  const o = v as Record<string, unknown>;
  const nullableStr = (x: unknown, what: string): string | null => (x === null ? null : str(x, what, 1024));
  let port: number | null = null;
  if (o.port !== null) {
    if (typeof o.port !== 'number') fail('port');
    port = o.port as number;
  }
  const io = o.identitiesOnly;
  if (io !== null && io !== 'yes' && io !== 'no') fail('IdentitiesOnly');
  // Semantic validation (allowed characters, ranges) happens in core's validateHostFields.
  return {
    patterns: stringArray(o.patterns, 'host pattern', 20, 255),
    hostName: nullableStr(o.hostName, 'HostName'),
    user: nullableStr(o.user, 'User'),
    port,
    identityFiles: stringArray(o.identityFiles, 'IdentityFile', 20, 1024),
    identitiesOnly: io as HostFields['identitiesOnly']
  };
}

export function hostEdits(v: unknown): HostEdit[] {
  if (!Array.isArray(v) || v.length > 100) fail('danh sách thay đổi config');
  return (v as unknown[]).map((e) => {
    if (typeof e !== 'object' || e === null) fail('thay đổi config');
    const o = e as Record<string, unknown>;
    const index = (): number => {
      if (typeof o.index !== 'number' || !Number.isInteger(o.index)) fail('vị trí host');
      return o.index as number;
    };
    if (o.op === 'add') return { op: 'add', fields: hostFields(o.fields) };
    if (o.op === 'update') return { op: 'update', index: index(), fields: hostFields(o.fields) };
    if (o.op === 'delete') return { op: 'delete', index: index() };
    return fail('loại thay đổi config');
  });
}

export function timeoutSec(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > 120) fail('timeout');
  return Math.trunc(v as number);
}
