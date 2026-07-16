import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithWaitingRoom } from '../../web/assets/js/retry.js';

test('retries BUSY with one request id and stops on success', async () => {
  const calls = [];
  const waits = [];
  const operation = async requestId => {
    calls.push(requestId);
    return calls.length < 3
      ? { ok: false, code: 'BUSY' }
      : { ok: true, code: 'CHECKED_IN' };
  };

  const result = await runWithWaitingRoom(
    operation,
    { onWait: ms => waits.push(ms) },
    {
      delays: [2, 4],
      jitter: () => 0,
      sleep: async () => {},
      requestId: 'req-stable',
    },
  );

  assert.equal(result.code, 'CHECKED_IN');
  assert.deepEqual(calls, ['req-stable', 'req-stable', 'req-stable']);
  assert.deepEqual(waits, [2000, 4000]);
});

test('uses the default 2, 4, 8, 12, and 16 second retry schedule', async () => {
  const waits = [];
  let calls = 0;

  const result = await runWithWaitingRoom(
    async () => {
      calls += 1;
      return { ok: false, code: 'BUSY' };
    },
    { onWait: ms => waits.push(ms) },
    { jitter: () => 0, sleep: async () => {}, requestId: 'req-defaults' },
  );

  assert.equal(result.code, 'BUSY');
  assert.equal(calls, 6);
  assert.deepEqual(waits, [2000, 4000, 8000, 12000, 16000]);
});

test('adds up to 750 milliseconds of jitter to a retry delay', async () => {
  const waits = [];

  await runWithWaitingRoom(
    async () => ({ ok: false, code: 'BUSY' }),
    { onWait: ms => waits.push(ms) },
    { delays: [2], jitter: () => 1, sleep: async () => {}, requestId: 'req-jitter' },
  );

  assert.deepEqual(waits, [2750]);
});

test('retries thrown network failures and stops on a non-retryable result', async () => {
  const requestIds = [];
  const waits = [];

  const result = await runWithWaitingRoom(
    async requestId => {
      requestIds.push(requestId);
      if (requestIds.length === 1) throw new Error('offline');
      return { ok: false, code: 'NOT_FOUND' };
    },
    { onWait: ms => waits.push(ms) },
    { delays: [2], jitter: () => 0, sleep: async () => {}, requestId: 'req-network' },
  );

  assert.deepEqual(requestIds, ['req-network', 'req-network']);
  assert.deepEqual(waits, [2000]);
  assert.deepEqual(result, { ok: false, code: 'NOT_FOUND' });
});

test('returns before a retry would exceed the 60 second wait budget', async () => {
  const waits = [];
  let calls = 0;

  const result = await runWithWaitingRoom(
    async () => {
      calls += 1;
      return { ok: false, code: 'NETWORK_RETRYABLE' };
    },
    { onWait: ms => waits.push(ms) },
    { delays: [59, 2], jitter: () => 0, sleep: async () => {}, requestId: 'req-bounded' },
  );

  assert.equal(result.code, 'NETWORK_RETRYABLE');
  assert.equal(calls, 2);
  assert.deepEqual(waits, [59000]);
});

test('returns non-retryable responses without waiting', async () => {
  const waits = [];
  let calls = 0;

  const result = await runWithWaitingRoom(
    async () => {
      calls += 1;
      return { ok: false, code: 'INVALID_INPUT' };
    },
    { onWait: ms => waits.push(ms) },
    { sleep: async () => {}, requestId: 'req-invalid' },
  );

  assert.equal(result.code, 'INVALID_INPUT');
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});
