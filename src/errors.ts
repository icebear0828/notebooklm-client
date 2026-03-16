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
