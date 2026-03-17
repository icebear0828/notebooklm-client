/**
 * Error hierarchy for notebooklm-client.
 */

export class NotebookLmError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/** Chrome launch/navigation/profile errors */
export class BrowserError extends NotebookLmError {}

/** Token extraction, login state errors */
export class SessionError extends NotebookLmError {}

/** Server-side user-displayable error (e.g. quota exceeded, rate limited) */
export class UserDisplayableError extends NotebookLmError {
  constructor(raw: string) {
    super(UserDisplayableError.extractMessage(raw));
  }

  private static extractMessage(raw: string): string {
    // Try to extract readable info from the error response
    if (raw.includes('[[null,[[1]]]]')) return 'Quota exceeded or generation limit reached';
    if (raw.includes('[[null,[[2]]]]')) return 'Rate limited — try again later';
    return 'Server error: operation rejected by NotebookLM';
  }
}
