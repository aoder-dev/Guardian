import { Events } from 'discord.js';
import {
  ConfigurationError,
  VerificationError,
  applyJoinRoles,
  resolveVerificationRoles,
} from '../utils/roleManager.js';
import { withUserLock } from '../utils/userLocks.js';
import { alertAdministrators, formatError } from '../utils/logger.js';

export default {
  name: Events.GuildMemberAdd,
  async execute(member, client) {
    if (member.guild.id !== client.config.guildId) return;

    const { logger, db } = client;
    logger.info('Member joined; applying unverified role', {
      guildId: member.guild.id,
      userId: member.id,
    });

    try {
      await withUserLock(member.guild.id, member.id, async () => {
        const saved = await db.getGuildConfig(member.guild.id);
        if (!saved) {
          logger.error('Cannot assign unverifed because verification is not configured', {
            guildId: member.guild.id,
            userId: member.id,
          });
          await alertAdministrators(member.guild, logger, 'join-not-configured');
          return;
        }

        const roles = resolveVerificationRoles(member.guild, saved);
        const result = await applyJoinRoles(member.guild, member.id, roles, logger);
        logger.info('Unverified role assignment completed', {
          guildId: member.guild.id,
          userId: member.id,
          changed: result.changed,
        });
      });
    } catch (error) {
      if (error instanceof ConfigurationError) {
        logger.error('Join role assignment failed because the configuration is invalid', {
          guildId: member.guild.id,
          userId: member.id,
          error: formatError(error),
        });
        await alertAdministrators(member.guild, logger, 'join-configuration');
      } else if (error instanceof VerificationError && /no longer a member/i.test(error.message)) {
        logger.info('Member left before the unverified role could be assigned', {
          guildId: member.guild.id,
          userId: member.id,
        });
      } else {
        logger.error('Join role assignment failed', {
          guildId: member.guild.id,
          userId: member.id,
          error: formatError(error),
        });
        await alertAdministrators(member.guild, logger, 'join-role-update');
      }
    }
  },
};
