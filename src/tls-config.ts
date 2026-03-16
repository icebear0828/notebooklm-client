/**
 * Chrome-like TLS configuration for undici.
 *
 * Mimics Chrome 131+ TLS fingerprint:
 *   - Cipher suite order matching Chrome
 *   - ALPN protocols (h2, http/1.1)
 *   - TLS 1.2+ minimum version
 *
 * Note: Node.js/undici cannot fully replicate JA3/JA4 fingerprints
 * (extension order, GREASE, etc. are controlled by OpenSSL internals).
 * This gets us close enough for most Google endpoint checks.
 */

import { connect as tlsConnect, type ConnectionOptions } from 'node:tls';

/**
 * Chrome 131 cipher suite list (in Chrome's preferred order).
 * Maps to the ciphers seen in Chrome's ClientHello.
 */
export const CHROME_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

/** Signature algorithms matching Chrome's preferences. */
export const CHROME_SIGALGS = [
  'ecdsa_secp256r1_sha256',
  'rsa_pss_rsae_sha256',
  'rsa_pkcs1_sha256',
  'ecdsa_secp384r1_sha384',
  'rsa_pss_rsae_sha384',
  'rsa_pkcs1_sha384',
  'rsa_pss_rsae_sha512',
  'rsa_pkcs1_sha512',
].join(':');

/**
 * Build TLS connection options that approximate a Chrome fingerprint.
 */
export function chromeTlsOptions(servername: string): ConnectionOptions {
  return {
    servername,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    ciphers: CHROME_CIPHERS,
    sigalgs: CHROME_SIGALGS,
    ALPNProtocols: ['h2', 'http/1.1'],
    // Disable session tickets to more closely match fresh Chrome connections
    // when session resumption isn't expected
  };
}

/**
 * Create a TLS socket connector for undici that uses Chrome-like TLS settings.
 */
export function createChromeTlsConnector(): (
  opts: { hostname: string; port: number; protocol: string },
  callback: (err: Error | null, socket: ReturnType<typeof tlsConnect> | null) => void,
) => ReturnType<typeof tlsConnect> {
  return (opts, callback) => {
    const socket = tlsConnect(
      {
        host: opts.hostname,
        port: opts.port,
        ...chromeTlsOptions(opts.hostname),
      },
      () => callback(null, socket),
    );
    socket.on('error', (err) => callback(err, null));
    return socket;
  };
}
