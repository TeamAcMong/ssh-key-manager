import type { ErrorCode, SkmErrorData, SuggestedFix } from '../types';
import { redact } from '../security/redact';

export class SkmError extends Error {
  readonly code: ErrorCode;
  readonly messageVi: string;
  readonly detail?: string;
  readonly fix?: SuggestedFix;

  constructor(code: ErrorCode, messageVi: string, detail?: string, fix?: SuggestedFix) {
    super(`${code}: ${messageVi}`);
    this.name = 'SkmError';
    this.code = code;
    this.messageVi = messageVi;
    this.detail = detail === undefined ? undefined : redact(detail);
    this.fix = fix;
  }

  toData(): SkmErrorData {
    const data: SkmErrorData = { code: this.code, messageVi: this.messageVi };
    if (this.detail) data.detail = this.detail;
    if (this.fix) data.fix = this.fix;
    return data;
  }
}

/** Converts anything thrown into a redacted, serializable error. */
export function toErrorData(err: unknown, secrets: readonly string[] = []): SkmErrorData {
  if (err instanceof SkmError) {
    const data = err.toData();
    if (data.detail) data.detail = redact(data.detail, secrets);
    return data;
  }
  const raw = err instanceof Error ? err.message : String(err);
  return { code: 'UNKNOWN', messageVi: 'Đã xảy ra lỗi không mong muốn.', detail: redact(raw, secrets) };
}

export function invalidInput(messageVi: string): SkmError {
  return new SkmError('INVALID_INPUT', messageVi);
}
