import path from 'node:path';
import fs from 'node:fs/promises';
import { SkmError } from '../errors/SkmError';

const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const NON_KEY_FILES = new Set(['config', 'known_hosts', 'known_hosts.old', 'authorized_keys', 'authorized_keys2', 'environment', 'rc']);
const NEW_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Returns a Vietnamese reason when `name` is not acceptable as a NEW key file name, otherwise null. */
export function validateNewKeyFileName(name: string): string | null {
  if (typeof name !== 'string' || name.length === 0) return 'Tên file không được để trống.';
  if (name.length > 100) return 'Tên file quá dài (tối đa 100 ký tự).';
  if (!NEW_NAME_PATTERN.test(name)) return 'Tên file chỉ được chứa chữ, số, dấu chấm, gạch dưới, gạch ngang và phải bắt đầu bằng chữ hoặc số.';
  if (name.endsWith('.')) return 'Tên file không được kết thúc bằng dấu chấm.';
  if (RESERVED_NAMES.test(name)) return 'Tên file trùng với tên thiết bị dành riêng của Windows.';
  if (name.toLowerCase().endsWith('.pub')) return 'Tên file private key không được có đuôi .pub.';
  if (NON_KEY_FILES.has(name.toLowerCase()) || /\.bak$/i.test(name)) return 'Tên file này được OpenSSH dùng cho mục đích khác.';
  return null;
}

export function isNonKeyFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return NON_KEY_FILES.has(lower) || lower.endsWith('.bak') || lower.endsWith('.old') || lower.endsWith('.tmp') || lower.startsWith('known_hosts') || lower.startsWith('authorized_keys');
}

/** Confines every file operation to a single root directory (the configured SSH dir). */
export class PathGuard {
  readonly root: string;

  constructor(root: string) {
    if (!path.isAbsolute(root)) throw new SkmError('INVALID_INPUT', 'Thư mục SSH phải là đường dẫn tuyệt đối.');
    this.root = path.resolve(root);
  }

  /** Resolves a bare file name (no separators) inside the root. Throws on anything that could escape. */
  resolveFile(name: string): string {
    if (typeof name !== 'string' || name.length === 0 || name.length > 255) {
      throw new SkmError('INVALID_INPUT', 'Tên file không hợp lệ.');
    }
    if (name !== path.basename(name) || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name.includes(':') || name.includes('\0')) {
      throw new SkmError('PATH_OUTSIDE_SSH_DIR', 'Tên file không được chứa đường dẫn.', name);
    }
    const full = path.resolve(this.root, name);
    this.assertInside(full);
    return full;
  }

  assertInside(fullPath: string): void {
    const rel = path.relative(this.root, path.resolve(fullPath));
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new SkmError('PATH_OUTSIDE_SSH_DIR', 'Đường dẫn nằm ngoài thư mục SSH đã cấu hình.', fullPath);
    }
  }

  /** Same as assertInside but follows symlinks/junctions of an existing file. */
  async assertRealInside(fullPath: string): Promise<void> {
    this.assertInside(fullPath);
    const realRoot = await fs.realpath(this.root);
    const real = await fs.realpath(fullPath);
    const rel = path.relative(realRoot, real);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new SkmError('PATH_OUTSIDE_SSH_DIR', 'File là liên kết trỏ ra ngoài thư mục SSH.', fullPath);
    }
  }
}
