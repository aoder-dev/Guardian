import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { VERIFICATION_MESSAGE, VERIFY_BUTTON_ID } from '../utils/roleManager.js';

export const BANNER_FILENAME = 'verification-banner.png';
export const BANNER_PATH = fileURLToPath(new URL('../../assets/verification-banner.png', import.meta.url));

export function buildVerificationPanel(client) {
  const embed = new EmbedBuilder()
    .setColor(0x2b6cff)
    .setAuthor({
      name: 'Security',
      iconURL: client.user.displayAvatarURL({ extension: 'png', size: 256 }),
    })
    .setDescription(VERIFICATION_MESSAGE)
    .setImage(`attachment://${BANNER_FILENAME}`)
    .setFooter({ text: 'Security • Member verification' });

  const button = new ButtonBuilder()
    .setCustomId(VERIFY_BUTTON_ID)
    .setLabel('Verify')
    .setStyle(ButtonStyle.Primary);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
    files: [
      new AttachmentBuilder(BANNER_PATH, {
        name: BANNER_FILENAME,
        description: 'Blue security shield with VERIFY NOW',
      }),
    ],
    allowedMentions: { parse: [] },
  };
}
