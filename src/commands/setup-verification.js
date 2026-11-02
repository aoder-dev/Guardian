import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { buildVerificationPanel } from '../handlers/panelBuilder.js';
import { ConfigurationError, validateSetup } from '../utils/roleManager.js';
import { formatError } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('setup-verification')
  .setDescription('Create or update the member verification panel')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addChannelOption((option) =>
    option
      .setName('channel')
      .setDescription('Channel where the verification panel should be published')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(true),
  );

function isUnknownResource(error) {
  return error?.code === 10003 || error?.code === 10008 || error?.status === 404;
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
  const channel = interaction.options.getChannel('channel', true);
  const { db, logger } = client;

  try {
    const previous = await db.getGuildConfig(guild.id);
    const roles = validateSetup(guild, channel, previous);

    let message = null;
    let created = false;

    if (
      previous?.verificationChannelId === channel.id &&
      previous?.verificationMessageId
    ) {
      try {
        const existing = await channel.messages.fetch(previous.verificationMessageId);
        await existing.edit(buildVerificationPanel(client));
        message = existing;
      } catch (error) {
        if (!isUnknownResource(error)) throw error;
        logger.warn('The saved verification message no longer exists; creating a new panel', {
          guildId: guild.id,
          channelId: channel.id,
        });
      }
    }

    if (!message) {
      if (previous?.verificationChannelId && previous.verificationChannelId !== channel.id) {
        try {
          const oldChannel = await guild.channels.fetch(previous.verificationChannelId);
          const oldMessage = await oldChannel.messages.fetch(previous.verificationMessageId);
          await oldMessage.delete();
        } catch (error) {
          if (!isUnknownResource(error)) {
            throw new ConfigurationError(
              'The old verification panel could not be removed. Restore access to the old channel, or delete the panel manually, then try again.',
            );
          }
        }
      }

      try {
        message = await channel.send(buildVerificationPanel(client));
        created = true;
      } catch (error) {
        logger.error('Could not publish the verification panel', {
          guildId: guild.id,
          channelId: channel.id,
          error: formatError(error),
        });
        throw new ConfigurationError(
          'The verification panel could not be published. Check the bot channel permissions and try again.',
        );
      }
    }

    try {
      await db.saveGuildConfig(guild.id, {
        verificationChannelId: channel.id,
        verificationMessageId: message.id,
        unverifiedRoleId: roles.unverifiedRole.id,
        memberRoleId: roles.memberRole.id,
        configuredBy: interaction.user.id,
      });
    } catch (error) {
      logger.error('Could not save verification configuration', { guildId: guild.id, error: formatError(error) });
      if (created) {
        await message.delete().catch((deleteError) => {
          logger.warn('Could not remove an unsaved verification panel', {
            guildId: guild.id,
            messageId: message.id,
            error: formatError(deleteError),
          });
        });
      }
      throw new ConfigurationError(
        'The panel settings could not be saved. Check the data directory permissions and run the command again.',
      );
    }

    logger.info('Verification panel configured', {
      guildId: guild.id,
      channelId: channel.id,
      messageId: message.id,
      updated: !created,
    });
    await interaction.editReply({
      content:
        `✅ Verification panel is ready in <#${channel.id}>.\n\n` +
        'Make sure `@everyone` cannot view member-only channels, `member` can view them, and `unverifed` can view the verification channel. ' +
        'The bot role must stay above both roles.',
    });
  } catch (error) {
    if (error instanceof ConfigurationError) {
      await interaction.editReply({ content: `⚠️ ${error.message}` });
      return;
    }
    logger.error('Unexpected setup failure', { guildId: guild.id, error: formatError(error) });
    await interaction.editReply({
      content: '⚠️ Setup could not be completed. Check the bot logs and try again.',
    });
  }
}

export default { data, execute };
