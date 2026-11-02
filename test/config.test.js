import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from '../src/config/config.js';

const base = {
  DISCORD_TOKEN: 'a'.repeat(60),
  CLIENT_ID: '123456789012345678',
  GUILD_ID: '987654321098765432',
};

test('loads a complete configuration', () => {
  const config = loadConfig({ ...base, PORT: '3000', LOG_LEVEL: 'debug', DATA_FILE: 'data/custom.json' });
  assert.equal(config.clientId, base.CLIENT_ID);
  assert.equal(config.guildId, base.GUILD_ID);
  assert.equal(config.port, 3000);
  assert.equal(config.logLevel, 'debug');
  assert.match(config.dataFile, /data[/\\]custom\.json$/);
});

test('rejects a missing token without echoing secrets', () => {
  const secret = 'never-print-this-secret-token';
  assert.throws(
    () => loadConfig({ ...base, DISCORD_TOKEN: '' }),
    (error) => error instanceof ConfigError && !error.message.includes(secret),
  );
});

test('rejects placeholder, malformed IDs and invalid ports', () => {
  assert.throws(() => loadConfig({ ...base, DISCORD_TOKEN: 'PUT_YOUR_NEW_BOT_TOKEN_HERE' }), ConfigError);
  assert.throws(() => loadConfig({ ...base, CLIENT_ID: 'not-an-id' }), ConfigError);
  assert.throws(() => loadConfig({ ...base, GUILD_ID: '' }), ConfigError);
  assert.throws(() => loadConfig({ ...base, PORT: '99999' }), ConfigError);
});
