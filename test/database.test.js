import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Database } from '../src/storage/database.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

test('creates, saves and reloads configuration atomically', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'security-bot-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'config.json');

  const first = new Database(file, silent);
  await first.init();
  assert.equal(await first.getGuildConfig('111111111111111111'), null);

  await first.saveGuildConfig('111111111111111111', {
    verificationChannelId: '222222222222222222',
    verificationMessageId: '333333333333333333',
    unverifiedRoleId: '444444444444444444',
    memberRoleId: '555555555555555555',
    configuredBy: '666666666666666666',
  });
  await first.flush();

  const second = new Database(file, silent);
  await second.init();
  const loaded = await second.getGuildConfig('111111111111111111');
  assert.equal(loaded.verificationChannelId, '222222222222222222');
  assert.equal(loaded.memberRoleId, '555555555555555555');
  assert.ok(loaded.updatedAt);

  const raw = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(raw.version, 1);
  assert.equal(raw.guilds['111111111111111111'].verificationMessageId, '333333333333333333');
});

test('does not overwrite an invalid configuration file', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'security-bot-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'config.json');
  await writeFile(file, '{ not valid json', 'utf8');

  const database = new Database(file, silent);
  await assert.rejects(database.init());
  assert.equal(await readFile(file, 'utf8'), '{ not valid json');
});
