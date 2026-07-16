import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeClient, resolveBridgeOrigin } from '../../web/assets/js/bridge-client.js';

class FakeEvents {
  constructor() {
    this.listeners = new Set();
  }

  addEventListener(_type, listener) {
    this.listeners.add(listener);
  }

  removeEventListener(_type, listener) {
    this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }
}

const targetOrigin = 'https://script.google.com';

test('resolves only exact origins or Google Apps Script randomized bridge origins', () => {
  const configured = 'https://script.googleusercontent.com';
  const randomized = 'https://n-example-0lu-script.googleusercontent.com';

  assert.equal(resolveBridgeOrigin(configured, configured), configured);
  assert.equal(resolveBridgeOrigin(configured, randomized), randomized);
  assert.equal(resolveBridgeOrigin('http://127.0.0.2:4173', 'http://127.0.0.2:4173'), 'http://127.0.0.2:4173');

  for (const rejected of [
    'http://n-example-0lu-script.googleusercontent.com',
    'https://n-example-0lu-script.googleusercontent.com:8443',
    'https://script.googleusercontent.com.evil.example',
    'https://evilscript.googleusercontent.com',
    'https://n-example-0lu-script.googleusercontent.com.evil.example',
    'https://n-example-0lu-script.googleusercontent.com/path',
  ]) {
    assert.equal(resolveBridgeOrigin(configured, rejected), null, rejected);
  }

  assert.equal(
    resolveBridgeOrigin('https://example.com', 'https://n-example-0lu-script.googleusercontent.com'),
    null,
  );
});

function createClient(timeoutMs = 100) {
  const events = new FakeEvents();
  const sent = [];
  const target = {
    postMessage: (body, origin) => sent.push({ body, origin }),
  };
  const client = new BridgeClient({
    targetWindow: target,
    targetOrigin,
    eventSource: events,
    timeoutMs,
  });
  return { client, events, sent, target };
}

test('resolves only a response from the configured origin and source', async () => {
  const { client, events, sent, target } = createClient();
  const pending = client.request('healthCheck', {}, 'req-1');

  events.emit({
    origin: 'https://evil.example',
    source: target,
    data: { version: 1, requestId: 'req-1', ok: true, code: 'EVIL' },
  });
  events.emit({
    origin: targetOrigin,
    source: {},
    data: { version: 1, requestId: 'req-1', ok: true, code: 'WRONG_SOURCE' },
  });
  events.emit({
    origin: targetOrigin,
    source: target,
    data: { version: 1, requestId: 'req-1', ok: true, code: 'OK', data: {} },
  });

  assert.equal((await pending).code, 'OK');
  assert.deepEqual(sent, [{
    body: { version: 1, requestId: 'req-1', action: 'healthCheck', payload: {} },
    origin: targetOrigin,
  }]);
  assert.equal(client.pending.size, 0);
  client.destroy();
});

test('correlates concurrent responses by request id and ignores other versions', async () => {
  const { client, events, target } = createClient();
  const first = client.request('first', { value: 1 }, 'req-1');
  const second = client.request('second', { value: 2 }, 'req-2');

  events.emit({
    origin: targetOrigin,
    source: target,
    data: { version: 2, requestId: 'req-1', ok: true, code: 'WRONG_VERSION' },
  });
  events.emit({
    origin: targetOrigin,
    source: target,
    data: { version: 1, requestId: 'req-other', ok: true, code: 'UNRELATED' },
  });
  events.emit({
    origin: targetOrigin,
    source: target,
    data: { version: 1, requestId: 'req-2', ok: true, code: 'SECOND' },
  });
  events.emit({
    origin: targetOrigin,
    source: target,
    data: { version: 1, requestId: 'req-1', ok: true, code: 'FIRST' },
  });

  assert.equal((await first).code, 'FIRST');
  assert.equal((await second).code, 'SECOND');
  assert.equal(client.pending.size, 0);
  client.destroy();
});

test('deduplicates an in-flight request id', async () => {
  const { client, events, sent, target } = createClient();
  const first = client.request('healthCheck', {}, 'req-1');
  const duplicate = client.request('ignored', { duplicate: true }, 'req-1');

  assert.equal(duplicate, first);
  assert.equal(sent.length, 1);

  events.emit({
    origin: targetOrigin,
    source: target,
    data: { version: 1, requestId: 'req-1', ok: true, code: 'OK' },
  });
  await first;
  client.destroy();
});

test('rejects timed-out requests as retryable and removes them from pending', async () => {
  const { client } = createClient(5);

  await assert.rejects(
    client.request('healthCheck', {}, 'req-timeout'),
    error => error.message === 'Bridge timeout' && error.code === 'NETWORK_RETRYABLE',
  );
  assert.equal(client.pending.size, 0);
  client.destroy();
});

test('destroy removes the listener and clears all pending entries', () => {
  const { client, events } = createClient(1000);
  void client.request('healthCheck', {}, 'req-pending');

  assert.equal(events.listeners.size, 1);
  assert.equal(client.pending.size, 1);
  client.destroy();

  assert.equal(events.listeners.size, 0);
  assert.equal(client.pending.size, 0);
});
