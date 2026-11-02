import { ActivityType, Events } from 'discord.js';
import { resolveVerificationRoles } from '../utils/roleManager.js';
import { formatError } from '../utils/logger.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    const { logger, config, db } = client;
    logger.info('Discord gateway is ready', {
      bot: client.user.tag,
      guilds: client.guilds.cache.size,
      commands: client.commands.size,
    });

    try {
      client.user.setPresence({
        status: 'online',
        activities: [{ name: 'member verification', type: ActivityType.Watching }],
      });
    } catch (error) {
      logger.warn('Could not set bot presence', { error: formatError(error) });
    }

    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) {
      logger.error(
        'The configured GUILD_ID is not available to this bot. Invite the bot to that server or correct GUILD_ID.',
        { guildId: config.guildId },
      );
      return;
    }

    let saved;
    try {
      saved = await db.getGuildConfig(guild.id);
    } catch (error) {
      logger.error('Could not read saved verification configuration at startup', {
        guildId: guild.id,
        error: formatError(error),
      });
      return;
    }

    if (!saved) {
      logger.warn('No verification panel is configured yet. An administrator must run /setup-verification.', {
        guildId: guild.id,
      });
      return;
    }

    try {
      const roles = resolveVerificationRoles(guild, saved);
      const channel = guild.channels.cache.get(saved.verificationChannelId);
      logger.info('Verification configuration loaded', {
        guildId: guild.id,
        channelId: channel?.id ?? saved.verificationChannelId,
        unverifiedRoleId: roles.unverifiedRole.id,
        memberRoleId: roles.memberRole.id,
      });
      if (!channel) {
        logger.error('The saved verification channel no longer exists. Run /setup-verification again.', {
          guildId: guild.id,
          channelId: saved.verificationChannelId,
        });
      }
    } catch (error) {
      logger.error('Saved verification configuration is not valid. Run /setup-verification again.', {
        guildId: guild.id,
        error: formatError(error),
      });
    }
  },
};
