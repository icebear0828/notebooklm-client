/**
 * Simple logger with levels and optional file output for diagnostics.
 *
 * Usage:
 *   import { log } from './logger.js';
 *   log.info('Connected');
 *   log.error('Failed', err);
 *   log.debug('Payload', data);  // only shown with NOTEBOOKLM_DEBUG=1
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getHomeDir } from './paths.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let minLevel: LogLevel = process.env['NOTEBOOKLM_DEBUG'] ? 'debug' : 'info';
let logToFile = false;

function getLogPath(): string {
  return join(getHomeDir(), 'debug.log');
}

function timestamp(): string {
  return new Date().toISOString();
}

function write(level: LogLevel, msg: string, data?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

  const prefix = `[${timestamp()}] [${level.toUpperCase()}]`;
  const line = data !== undefined
    ? `${prefix} ${msg} ${typeof data === 'string' ? data : JSON.stringify(data, null, 0)}`
    : `${prefix} ${msg}`;

  // Always write to stderr (not stdout, which is for machine-readable output)
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.error(line);
  } else if (level === 'debug') {
    console.error(line);
  } else {
    console.error(line);
  }

  // Optionally append to file
  if (logToFile) {
    try {
      const dir = getHomeDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(getLogPath(), line + '\n', 'utf-8');
    } catch {
      // Silently ignore file write failures
    }
  }
}

export const log = {
  debug: (msg: string, data?: unknown) => write('debug', msg, data),
  info: (msg: string, data?: unknown) => write('info', msg, data),
  warn: (msg: string, data?: unknown) => write('warn', msg, data),
  error: (msg: string, data?: unknown) => write('error', msg, data),

  /** Enable debug-level logging. */
  enableDebug(): void {
    minLevel = 'debug';
  },

  /** Enable logging to ~/.notebooklm/debug.log. */
  enableFileLog(): void {
    logToFile = true;
  },

  /** Get the log file path. */
  getLogPath,
};
