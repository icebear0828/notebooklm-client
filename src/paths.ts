/**
 * Centralized path resolution for NotebookLM config/data directories.
 *
 * Respects NOTEBOOKLM_HOME environment variable for multi-account support.
 * Default: ~/.notebooklm
 */

import { join } from 'node:path';
import { homedir } from 'node:os';

let _homeOverride: string | null = null;

/** Get the NotebookLM home directory. */
export function getHomeDir(): string {
  return _homeOverride ?? process.env['NOTEBOOKLM_HOME'] ?? join(homedir(), '.notebooklm');
}

/** Override the home directory (e.g. from --home CLI flag). Pass null to reset. */
export function setHomeDir(dir: string | null): void {
  _homeOverride = dir;
}

/** Get default session file path. */
export function getSessionPath(): string {
  return join(getHomeDir(), 'session.json');
}

/** Get default Chrome profile directory — shared with api-reverser's gemini-profile. */
export function getProfileDir(): string {
  return join(homedir(), '.api-reverser', 'gemini-profile');
}

/** Get default RPC IDs override file path. */
export function getRpcIdsPath(): string {
  return join(getHomeDir(), 'rpc-ids.json');
}
