import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTransientError, withRetry } from '../src/utils/retry.js';

test('retries temporary failures and then succeeds', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error('server error'), { status: 503 });
    return 'ok';
  }, { attempts: 3, baseDelay: 1 });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('does not retry permission failures', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls += 1;
      throw Object.assign(new Error('missing permissions'), { status: 403 });
    }, { attempts: 3, baseDelay: 1 }),
    /missing permissions/,
  );
  assert.equal(calls, 1);
});

test('classifies rate limits, server errors and network failures as transient', () => {
  assert.equal(isTransientError({ status: 429 }), true);
  assert.equal(isTransientError({ status: 500 }), true);
  assert.equal(isTransientError({ code: 'ECONNRESET' }), true);
  assert.equal(isTransientError({ status: 403 }), false);
});
