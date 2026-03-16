/**
 * Concurrency guard for session/token refresh operations.
 */

const pending = new WeakMap<object, Promise<unknown>>();

export async function withRefreshGuard(
  owner: object,
  fn: () => Promise<void>,
): Promise<void> {
  const existing = pending.get(owner);
  if (existing) {
    try {
      await existing;
      return;
    } catch {
      // The in-flight refresh failed — fall through to start our own attempt.
    }
  }

  const promise = fn();
  pending.set(owner, promise);
  try {
    await promise;
  } finally {
    pending.delete(owner);
  }
}
