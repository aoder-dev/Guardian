import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { withRetry } from './retry.js';
import { alertAdministrators, formatError } from './logger.js';

export const VERIFY_BUTTON_ID = 'security:verify:v1';
export const VERIFICATION_MESSAGE =
  'This server requires you to verify yourself to get access to other channels. You can simply verify by clicking on the verify button.';
export const ROLE_NAMES = Object.freeze({ unverified: 'unverifed', member: 'member' });

export const CHANNEL_PERMISSIONS = Object.freeze([
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
  [PermissionFlagsBits.AttachFiles, 'Attach Files'],
  [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
]);

export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class VerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VerificationError';
  }
}

function findRole(guild, name, savedId) {
  const matches = guild.roles.cache.filter((role) => role.name === name);
  if (matches.size === 0) {
    throw new ConfigurationError(`The role "${name}" does not exist. Create it, then run /setup-verification again.`);
  }
  if (matches.size > 1) {
    throw new ConfigurationError(`There are ${matches.size} roles named "${name}". Keep exactly one role with that name.`);
  }
  const role = matches.first();
  if (role.managed) {
    throw new ConfigurationError(`The role "${name}" is managed by an integration and cannot be assigned by this bot.`);
  }
  if (savedId && savedId !== role.id) {
    throw new ConfigurationError(`The saved ID for "${name}" no longer matches the role with that name. Run /setup-verification again.`);
  }
  return role;
}

export function resolveVerificationRoles(guild, saved = null) {
  const me = guild.members.me;
  if (!me) throw new ConfigurationError('The bot is not a member of this server.');
  const unverifiedRole = findRole(guild, ROLE_NAMES.unverified, saved?.unverifiedRoleId);
  const memberRole = findRole(guild, ROLE_NAMES.member, saved?.memberRoleId);
  const highest = me.roles.highest.position;
  for (const role of [unverifiedRole, memberRole]) {
    if (role.position >= highest) {
      throw new ConfigurationError(
        `The bot's highest role must be above "${role.name}". Move the bot role higher under Server Settings > Roles.`,
      );
    }
  }
  return { unverifiedRole, memberRole };
}

export function getPermissionIssues(guild, channel) {
  const me = guild.members.me;
  const issues = [];
  if (!me) return ['The bot is not a guild member.'];
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) issues.push('Manage Roles');
  const permissions = channel?.permissionsFor(me);
  for (const [bit, label] of CHANNEL_PERMISSIONS) {
    if (!permissions?.has(bit)) issues.push(label);
  }
  return issues;
}

export function assertSetupPermissions(guild, channel) {
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    throw new ConfigurationError('Choose a text or announcement channel for verification.');
  }
  if (channel.guildId !== guild.id) {
    throw new ConfigurationError('The selected channel must belong to this server.');
  }
  const issues = getPermissionIssues(guild, channel);
  if (issues.length > 0) {
    throw new ConfigurationError(
      `The bot is missing permissions in <#${channel.id}>: ${issues.join(', ')}. Update the channel permissions and try again.`,
    );
  }
}

export function validateSetup(guild, channel, saved = null) {
  const roles = resolveVerificationRoles(guild, saved);
  assertSetupPermissions(guild, channel);
  return roles;
}

async function addRole(member, role, logger) {
  await withRetry(() => member.roles.add(role, 'Security verification'), {
    label: `add role ${role.name}`,
    logger,
  });
}

async function removeRole(member, role, logger) {
  await withRetry(() => member.roles.remove(role, 'Security verification'), {
    label: `remove role ${role.name}`,
    logger,
  });
}

async function refreshMember(guild, userId, logger) {
  try {
    return await withRetry(
      () => guild.members.fetch({ user: userId, force: true }),
      { label: 'fetch member', logger },
    );
  } catch (error) {
    if (error?.code === 10007 || error?.status === 404) {
      throw new VerificationError('You are no longer a member of this server.');
    }
    throw error;
  }
}

export async function applyJoinRoles(guild, userId, roles, logger) {
  const member = await refreshMember(guild, userId, logger);
  let changed = false;

  if (!member.roles.cache.has(roles.unverifiedRole.id)) {
    await addRole(member, roles.unverifiedRole, logger);
    changed = true;
  }
  if (member.roles.cache.has(roles.memberRole.id)) {
    await removeRole(member, roles.memberRole, logger);
    changed = true;
  }

  const final = await refreshMember(guild, userId, logger);
  if (!final.roles.cache.has(roles.unverifiedRole.id) || final.roles.cache.has(roles.memberRole.id)) {
    throw new VerificationError('The join role update could not be confirmed.');
  }
  return { changed };
}

/**
 * Perform the verified transition. On partial failure, restore the unverified state and
 * never report success unless a fresh member fetch confirms both role changes.
 */
export async function verifyMember(guild, userId, roles, logger) {
  const member = await refreshMember(guild, userId, logger);
  const hasUnverified = member.roles.cache.has(roles.unverifiedRole.id);
  const hasMember = member.roles.cache.has(roles.memberRole.id);

  if (hasMember && !hasUnverified) return { status: 'already' };
  if (!hasMember && !hasUnverified) {
    throw new VerificationError('Your account is not in the unverified state. Please contact an administrator.');
  }

  // Repair an inconsistent account that already has both roles.
  if (hasMember && hasUnverified) {
    try {
      await removeRole(member, roles.unverifiedRole, logger);
      const final = await refreshMember(guild, userId, logger);
      if (!final.roles.cache.has(roles.memberRole.id) || final.roles.cache.has(roles.unverifiedRole.id)) {
        throw new Error('Role state could not be confirmed.');
      }
      return { status: 'verified' };
    } catch (error) {
      logger.error('Could not repair an account with both verification roles', {
        guildId: guild.id,
        userId,
        error: formatError(error),
      });
      await alertAdministrators(guild, logger, 'verification-repair');
      throw new VerificationError('Verification could not be completed. Please contact an administrator.');
    }
  }

  let addedMember = false;
  try {
    await addRole(member, roles.memberRole, logger);
    addedMember = true;
    await removeRole(member, roles.unverifiedRole, logger);

    const final = await refreshMember(guild, userId, logger);
    if (!final.roles.cache.has(roles.memberRole.id) || final.roles.cache.has(roles.unverifiedRole.id)) {
      throw new Error('Role state could not be confirmed after verification.');
    }
    return { status: 'verified' };
  } catch (error) {
    logger.error('Verification failed; attempting to restore the unverified state', {
      guildId: guild.id,
      userId,
      addedMember,
      error: formatError(error),
    });

    let restored = false;
    try {
      const current = await refreshMember(guild, userId, logger);
      if (!current.roles.cache.has(roles.unverifiedRole.id)) {
        await addRole(current, roles.unverifiedRole, logger);
      }
      if (addedMember && current.roles.cache.has(roles.memberRole.id)) {
        await removeRole(current, roles.memberRole, logger);
      }
      const final = await refreshMember(guild, userId, logger);
      restored = final.roles.cache.has(roles.unverifiedRole.id) && !final.roles.cache.has(roles.memberRole.id);
      if (!restored) throw new Error('Rollback did not produce the expected role state.');
    } catch (rollbackError) {
      logger.error('Verification rollback failed; administrator action is required', {
        guildId: guild.id,
        userId,
        error: formatError(rollbackError),
      });
      await alertAdministrators(guild, logger, 'verification-rollback');
    }

    throw new VerificationError(
      restored
        ? 'Verification could not be completed. Your unverified status was restored. Please try again or contact an administrator.'
        : 'Verification could not be completed. Please contact an administrator immediately.',
    );
  }
}
