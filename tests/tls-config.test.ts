import { describe, it, expect } from 'vitest';
import { CHROME_CIPHERS, CHROME_SIGALGS, chromeTlsOptions } from '../src/tls-config.js';

describe('tls-config', () => {
  it('should have TLS 1.3 ciphers first', () => {
    expect(CHROME_CIPHERS.startsWith('TLS_AES_128_GCM_SHA256')).toBe(true);
  });

  it('should include ECDHE ciphers for TLS 1.2', () => {
    expect(CHROME_CIPHERS).toContain('ECDHE-ECDSA-AES128-GCM-SHA256');
    expect(CHROME_CIPHERS).toContain('ECDHE-RSA-AES128-GCM-SHA256');
    expect(CHROME_CIPHERS).toContain('ECDHE-ECDSA-CHACHA20-POLY1305');
  });

  it('should have multiple signature algorithms', () => {
    expect(CHROME_SIGALGS.split(':')).toHaveLength(8);
    expect(CHROME_SIGALGS).toContain('ecdsa_secp256r1_sha256');
    expect(CHROME_SIGALGS).toContain('rsa_pss_rsae_sha256');
  });

  it('chromeTlsOptions should return valid config', () => {
    const opts = chromeTlsOptions('notebooklm.google.com');

    expect(opts.servername).toBe('notebooklm.google.com');
    expect(opts.minVersion).toBe('TLSv1.2');
    expect(opts.maxVersion).toBe('TLSv1.3');
    expect(opts.ciphers).toBe(CHROME_CIPHERS);
    expect(opts.sigalgs).toBe(CHROME_SIGALGS);
    expect(opts.ALPNProtocols).toEqual(['h2', 'http/1.1']);
  });
});
