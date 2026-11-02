import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client, Collection, Events, GatewayIntentBits } from 'discord.js';
import { loadConfig } from './config/config.js';
import { createLogger, formatError } from './utils/logger.js';
import { Database } from './storage/database.js';
import { startHealthServer } from './utils/healthServer.js';

const COMMAND_DIRECTORY = fileURLToPath(new URL('./commands/', import.meta.url));
const EVENT_DIRECTORY = fileURLToPath(new URL('./events/', import.meta.url));

async function loadCommands(client, logger) {
  const files = (await readdir(COMMAND_DIRECTORY)).filter((file) => file.endsWith('.js'));
  for (const file of files) {
    const module = await import(new URL(`./commands/${file}`, import.meta.url));
    const command = module.default;
    if (!command?.data?.name || typeof command.execute !== 'function') {
      throw new Error(`Command module ${file} must export data and execute.`);
    }
    client.commands.set(command.data.name, command);
  }
  logger.info('Loaded slash commands', { commands: client.commands.map((command) => command.data.name) });
}

async function loadEvents(client, logger) {
  const files = (await readdir(EVENT_DIRECTORY)).filter((file) => file.endsWith('.js'));
  for (const file of files) {
    const module = await import(new URL(`./events/${file}`, import.meta.url));
    const event = module.default;
    if (!event?.name || typeof event.execute !== 'function') {
      throw new Error(`Event module ${file} must export name and execute.`);
    }
    const handler = (...args) => {
      Promise.resolve(event.execute(...args, client)).catch((error) => {
        logger.error(`Event ${event.name} failed`, { error: formatError(error) });
      });
    };
    if (event.once) client.once(event.name, handler);
    else client.on(event.name, handler);
  }
  logger.info('Loaded gateway events', { events: files.length });
}

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  logger.info('Starting Security verification bot', { node: process.version });

  const db = new Database(config.dataFile, logger);
  await db.init();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    allowedMentions: { parse: [] },
    rest: { timeout: 15_000, retries: 3 },
  });
  client.config = config;
  client.logger = logger;
  client.db = db;
  client.commands = new Collection();

  await loadCommands(client, logger);
  await loadEvents(client, logger);

  let healthServer = null;
  let shuttingDown = false;

  async function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { code });
    const forceExit = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      if (healthServer) {
        healthServer.close();
        healthServer.closeAllConnections?.();
      }
      await db.flush();
      await client.destroy();
      clearTimeout(forceExit);
      logger.info('Shutdown complete');
      process.exit(code);
    } catch (error) {
      logger.error('Error during shutdown', { error: formatError(error) });
      clearTimeout(forceExit);
      process.exit(1);
    }
  }

  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', {
      error: reason instanceof Error ? formatError(reason) : { message: String(reason) },
    });
  });
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: formatError(error) });
    void shutdown(1);
  });

  client.on(Events.Error, (error) => logger.error('Discord client error', { error: formatError(error) }));
  client.on(Events.Warn, (message) => logger.warn('Discord client warning', { message }));
  client.on(Events.ShardDisconnect, (event, shardId) => {
    logger.warn('Discord gateway disconnected; discord.js will reconnect', { shardId, code: event.code });
  });
  client.on(Events.ShardResume, (shardId, replayedEvents) => {
    logger.info('Discord gateway session resumed', { shardId, replayedEvents });
  });
  client.on(Events.ShardError, (error, shardId) => {
    logger.error('Discord gateway shard error', { shardId, error: formatError(error) });
  });
  client.on(Events.Invalidated, () => {
    logger.error('Discord session was invalidated. A new login is required; check the bot token and developer portal settings.');
  });

  if (config.port) healthServer = startHealthServer(config.port, client, logger);

  try {
    await client.login(config.token);
  } catch (error) {
    logger.error('Discord login failed. Check DISCORD_TOKEN, Server Members Intent, and that the bot is invited.', {
      error: formatError(error),
    });
    await shutdown(1);
  }
}

main().catch((error) => {
  console.error(`Startup failed: ${formatError(error).message}`);
  process.exit(1);
});
