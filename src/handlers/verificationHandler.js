import { MessageFlags } from 'discord.js';
import {
  ConfigurationError,
  VERIFY_BUTTON_ID,
  VerificationError,
  resolveVerificationRoles,
  verifyMember,
} from '../utils/roleManager.js';
import { withUserLock } from '../utils/userLocks.js';
import { formatError } from '../utils/logger.js';

const recentInteractions = new Map();
const INTERACTION_TTL_MS = 10 * 60 * 1000;

function seenRecently(interactionId) {
  const now = Date.now();
  for (const [id, timestamp] of recentInteractions) {
    if (now - timestamp > INTERACTION_TTL_MS) recentInteractions.delete(id);
  }
  if (recentInteractions.has(interactionId)) return true;
  recentInteractions.set(interactionId, now);
  return false;
}

async function respondPrivately(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
  } catch {
    // The interaction token may have expired; there is nothing else safe to do.
  }
}

/**
 * Only the persistent Verify button is accepted. Every other custom ID is ignored.
 */
export async function handleVerificationButton(interaction, client) {
  if (!interaction.isButton() || interaction.customId !== VERIFY_BUTTON_ID) return false;

  if (seenRecently(interaction.id)) {
    await respondPrivately(interaction, 'This request is already being processed.');
    return true;
  }

  const { config, db, logger } = client;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (error) {
    logger.warn('Could not acknowledge the verification interaction', { error: formatError(error) });
    return true;
  }

  if (interaction.guildId !== config.guildId || !interaction.guild) {
    await respondPrivately(interaction, 'This verification panel is not available in this server.');
    return true;
  }

  let saved;
  try {
    saved = await db.getGuildConfig(config.guildId);
  } catch (error) {
    logger.error('Could not read verification configuration', { error: formatError(error) });
    await respondPrivately(interaction, 'Verification is temporarily unavailable. Please try again later.');
    return true;
  }

  if (!saved) {
    await respondPrivately(interaction, 'Verification has not been configured yet. Please contact an administrator.');
    return true;
  }

  if (
    interaction.channelId !== saved.verificationChannelId ||
    interaction.message?.id !== saved.verificationMessageId
  ) {
    await respondPrivately(interaction, 'This verification panel is no longer active. Please contact an administrator.');
    return true;
  }

  try {
    const result = await withUserLock(config.guildId, interaction.user.id, async () => {
      const roles = resolveVerificationRoles(interaction.guild, saved);
      return verifyMember(interaction.guild, interaction.user.id, roles, logger);
    });
    await respondPrivately(
      interaction,
      result.status === 'already' ? 'You are already verified!' : 'You have been verified successfully!',
    );
  } catch (error) {
    if (error instanceof ConfigurationError) {
      logger.error('Verification is misconfigured', {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        error: formatError(error),
      });
      await respondPrivately(
        interaction,
        'Verification is not configured correctly. Please contact an administrator.',
      );
    } else if (error instanceof VerificationError) {
      logger.warn('Verification was not completed', {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        error: formatError(error),
      });
      await respondPrivately(interaction, error.message);
    } else {
      logger.error('Unexpected verification failure', {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        error: formatError(error),
      });
      await respondPrivately(interaction, 'Verification could not be completed. Please contact an administrator.');
    }
  }
  return true;
}
