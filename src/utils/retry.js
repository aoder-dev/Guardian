import { formatError } from './logger.js';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

export function isTransientError(error) {
  const status = Number(error?.status ?? error?.httpStatus);
  return status === 429 || (status >= 500 && status < 600) || TRANSIENT_CODES.has(error?.code) || error?.name === 'AbortError';
}

/**
 * Retry only transient Discord/network failures. Permission and hierarchy errors are final.
 */
export async function withRetry(task, { attempts = 3, baseDelay = 500, label = 'operation', logger } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= attempts || !isTransientError(error)) throw error;
      const delay = baseDelay * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      logger?.warn('Retrying a temporary Discord request', {
        label,
        attempt,
        delayMs: delay,
        error: formatError(error),
      });
      await sleep(delay);
    }
  }
}
