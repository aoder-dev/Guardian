import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { BANNER_FILENAME, BANNER_PATH, buildVerificationPanel } from '../src/handlers/panelBuilder.js';
import { VERIFICATION_MESSAGE, VERIFY_BUTTON_ID } from '../src/utils/roleManager.js';

test('builds the verification embed with the local banner and persistent primary button', async () => {
  const client = {
    user: { displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/avatar.png' },
  };
  const payload = buildVerificationPanel(client);
  const embed = payload.embeds[0].data;
  const row = payload.components[0].toJSON();
  const button = row.components[0];

  assert.equal(embed.description, VERIFICATION_MESSAGE);
  assert.equal(embed.image.url, `attachment://${BANNER_FILENAME}`);
  assert.equal(embed.author.name, 'Security');
  assert.equal(button.label, 'Verify');
  assert.equal(button.style, 1);
  assert.equal(button.custom_id, VERIFY_BUTTON_ID);
  assert.equal(payload.files[0].name, BANNER_FILENAME);

  const info = await stat(BANNER_PATH);
  assert.ok(info.size > 10_000, 'banner should be a real image');
  const png = await readFile(BANNER_PATH);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
