import fs from 'node:fs/promises';
import path from 'node:path';
import type { Language, Settings, ThemeSetting, WindowBounds } from '../types';
import type { PlatformPaths } from '../platform/interfaces';
import { SkmError } from '../errors/SkmError';
import { exists, timestamp, writeFileAtomic } from './fsutil';

const THEMES: ThemeSetting[] = ['system', 'light', 'dark'];
const LANGUAGES: Language[] = ['vi', 'en'];

export class SettingsStore {
  readonly file: string;

  constructor(private readonly paths: PlatformPaths) {
    this.file = path.join(paths.appDataDir(), 'settings.json');
  }

  async defaults(): Promise<Settings> {
    return {
      schemaVersion: 1,
      sshDir: this.paths.defaultSshDir(),
      binDir: await this.paths.findOpenSshBinDir(),
      theme: 'system',
      language: 'vi',
      window: null
    };
  }

  async load(): Promise<Settings> {
    const defaults = await this.defaults();
    if (!(await exists(this.file))) return defaults;
    const raw = await fs.readFile(this.file, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Keep the broken file for inspection instead of silently overwriting it.
      const moved = `${this.file}.corrupt-${timestamp()}`;
      await fs.rename(this.file, moved);
      throw new SkmError('SETTINGS_INVALID', `File cài đặt bị hỏng và đã được đổi tên thành ${path.basename(moved)}. Hãy mở lại ứng dụng để dùng cài đặt mặc định.`);
    }
    return mergeSettings(defaults, parsed);
  }

  async save(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.load();
    const next = mergeSettings(current, { ...current, ...patch });
    await writeFileAtomic(this.file, JSON.stringify(next, null, 2) + '\n');
    return next;
  }
}

/** Validates each field; invalid values raise instead of being silently replaced. */
export function mergeSettings(base: Settings, input: unknown): Settings {
  if (typeof input !== 'object' || input === null) throw new SkmError('SETTINGS_INVALID', 'Cài đặt không hợp lệ.');
  const o = input as Record<string, unknown>;
  const out: Settings = { ...base };
  if (o.sshDir !== undefined) {
    if (typeof o.sshDir !== 'string' || !path.isAbsolute(o.sshDir)) throw new SkmError('SETTINGS_INVALID', 'Thư mục SSH phải là đường dẫn tuyệt đối.');
    out.sshDir = path.resolve(o.sshDir);
  }
  if (o.binDir !== undefined) {
    if (o.binDir !== null && (typeof o.binDir !== 'string' || !path.isAbsolute(o.binDir))) throw new SkmError('SETTINGS_INVALID', 'Đường dẫn OpenSSH phải là đường dẫn tuyệt đối.');
    // null = auto-detect at use time.
    out.binDir = o.binDir === null ? null : path.resolve(o.binDir);
  }
  if (o.theme !== undefined) {
    if (!THEMES.includes(o.theme as ThemeSetting)) throw new SkmError('SETTINGS_INVALID', 'Giao diện không hợp lệ.');
    out.theme = o.theme as ThemeSetting;
  }
  if (o.language !== undefined) {
    if (!LANGUAGES.includes(o.language as Language)) throw new SkmError('SETTINGS_INVALID', 'Ngôn ngữ không hợp lệ.');
    out.language = o.language as Language;
  }
  if (o.window !== undefined) out.window = o.window === null ? null : parseBounds(o.window);
  return out;
}

function parseBounds(v: unknown): WindowBounds {
  const w = v as Record<string, unknown>;
  const nums = ['x', 'y', 'width', 'height'].map((k) => w[k]);
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n)) || typeof w.maximized !== 'boolean') {
    throw new SkmError('SETTINGS_INVALID', 'Kích thước cửa sổ không hợp lệ.');
  }
  return { x: w.x as number, y: w.y as number, width: w.width as number, height: w.height as number, maximized: w.maximized };
}

/** True when the configured dir is not the real %USERPROFILE%\.ssh. */
export function isSandboxDir(sshDir: string, defaultDir: string): boolean {
  return path.resolve(sshDir).toLowerCase() !== path.resolve(defaultDir).toLowerCase();
}
