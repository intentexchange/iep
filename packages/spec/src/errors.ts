export const ERROR_CODES = {
  IEP_INVALID_DOCUMENT: "IEP_INVALID_DOCUMENT",
  IEP_INVALID_SIGNATURE: "IEP_INVALID_SIGNATURE",
  IEP_SEALED_LEAK: "IEP_SEALED_LEAK",
  IEP_EXPIRED: "IEP_EXPIRED",
  IEP_NOT_FOUND: "IEP_NOT_FOUND",
  IEP_UNAUTHORIZED: "IEP_UNAUTHORIZED",
  IEP_RATE_LIMITED: "IEP_RATE_LIMITED",
  IEP_MANDATE_DENIED: "IEP_MANDATE_DENIED",
  IEP_COMMIT_MISMATCH: "IEP_COMMIT_MISMATCH",
  IEP_SESSION_STATE: "IEP_SESSION_STATE",
  IEP_REPLAY: "IEP_REPLAY",
  IEP_TERM_OUT_OF_BOUNDS: "IEP_TERM_OUT_OF_BOUNDS",
  IEP_INVALID_MANDATE: "IEP_INVALID_MANDATE",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const STATUS: Record<ErrorCode, number> = {
  IEP_INVALID_DOCUMENT: 400,
  IEP_INVALID_SIGNATURE: 401,
  IEP_SEALED_LEAK: 400,
  IEP_EXPIRED: 400,
  IEP_NOT_FOUND: 404,
  IEP_UNAUTHORIZED: 401,
  IEP_RATE_LIMITED: 429,
  IEP_MANDATE_DENIED: 403,
  IEP_COMMIT_MISMATCH: 400,
  IEP_SESSION_STATE: 409,
  IEP_REPLAY: 409,
  IEP_TERM_OUT_OF_BOUNDS: 400,
  IEP_INVALID_MANDATE: 401,
};

export class IepError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status?: number) {
    super(message);
    this.name = "IepError";
    this.code = code;
    this.status = status ?? STATUS[code];
  }

  toJSON(): { error: ErrorCode; message: string } {
    return { error: this.code, message: this.message };
  }
}
