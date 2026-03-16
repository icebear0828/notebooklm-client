/**
 * Transport interface — abstracts how HTTP requests reach NotebookLM servers.
 *
 * Two implementations:
 *   - BrowserTransport: page.evaluate(fetch(...)) inside a real Chrome
 *   - HttpTransport:    Node.js undici with Chrome-like TLS fingerprint
 */

import type { NotebookRpcSession } from './types.js';

export interface TransportRequest {
  url: string;
  queryParams: Record<string, string>;
  body: Record<string, string>;
}

export interface Transport {
  /** Execute a batchexecute or streaming RPC call. Returns raw response text. */
  execute(req: TransportRequest): Promise<string>;

  /** Get the current RPC session data. */
  getSession(): NotebookRpcSession;

  /** Refresh session tokens (e.g. reload page or re-fetch cookies). */
  refreshSession(): Promise<void>;

  /** Tear down resources. */
  dispose(): Promise<void>;
}
