import { test } from 'node:test';
import assert from 'node:assert/strict';
import setup from '../src/commands/setup-verification.js';
import status from '../src/commands/verification-status.js';

test('registers the two administrator guild commands with the expected options', () => {
  const setupJson = setup.data.toJSON();
  const statusJson = status.data.toJSON();
  assert.equal(setupJson.name, 'setup-verification');
  assert.equal(setupJson.default_member_permissions, '8');
  assert.equal(setupJson.options[0].name, 'channel');
  assert.deepEqual(setupJson.options[0].channel_types, [0, 5]);
  assert.equal(statusJson.name, 'verification-status');
  assert.equal(statusJson.default_member_permissions, '8');
});
