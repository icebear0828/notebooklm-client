/**
 * Transport tier auto-detection and factory.
 *
 * Priority:
 *   1. curl-impersonate  (macOS/Linux, 100% Chrome fingerprint)
 *   2. tls-client         (all platforms, 99% Chrome fingerprint)
 *   3. undici             (all platforms, ~40% match, always available)
 */

import { CurlTransport } from './transport-curl.js';
import { TlsClientTransport } from './transport-tlsclient.js';
import { HttpTransport } from './transport-http.js';
import type { Transport } from './transport.js';
import type { NotebookRpcSession } from './types.js';

export type TransportTier = 'curl-impersonate' | 'tls-client' | 'http';

export interface TransportFactoryOptions {
  session: NotebookRpcSession;
  /** Force a specific curl-impersonate binary path. */
  curlBinaryPath?: string;
  /** tls-client Chrome profile identifier. Default: 'chrome_131'. */
  tlsClientProfile?: string;
  /** Proxy URL (http, socks5, socks5h). Passed to the transport layer. */
  proxy?: string;
  /** Called when session tokens expire. */
  onSessionExpired?: () => Promise<NotebookRpcSession>;
}

/**
 * Detect the best available transport tier.
 */
export async function detectBestTier(opts?: { curlBinaryPath?: string }): Promise<TransportTier> {
  // Tier 1: curl-impersonate (best fingerprint, macOS/Linux only)
  if (await CurlTransport.isAvailable(opts?.curlBinaryPath)) {
    return 'curl-impersonate';
  }

  // Tier 2: tls-client (great fingerprint, all platforms)
  if (await TlsClientTransport.isAvailable()) {
    return 'tls-client';
  }

  // Tier 3: undici (always available)
  return 'http';
}

/**
 * Create a transport instance for the given tier.
 */
export async function createTransport(
  tier: TransportTier,
  opts: TransportFactoryOptions,
): Promise<Transport> {
  switch (tier) {
    case 'curl-impersonate': {
      const t = new CurlTransport({
        session: opts.session,
        binaryPath: opts.curlBinaryPath,
        proxy: opts.proxy,
        onSessionExpired: opts.onSessionExpired,
      });
      await t.init();
      return t;
    }
    case 'tls-client': {
      const t = new TlsClientTransport({
        session: opts.session,
        profile: opts.tlsClientProfile,
        proxy: opts.proxy,
        onSessionExpired: opts.onSessionExpired,
      });
      await t.init();
      return t;
    }
    case 'http': {
      return new HttpTransport({
        session: opts.session,
        proxy: opts.proxy,
        onSessionExpired: opts.onSessionExpired,
      });
    }
  }
}

/** Human-readable tier descriptions for logging. */
export const TIER_LABELS: Record<TransportTier, string> = {
  'curl-impersonate': 'curl-impersonate (tier 1, 100% Chrome fingerprint)',
  'tls-client': 'tls-client (tier 2, 99% Chrome fingerprint)',
  'http': 'undici (tier 3, basic TLS)',
};
