import fs from 'node:fs/promises';
import path from 'node:path';
import { SkmError } from '../errors/SkmError';
import { containsPrivateKeyMaterial } from '../security/redact';
import { exists, writeFileAtomic } from './fsutil';

export interface KeyMetadata {
  tags: string[];
  notes: string;
  lastKnownFile: string;
  updatedAt: string;
}

interface MetadataFile {
  schemaVersion: 1;
  /** Keyed by SHA256 fingerprint so tags survive renames. */
  keys: Record<string, KeyMetadata>;
}

const MAX_TAGS = 20;
const MAX_TAG_LEN = 32;
const MAX_NOTES_LEN = 2000;

export function validateTags(tags: unknown): string[] {
  if (!Array.isArray(tags) || tags.length > MAX_TAGS) throw new SkmError('INVALID_INPUT', `Tối đa ${MAX_TAGS} tag.`);
  const out = tags.map((t) => {
    if (typeof t !== 'string') throw new SkmError('INVALID_INPUT', 'Tag phải là chuỗi.');
    const v = t.trim();
    if (!v || v.length > MAX_TAG_LEN || !/^[\p{L}\p{N}._-]+$/u.test(v)) {
      throw new SkmError('INVALID_INPUT', `Tag "${v}" không hợp lệ (chỉ chữ, số, . _ -, tối đa ${MAX_TAG_LEN} ký tự).`);
    }
    return v;
  });
  return [...new Set(out)];
}

export function validateNotes(notes: unknown): string {
  if (typeof notes !== 'string' || notes.length > MAX_NOTES_LEN) throw new SkmError('INVALID_INPUT', `Ghi chú tối đa ${MAX_NOTES_LEN} ký tự.`);
  if (containsPrivateKeyMaterial(notes)) {
    throw new SkmError('INVALID_INPUT', 'Ghi chú có vẻ chứa nội dung private key. Không lưu private key vào ghi chú.');
  }
  return notes;
}

export class MetadataStore {
  readonly file: string;
  private cache: MetadataFile | null = null;

  constructor(appDataDir: string) {
    this.file = path.join(appDataDir, 'metadata.json');
  }

  private async read(): Promise<MetadataFile> {
    if (this.cache) return this.cache;
    if (!(await exists(this.file))) {
      this.cache = { schemaVersion: 1, keys: {} };
      return this.cache;
    }
    const parsed = JSON.parse(await fs.readFile(this.file, 'utf8')) as MetadataFile;
    if (parsed.schemaVersion !== 1 || typeof parsed.keys !== 'object' || parsed.keys === null) {
      throw new SkmError('SETTINGS_INVALID', `File metadata ${this.file} không đúng định dạng.`);
    }
    this.cache = parsed;
    return parsed;
  }

  async get(fingerprint: string): Promise<KeyMetadata | null> {
    return (await this.read()).keys[fingerprint] ?? null;
  }

  async set(fingerprint: string, data: { tags: string[]; notes: string; lastKnownFile: string }): Promise<void> {
    const file = await this.read();
    file.keys[fingerprint] = {
      tags: validateTags(data.tags),
      notes: validateNotes(data.notes),
      lastKnownFile: data.lastKnownFile,
      updatedAt: new Date().toISOString()
    };
    await this.flush(file);
  }

  async updateFileName(fingerprint: string, lastKnownFile: string): Promise<void> {
    const file = await this.read();
    const entry = file.keys[fingerprint];
    if (!entry) return;
    entry.lastKnownFile = lastKnownFile;
    entry.updatedAt = new Date().toISOString();
    await this.flush(file);
  }

  async remove(fingerprint: string): Promise<void> {
    const file = await this.read();
    if (!(fingerprint in file.keys)) return;
    delete file.keys[fingerprint];
    await this.flush(file);
  }

  private async flush(file: MetadataFile): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify(file, null, 2) + '\n');
    this.cache = file;
  }
}
