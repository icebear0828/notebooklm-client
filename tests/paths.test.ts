import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { getHomeDir, setHomeDir, getSessionPath, getProfileDir, getRpcIdsPath } from '../src/paths.js';

describe('paths', () => {
  afterEach(() => {
    setHomeDir(null);
    delete process.env['NOTEBOOKLM_HOME'];
  });

  it('should return default home dir', () => {
    expect(getHomeDir()).toMatch(/\.notebooklm$/);
  });

  it('should respect NOTEBOOKLM_HOME env var', () => {
    process.env['NOTEBOOKLM_HOME'] = '/tmp/nb-test-env';
    expect(getHomeDir()).toBe('/tmp/nb-test-env');
    expect(getSessionPath()).toBe(join('/tmp/nb-test-env', 'session.json'));
    expect(getProfileDir()).toBe(join('/tmp/nb-test-env', 'chrome-profile'));
    expect(getRpcIdsPath()).toBe(join('/tmp/nb-test-env', 'rpc-ids.json'));
  });

  it('should respect setHomeDir override over env var', () => {
    process.env['NOTEBOOKLM_HOME'] = '/tmp/env-dir';
    setHomeDir('/tmp/override-dir');
    expect(getHomeDir()).toBe('/tmp/override-dir');
    expect(getSessionPath()).toBe(join('/tmp/override-dir', 'session.json'));
  });
});
