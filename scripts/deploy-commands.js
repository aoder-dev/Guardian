import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { REST, Routes } from 'discord.js';
import { loadConfig } from '../src/config/config.js';
import { formatError } from '../src/utils/logger.js';

const commandDirectory = fileURLToPath(new URL('../src/commands/', import.meta.url));

async function main() {
  const config = loadConfig();
  const files = (await readdir(commandDirectory)).filter((file) => file.endsWith('.js'));
  const commands = [];

  for (const file of files) {
    const module = await import(new URL(`../src/commands/${file}`, import.meta.url));
    const command = module.default;
    if (!command?.data?.name) throw new Error(`Command module ${file} does not export a default command.`);
    commands.push(command.data.toJSON());
  }

  const rest = new REST({ version: '10' }).setToken(config.token);
  const registered = await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: commands },
  );
  console.log(`Registered ${registered.length} guild commands: ${registered.map((command) => `/${command.name}`).join(', ')}`);
}

main().catch((error) => {
  console.error(`Command registration failed: ${formatError(error).message}`);
  process.exitCode = 1;
});
