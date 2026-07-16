export class BridgeClient {
  constructor({ targetWindow, targetOrigin, eventSource = window, timeoutMs = 12000 }) {
    if (!targetWindow || !targetOrigin) throw new Error('Bridge target is required');

    this.targetWindow = targetWindow;
    this.targetOrigin = targetOrigin;
    this.eventSource = eventSource;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.onMessage = this.onMessage.bind(this);
    this.eventSource.addEventListener('message', this.onMessage);
  }

  request(action, payload, requestId = crypto.randomUUID()) {
    if (this.pending.has(requestId)) return this.pending.get(requestId).promise;

    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const timer = setTimeout(() => {
      this.pending.delete(requestId);
      reject(Object.assign(new Error('Bridge timeout'), { code: 'NETWORK_RETRYABLE' }));
    }, this.timeoutMs);

    this.pending.set(requestId, { promise, resolve, reject, timer });
    this.targetWindow.postMessage(
      { version: 1, requestId, action, payload },
      this.targetOrigin,
    );
    return promise;
  }

  onMessage(event) {
    if (event.origin !== this.targetOrigin || event.source !== this.targetWindow) return;

    const message = event.data;
    if (!message || message.version !== 1 || typeof message.requestId !== 'string') return;

    const item = this.pending.get(message.requestId);
    if (!item) return;

    clearTimeout(item.timer);
    this.pending.delete(message.requestId);
    item.resolve(message);
  }

  destroy() {
    this.eventSource.removeEventListener('message', this.onMessage);
    for (const item of this.pending.values()) clearTimeout(item.timer);
    this.pending.clear();
  }
}
