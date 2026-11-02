import { Events, MessageFlags } from 'discord.js';
import { handleVerificationButton } from '../handlers/verificationHandler.js';
import { formatError } from '../utils/logger.js';

async function respondWithGenericError(interaction) {
  if (!interaction.isRepliable()) return;
  const payload = { content: 'Something went wrong. Please try again later.', flags: MessageFlags.Ephemeral };
  try {
    if (interaction.deferred) await interaction.editReply({ content: payload.content });
    else if (interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch {
    // The interaction may have expired; avoid throwing from the error path.
  }
}

export default {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    const { logger } = client;
    try {
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) {
          logger.warn('Received an unregistered command', { command: interaction.commandName });
          await respondWithGenericError(interaction);
          return;
        }
        await command.execute(interaction, client);
        return;
      }

      if (interaction.isButton()) {
        await handleVerificationButton(interaction, client);
      }
    } catch (error) {
      logger.error('Interaction handling failed', {
        type: interaction.type,
        command: interaction.isChatInputCommand() ? interaction.commandName : undefined,
        customId: interaction.isButton() ? interaction.customId : undefined,
        error: formatError(error),
      });
      await respondWithGenericError(interaction);
    }
  },
};
