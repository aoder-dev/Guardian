const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function redact(value) {
  let text = String(value ?? '');
  const token = process.env.DISCORD_TOKEN;
  if (token && token.length >= 8) text = text.split(token).join('[REDACTED]');
  return text;
}

export function formatError(error) {
  if (!error) return { name: 'Error', message: 'Unknown error' };
  const result = {
    name: error.name ?? 'Error',
    message: redact(error.message ?? String(error)),
  };
  if (error.code !== undefined) result.code = error.code;
  if (error.status !== undefined) result.status = error.status;
  if (error.httpStatus !== undefined) result.httpStatus = error.httpStatus;
  return result;
}

function normalize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) return formatError(value);
  if (typeof value === 'string') return redact(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => normalize(item, seen));
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = /token|secret|authorization|password/i.test(key) ? '[REDACTED]' : normalize(item, seen);
  }
  return result;
}

export function createLogger(level = 'info') {
  const minimum = LEVELS[level] ?? LEVELS.info;
  const write = (severity, message, meta) => {
    if (LEVELS[severity] < minimum) return;
    const suffix = meta === undefined ? '' : ` ${JSON.stringify(normalize(meta))}`;
    const line = `${new Date().toISOString()} [${severity.toUpperCase()}] ${redact(message)}${suffix}`;
    if (severity === 'debug') console.log(line);
    else console[severity](line);
  };
  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}

const lastAlerts = new Map();
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Best-effort administrator notification. Details stay in logs; members never see them.
 */
export async function alertAdministrators(guild, logger, reason = 'role-update') {
  const key = `${guild.id}:${reason}`;
  const now = Date.now();
  if ((lastAlerts.get(key) ?? 0) > now) return false;
  lastAlerts.set(key, now + ALERT_COOLDOWN_MS);

  const message =
    '**Security verification needs attention.** The bot could not complete a member role update. ' +
    'Please check the bot logs and confirm that both roles exist, the bot has Manage Roles, and the bot role is above `unverifed` and `member`.';

  try {
    const owner = await guild.fetchOwner();
    await owner.send(message);
    logger.info('Notified the server owner about a verification problem', { guildId: guild.id, reason });
    return true;
  } catch (error) {
    logger.warn('Could not DM the server owner', { guildId: guild.id, error: formatError(error) });
  }

  try {
    if (guild.systemChannel) {
      await guild.systemChannel.send({ content: message, allowedMentions: { parse: [] } });
      logger.info('Notified the system channel about a verification problem', { guildId: guild.id, reason });
      return true;
    }
  } catch (error) {
    logger.warn('Could not post to the system channel', { guildId: guild.id, error: formatError(error) });
  }

  logger.warn('No administrator notification could be delivered', { guildId: guild.id, reason });
  return false;
}
