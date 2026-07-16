const RETRYABLE = new Set(['BUSY', 'NETWORK_RETRYABLE']);

export async function runWithWaitingRoom(operation, hooks = {}, options = {}) {
  const delays = options.delays ?? [2, 4, 8, 12, 16];
  const jitter = options.jitter ?? Math.random;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const requestId = options.requestId ?? crypto.randomUUID();
  let elapsed = 0;

  for (let attempt = 0; ; attempt += 1) {
    let result;
    try {
      result = await operation(requestId);
    } catch (error) {
      result = { ok: false, code: error.code ?? 'NETWORK_RETRYABLE' };
    }

    if (!RETRYABLE.has(result.code)) return result;
    if (attempt >= delays.length) return result;

    const waitMs = Math.round(delays[attempt] * 1000 + jitter() * 750);
    if (elapsed + waitMs > 60000) return result;

    elapsed += waitMs;
    hooks.onWait?.(waitMs, attempt + 1);
    await sleep(waitMs);
  }
}
