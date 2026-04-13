import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';

export const DB_BROADCAST_LOG_PREFIX = '[db-broadcast]' as const;

export function prefixMultiline(prefix: string, message: string): string {
  const p = prefix.endsWith(' ') ? prefix : `${prefix} `;
  return `${p}${message}`.replace(/\n/g, `\n${p}`);
}

function safeStringify(arg: unknown): string {
  try {
    return JSON.stringify(arg, null, 2);
  } catch {
    return String(arg);
  }
}

export function logDbBroadcast(
  logger: Logger<ILogObj>,
  level: 'debug' | 'info' | 'warn' | 'error',
  ...args: unknown[]
): void {
  const message = args
    .map((arg) => (typeof arg === 'string' ? arg : safeStringify(arg)))
    .join(' ');

  logger[level](prefixMultiline(DB_BROADCAST_LOG_PREFIX, message));
}
