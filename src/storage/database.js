import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatError } from '../utils/logger.js';

const emptyData = () => ({ version: 1, guilds: {} });

function validateData(data, file) {
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    data.version !== 1 ||
    !data.guilds ||
    typeof data.guilds !== 'object' ||
    Array.isArray(data.guilds)
  ) {
    throw new Error(`Persistent configuration at ${file} is invalid. Restore it from backup or move it aside so it can be recreated.`);
  }
  return data;
}

/**
 * Small atomic JSON store. Writes are serialized and use replace-on-rename so a crash
 * cannot leave a half-written configuration file behind.
 */
export class Database {
  #file;
  #logger;
  #queue = Promise.resolve();

  constructor(file, logger) {
    this.#file = file;
    this.#logger = logger;
  }

  async init() {
    await mkdir(path.dirname(this.#file), { recursive: true });
    try {
      const data = validateData(JSON.parse(await readFile(this.#file, 'utf8')), this.#file);
      this.#logger.debug('Loaded persistent configuration', { guildCount: Object.keys(data.guilds).length });
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.#logger.error('Could not load persistent configuration', { file: this.#file, error: formatError(error) });
        throw new Error(`Could not load persistent configuration at ${this.#file}: ${error.message}`, { cause: error });
      }
      await this.#write(emptyData());
      this.#logger.info('Created persistent configuration', { file: this.#file });
    }
  }

  async getGuildConfig(guildId) {
    const data = validateData(JSON.parse(await readFile(this.#file, 'utf8')), this.#file);
    const record = data.guilds[guildId];
    return record ? { ...record } : null;
  }

  async saveGuildConfig(guildId, config) {
    const record = {
      guildId,
      verificationChannelId: String(config.verificationChannelId),
      verificationMessageId: String(config.verificationMessageId),
      unverifiedRoleId: String(config.unverifiedRoleId),
      memberRoleId: String(config.memberRoleId),
      configuredBy: config.configuredBy ? String(config.configuredBy) : null,
      updatedAt: new Date().toISOString(),
    };
    await this.#mutate((data) => {
      data.guilds[guildId] = record;
    });
    return { ...record };
  }

  async flush() {
    await this.#queue;
  }

  #mutate(change) {
    const run = this.#queue.then(async () => {
      const data = validateData(JSON.parse(await readFile(this.#file, 'utf8')), this.#file);
      change(data);
      await this.#write(data);
    });
    // Keep later writes moving even if this one fails; the caller still receives the rejection.
    this.#queue = run.catch(() => {});
    return run;
  }

  async #write(data) {
    const temporary = `${this.#file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.#file);
  }
}
