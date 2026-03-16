/**
 * NotebookLM RPC ID configuration — loadable/reloadable from disk.
 *
 * Standalone version: config stored in ~/.notebooklm/rpc-ids.json
 */

import { existsSync, readFileSync } from 'node:fs';
import { getRpcIdsPath } from './paths.js';

let rpcIdsPath: string | null = null;
let loaded: Record<string, string> | null = null;

/** Set a custom path for the RPC IDs config file. */
export function setRpcIdsPath(path: string): void {
  rpcIdsPath = path;
  loaded = null;
}

/** Load RPC ID overrides from disk. Cached in memory after first load. */
export function loadNbRpcIds(): Record<string, string> {
  if (loaded) return loaded;
  const effectivePath = rpcIdsPath ?? getRpcIdsPath();
  if (!existsSync(effectivePath)) {
    loaded = {};
    return loaded;
  }
  try {
    const raw = readFileSync(effectivePath, 'utf-8');
    loaded = JSON.parse(raw) as Record<string, string>;
    return loaded;
  } catch {
    loaded = {};
    return loaded;
  }
}

/** Clear cache and reload from disk. */
export function reloadNbRpcIds(): Record<string, string> {
  loaded = null;
  return loadNbRpcIds();
}

/** Get the config file path. */
export function getNbRpcIdsPath(): string {
  return rpcIdsPath ?? getRpcIdsPath();
}
