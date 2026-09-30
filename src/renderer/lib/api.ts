import type { Result, SkmErrorData } from '../../core/types';

/** Error carrying the redacted, Vietnamese error data from main. */
export class UiError extends Error {
  constructor(readonly data: SkmErrorData) {
    super(data.messageVi);
  }
}

export async function call<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new UiError(r.error);
  return r.value;
}

export function errorData(err: unknown): SkmErrorData {
  if (err instanceof UiError) return err.data;
  return { code: 'UNKNOWN', messageVi: 'Đã xảy ra lỗi không mong muốn.', detail: err instanceof Error ? err.message : String(err) };
}

export const api = (): typeof window.skm => window.skm;
