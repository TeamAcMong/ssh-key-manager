import fs from 'node:fs/promises';
import { exists, timestamp } from './fsutil';

/**
 * Copies `file` to "<file>.<timestamp>.bak" before it is modified.
 * Returns the backup path, or null when the file does not exist yet (nothing to back up).
 */
export async function backupBeforeWrite(file: string): Promise<string | null> {
  if (!(await exists(file))) return null;
  const target = `${file}.${timestamp()}.bak`;
  await fs.copyFile(file, target, fs.constants.COPYFILE_EXCL);
  return target;
}
