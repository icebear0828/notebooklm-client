import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadNbRpcIds, reloadNbRpcIds, setRpcIdsPath, getNbRpcIdsPath } from '../src/rpc-config.js';

const testDir = join(tmpdir(), `notebooklm-test-${Date.now()}`);
const testPath = join(testDir, 'rpc-ids.json');

afterEach(() => {
  try { rmSync(testDir, { recursive: true }); } catch { /* ignore */ }
  // Reset to non-existent path to clear cache
  setRpcIdsPath(join(tmpdir(), 'nonexistent-rpc-ids.json'));
  reloadNbRpcIds();
});

describe('loadNbRpcIds', () => {
  it('returns empty object when file does not exist', () => {
    setRpcIdsPath(join(tmpdir(), 'does-not-exist.json'));
    reloadNbRpcIds();
    const ids = loadNbRpcIds();
    expect(ids).toEqual({});
  });

  it('loads overrides from JSON file', () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testPath, JSON.stringify({ CCqFvf: 'NewId123' }));
    setRpcIdsPath(testPath);
    reloadNbRpcIds();
    const ids = loadNbRpcIds();
    expect(ids['CCqFvf']).toBe('NewId123');
  });

  it('caches result on subsequent calls', () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testPath, JSON.stringify({ A: 'B' }));
    setRpcIdsPath(testPath);
    reloadNbRpcIds();

    const first = loadNbRpcIds();
    // Modify file after first load
    writeFileSync(testPath, JSON.stringify({ A: 'C' }));
    const second = loadNbRpcIds();
    // Should still return cached value
    expect(second['A']).toBe('B');
    expect(first).toBe(second); // Same reference
  });

  it('reloadNbRpcIds clears cache', () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testPath, JSON.stringify({ X: 'Y' }));
    setRpcIdsPath(testPath);
    reloadNbRpcIds();

    loadNbRpcIds();
    writeFileSync(testPath, JSON.stringify({ X: 'Z' }));
    const reloaded = reloadNbRpcIds();
    expect(reloaded['X']).toBe('Z');
  });

  it('handles malformed JSON gracefully', () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testPath, '{bad json');
    setRpcIdsPath(testPath);
    reloadNbRpcIds();
    const ids = loadNbRpcIds();
    expect(ids).toEqual({});
  });
});

describe('getNbRpcIdsPath', () => {
  it('returns the configured path', () => {
    setRpcIdsPath('/custom/path.json');
    expect(getNbRpcIdsPath()).toBe('/custom/path.json');
  });
});
