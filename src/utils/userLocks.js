const chains = new Map();

/**
 * Serialize role mutations for one user so joins and verification clicks cannot interleave.
 */
export function withUserLock(guildId, userId, task) {
  const key = `${guildId}:${userId}`;
  const previous = chains.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  chains.set(key, tail);

  return previous.then(task).finally(() => {
    release();
    if (chains.get(key) === tail) chains.delete(key);
  });
}
