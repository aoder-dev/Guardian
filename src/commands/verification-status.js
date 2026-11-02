import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  getPermissionIssues,
  resolveVerificationRoles,
  ROLE_NAMES,
} from '../utils/roleManager.js';
import { formatError } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('verification-status')
  .setDescription('Check the verification system configuration')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

const GATEWAY_STATES = {
  0: 'READY',
  1: 'CONNECTING',
  2: 'RECONNECTING',
  3: 'IDLE',
  4: 'NEARLY',
  5: 'DISCONNECTED',
  6: 'WAITING_FOR_GUILDS',
  7: 'IDENTIFYING',
  8: 'RESUMING',
};

function formatUptime(milliseconds) {
  if (!milliseconds) return 'unknown';
  const seconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

function roleField(guild, name, savedId) {
  const matches = guild.roles.cache.filter((role) => role.name === name);
  if (matches.size === 0) return `❌ No role named \`${name}\` was found.`;
  if (matches.size > 1) return `❌ ${matches.size} roles are named \`${name}\`; keep exactly one.`;
  const role = matches.first();
  const saved = savedId ? (savedId === role.id ? ' (saved ID matches)' : ' (saved ID does not match)') : '';
  return `✅ <@&${role.id}>${saved}`;
}

export async function execute(interaction, client) {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.guildId !== client.config.guildId) {
    await interaction.reply({ content: 'This bot is configured for a different server.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Administrator permission is required.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  const issues = [];
  const fields = [];

  let saved = null;
  try {
    saved = await client.db.getGuildConfig(guild.id);
  } catch (error) {
    client.logger.error('Could not read configuration for status', { guildId: guild.id, error: formatError(error) });
    issues.push('Persistent configuration could not be read.');
  }

  const updatedAt = saved ? Date.parse(saved.updatedAt) : Number.NaN;
  fields.push({
    name: 'Configuration',
    value: !saved
      ? '❌ Not configured. Run `/setup-verification`.'
      : Number.isFinite(updatedAt)
        ? `✅ Saved • updated <t:${Math.floor(updatedAt / 1000)}:R>`
        : '✅ Saved',
  });

  const channel = saved ? guild.channels.cache.get(saved.verificationChannelId) : null;
  if (saved) {
    if (!channel) {
      issues.push('The configured verification channel no longer exists.');
      fields.push({ name: 'Verification channel', value: '❌ Channel not found.' });
    } else {
      fields.push({ name: 'Verification channel', value: `✅ <#${channel.id}>` });
      if (saved.verificationMessageId) {
        try {
          await channel.messages.fetch(saved.verificationMessageId);
          fields.push({ name: 'Verification panel', value: `✅ Message saved (${saved.verificationMessageId}).` });
        } catch (error) {
          if (error?.code === 10008 || error?.status === 404) {
            issues.push('The saved verification panel message was deleted. Run `/setup-verification` again.');
            fields.push({ name: 'Verification panel', value: '❌ Saved panel message not found.' });
          } else {
            issues.push('The verification panel could not be checked.');
            fields.push({ name: 'Verification panel', value: '⚠️ Could not verify the saved message.' });
          }
        }
      }
    }
  } else {
    fields.push({ name: 'Verification channel', value: '❌ Not configured.' });
  }

  fields.push({
    name: '`unverifed` role',
    value: roleField(guild, ROLE_NAMES.unverified, saved?.unverifiedRoleId),
  });
  fields.push({
    name: '`member` role',
    value: roleField(guild, ROLE_NAMES.member, saved?.memberRoleId),
  });

  let roles = null;
  if (saved) {
    try {
      roles = resolveVerificationRoles(guild, saved);
      fields.push({ name: 'Role hierarchy', value: '✅ Bot role is above both verification roles.' });
    } catch (error) {
      issues.push(error.message);
      fields.push({ name: 'Role hierarchy', value: `❌ ${error.message}` });
    }
  } else {
    fields.push({ name: 'Role hierarchy', value: '⚠️ Not checked until setup is complete.' });
  }

  if (channel) {
    const permissionIssues = getPermissionIssues(guild, channel);
    if (permissionIssues.length === 0) {
      fields.push({ name: 'Bot permissions', value: '✅ Manage Roles and all required channel permissions are present.' });
    } else {
      issues.push(`Missing permissions: ${permissionIssues.join(', ')}.`);
      fields.push({ name: 'Bot permissions', value: `❌ Missing: ${permissionIssues.join(', ')}.` });
    }
  } else {
    const manageRoles = guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles);
    fields.push({
      name: 'Bot permissions',
      value: manageRoles ? '✅ Manage Roles is present; channel permissions are checked after setup.' : '❌ Manage Roles is missing.',
    });
    if (!manageRoles) issues.push('The bot is missing Manage Roles.');
  }

  const gatewayState = GATEWAY_STATES[client.ws.status] ?? `UNKNOWN (${client.ws.status})`;
  fields.push({
    name: 'Discord gateway',
    value: client.isReady()
      ? `✅ Connected • ${client.ws.ping} ms • ${gatewayState}`
      : `⚠️ ${gatewayState} • not ready`,
  });
  fields.push({ name: 'Bot uptime', value: formatUptime(client.uptime) });

  if (issues.length > 0) {
    fields.push({
      name: 'Needs attention',
      value: issues.map((issue) => `• ${issue}`).join('\n').slice(0, 1024),
    });
  }

  const embed = {
    color: issues.length > 0 ? 0xe67e22 : 0x2ecc71,
    title: 'Verification status',
    description:
      issues.length > 0
        ? 'The verification system needs attention. Details are below.'
        : 'The verification system is configured and ready.',
    fields,
    footer: { text: `Security • ${roles ? 'roles resolved' : 'configuration check'}` },
    timestamp: new Date().toISOString(),
  };

  await interaction.editReply({ embeds: [embed] });
}

export default { data, execute };
