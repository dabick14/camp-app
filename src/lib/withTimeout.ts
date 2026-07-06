const TIMEOUT_MS = 12_000

export function withTimeout<T>(promise: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Connection timed out. Check your internet and try again.')),
        ms,
      ),
    ),
  ])
}
