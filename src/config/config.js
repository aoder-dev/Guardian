import 'dotenv/config';
import path from 'node:path';

const SNOWFLAKE = /^\d{17,20}$/;
const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Validate environment configuration without ever including secret values in errors.
 */
export function loadConfig(env = process.env) {
  const errors = [];
  const token = String(env.DISCORD_TOKEN ?? '').trim();
  const clientId = String(env.CLIENT_ID ?? '').trim();
  const guildId = String(env.GUILD_ID ?? '').trim();

  if (!token) {
    errors.push('DISCORD_TOKEN is missing. Copy .env.example to .env and add your bot token.');
  } else if (/\s/.test(token)) {
    errors.push('DISCORD_TOKEN contains whitespace. Copy only the token value.');
  } else if (token === 'PUT_YOUR_NEW_BOT_TOKEN_HERE') {
    errors.push('DISCORD_TOKEN still contains the placeholder value.');
  }

  if (!SNOWFLAKE.test(clientId)) {
    errors.push('CLIENT_ID must be the numeric Application ID from the Discord Developer Portal.');
  }
  if (!SNOWFLAKE.test(guildId)) {
    errors.push('GUILD_ID must be the numeric ID of your Discord server.');
  }

  let port = null;
  if (env.PORT !== undefined && String(env.PORT).trim() !== '') {
    port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push('PORT must be an integer between 1 and 65535.');
    }
  }

  const logLevel = String(env.LOG_LEVEL ?? 'info').trim().toLowerCase();
  if (!LOG_LEVELS.has(logLevel)) {
    errors.push('LOG_LEVEL must be one of: debug, info, warn, error.');
  }

  if (errors.length > 0) {
    throw new ConfigError(`Invalid configuration:\n- ${errors.join('\n- ')}`);
  }

  return Object.freeze({
    token,
    clientId,
    guildId,
    port,
    logLevel,
    dataFile: path.resolve(String(env.DATA_FILE ?? 'data/config.json')),
  });
}
