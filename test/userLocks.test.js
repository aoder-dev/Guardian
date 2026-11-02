import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withUserLock } from '../src/utils/userLocks.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('serializes operations for the same user', async () => {
  const events = [];
  const first = withUserLock('guild', 'user', async () => {
    events.push('first-start');
    await sleep(30);
    events.push('first-end');
  });
  const second = withUserLock('guild', 'user', async () => {
    events.push('second-start');
    events.push('second-end');
  });
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second-start', 'second-end']);
});

test('does not serialize different users', async () => {
  const events = [];
  await Promise.all([
    withUserLock('guild', 'one', async () => {
      await sleep(20);
      events.push('one');
    }),
    withUserLock('guild', 'two', async () => {
      events.push('two');
    }),
  ]);
  assert.deepEqual(events, ['two', 'one']);
});
