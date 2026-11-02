import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection, PermissionFlagsBits } from 'discord.js';
import {
  ConfigurationError,
  VerificationError,
  applyJoinRoles,
  resolveVerificationRoles,
  validateSetup,
  verifyMember,
} from '../src/utils/roleManager.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const defaultRoles = [
  { id: 'unverified', name: 'unverifed', managed: false, position: 1 },
  { id: 'member', name: 'member', managed: false, position: 2 },
  { id: 'botrole', name: 'Security', managed: false, position: 10 },
];

function build({
  roleDefinitions = defaultRoles,
  initialRoles = [],
  botPosition = 10,
  manageRoles = true,
  channelPermissions = true,
  failAdd = null,
  failRemove = null,
} = {}) {
  const roleMap = new Map(roleDefinitions.map((role) => [role.id, role]));
  const cache = new Collection(roleMap);
  const current = new Set(initialRoles);
  const member = {
    id: 'user',
    roles: {
      cache: new Collection([...current].map((id) => [id, roleMap.get(id)])),
      async add(role) {
        if (failAdd === role.id) throw Object.assign(new Error('Missing Permissions'), { status: 403 });
        current.add(role.id);
        member.roles.cache.set(role.id, role);
      },
      async remove(role) {
        if (failRemove === role.id) throw Object.assign(new Error('Missing Permissions'), { status: 403 });
        current.delete(role.id);
        member.roles.cache.delete(role.id);
      },
    },
  };
  const me = {
    id: 'bot',
    permissions: { has: () => manageRoles },
    roles: { highest: { position: botPosition }, cache: new Collection() },
  };
  const guild = {
    id: 'guild',
    roles: { cache },
    members: {
      me,
      fetch: async () => member,
    },
    fetchOwner: async () => ({ send: async () => {} }),
    systemChannel: null,
  };
  const channel = {
    id: 'channel',
    type: ChannelType.GuildText,
    guildId: 'guild',
    permissionsFor: () => ({ has: () => channelPermissions }),
  };
  return { guild, channel, current, roles: roleMap };
}

test('resolves exactly one unverifed and one member role', () => {
  const { guild } = build();
  const roles = resolveVerificationRoles(guild);
  assert.equal(roles.unverifiedRole.id, 'unverified');
  assert.equal(roles.memberRole.id, 'member');
});

test('rejects missing, duplicate, managed and higher roles', () => {
  assert.throws(
    () => resolveVerificationRoles(build({ roleDefinitions: defaultRoles.filter((role) => role.id !== 'member') }).guild),
    ConfigurationError,
  );
  assert.throws(
    () => resolveVerificationRoles(build({
      roleDefinitions: [...defaultRoles, { id: 'second-member', name: 'member', managed: false, position: 3 }],
    }).guild),
    /exactly one|There are 2 roles/i,
  );
  assert.throws(
    () => resolveVerificationRoles(build({
      roleDefinitions: defaultRoles.map((role) => (role.id === 'member' ? { ...role, managed: true } : role)),
    }).guild),
    /managed/i,
  );
  assert.throws(() => resolveVerificationRoles(build({ botPosition: 2 }).guild), /above/i);
});

test('rejects a saved role ID that no longer matches the role name', () => {
  const { guild } = build();
  assert.throws(
    () => resolveVerificationRoles(guild, { unverifiedRoleId: 'old-id', memberRoleId: 'member' }),
    /saved ID/i,
  );
});

test('validates channel type, Manage Roles and channel permissions', () => {
  const { guild, channel } = build();
  assert.doesNotThrow(() => validateSetup(guild, channel));
  const noManageRoles = build({ manageRoles: false });
  assert.throws(() => validateSetup(noManageRoles.guild, noManageRoles.channel), /Manage Roles/);
  const noChannelPermissions = build({ channelPermissions: false });
  assert.throws(() => validateSetup(noChannelPermissions.guild, noChannelPermissions.channel), /View Channel/);
  assert.throws(() => validateSetup(guild, { ...channel, type: ChannelType.GuildVoice }), /text or announcement/i);
});

test('join assignment adds unverifed and removes an accidental member role', async () => {
  const { guild, current } = build({ initialRoles: ['member'] });
  const roles = resolveVerificationRoles(guild);
  const result = await applyJoinRoles(guild, 'user', roles, silent);
  assert.equal(result.changed, true);
  assert.deepEqual([...current], ['unverified']);
});

test('verification succeeds, confirms state, and is idempotent', async () => {
  const { guild, current } = build({ initialRoles: ['unverified'] });
  const roles = resolveVerificationRoles(guild);
  assert.equal((await verifyMember(guild, 'user', roles, silent)).status, 'verified');
  assert.deepEqual([...current], ['member']);
  assert.equal((await verifyMember(guild, 'user', roles, silent)).status, 'already');
  assert.deepEqual([...current], ['member']);
});

test('an account with both roles is repaired to member only', async () => {
  const { guild, current } = build({ initialRoles: ['unverified', 'member'] });
  const roles = resolveVerificationRoles(guild);
  assert.equal((await verifyMember(guild, 'user', roles, silent)).status, 'verified');
  assert.deepEqual([...current], ['member']);
});

test('refuses a user without either verification role', async () => {
  const { guild, current } = build();
  const roles = resolveVerificationRoles(guild);
  await assert.rejects(verifyMember(guild, 'user', roles, silent), VerificationError);
  assert.deepEqual([...current], []);
});

test('partial failure rolls back member and keeps the user unverified', async () => {
  const { guild, current } = build({ initialRoles: ['unverified'], failRemove: 'unverified' });
  const roles = resolveVerificationRoles(guild);
  await assert.rejects(verifyMember(guild, 'user', roles, silent), /could not be completed/i);
  assert.deepEqual([...current], ['unverified']);
});

test('failed member addition leaves the unverified state intact', async () => {
  const { guild, current } = build({ initialRoles: ['unverified'], failAdd: 'member' });
  const roles = resolveVerificationRoles(guild);
  await assert.rejects(verifyMember(guild, 'user', roles, silent), /could not be completed/i);
  assert.deepEqual([...current], ['unverified']);
});
