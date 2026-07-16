import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadGas } from '../../scripts/load-gas.mjs';

const attendees = new Map([
  [2, { row: 2, name: '林小宇', phone: '0912345678', email: 'lin@example.com', status: '', checkedInAt: '' }],
  [3, { row: 3, name: '王大明', phone: '0987654321', email: 'wang@example.com', status: '已報到', checkedInAt: new Date('2026-08-03T05:40:00Z') }],
]);

function hash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function createApiHarness(options = {}) {
  const state = {
    cache: new Map(), removed: [], puts: [], confirms: 0, registers: 0, uuid: 0,
    properties: {
      ALLOWED_ORIGINS: '["https://example.github.io","http://127.0.0.1:4173"]',
      WALK_IN_ENABLED: 'true',
      PRIVACY_NOTICE_APPROVED: 'true',
      ...options.properties,
    },
  };
  const cache = {
    get: key => state.cache.has(key) ? state.cache.get(key) : null,
    put(key, value, ttl) { state.puts.push({ key, value, ttl }); state.cache.set(key, value); },
    remove(key) { state.removed.push(key); state.cache.delete(key); },
  };
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
    computeDigest(_algorithm, value) {
      return [...crypto.createHash('sha256').update(String(value), 'utf8').digest()]
        .map(byte => byte > 127 ? byte - 256 : byte);
    },
    getUuid() { state.uuid += 1; return `opaque-${state.uuid}`; },
    formatDate(_date, zone, pattern) { return `${zone}:${pattern}`; },
  };
  const globals = {
    Utilities,
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => state.properties[key] ?? null }) },
    lookupByPhone_: value => value === '0912345678' ? [2] : value === '0987654321' ? [3] : value === '0900000000' ? [2, 3] : [],
    lookupByEmail_: value => value === 'lin@example.com' ? [2] : value === 'wang@example.com' ? [3] : [],
    classifyRows_: rows => rows.length === 0 ? { kind: 'none' } : rows.length === 1 ? { kind: 'one', row: rows[0] } : { kind: 'conflict' },
    readAttendee_: row => {
      if (options.readError) throw options.readError;
      return attendees.get(row);
    },
    confirmRow_: row => {
      state.confirms += 1;
      if (options.confirmResult) return options.confirmResult;
      return { code: 'CHECKED_IN', checkedInAt: new Date('2026-08-03T06:00:00Z'), row };
    },
    registerWalkIn_: input => {
      state.registers += 1;
      if (options.registerResult) return options.registerResult;
      return { code: 'WALK_IN_REGISTERED', row: 4, input };
    },
  };
  const gas = loadGas(['Config.gs', 'Domain.gs', 'Api.gs', 'Code.gs'], globals);
  return { gas, state };
}

function request(requestId, payload, version = 1) {
  return { version, requestId, payload };
}

function assertSanitized(result) {
  const text = JSON.stringify(result);
  for (const secret of ['林小宇', '王大明', '0912345678', '0987654321', 'lin@example.com', 'wang@example.com']) {
    assert.equal(text.includes(secret), false, `leaked ${secret}`);
  }
  assert.equal(/"row"\s*:/.test(text), false, 'leaked row');
}

test('lookup returns only maskedName and an opaque hashed-cache token', () => {
  const { gas, state } = createApiHarness();
  const result = gas.apiLookupByPhone(request('r1', { phone: '09-1234-5678' }));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    version: 1, requestId: 'r1', ok: true, code: 'FOUND',
    data: { maskedName: '林○宇', token: 'opaque-1opaque-2' },
  });
  assertSanitized(result);
  assert.equal(state.puts.length, 1);
  assert.equal(state.puts[0].key, `token:${hash('opaque-1opaque-2')}`);
  assert.equal(state.puts[0].ttl, 300);
  const cached = JSON.parse(state.puts[0].value);
  assert.equal(cached.row, 2);
  assert.equal(typeof cached.issuedAt, 'number');
  assert.equal(state.puts[0].key.includes('opaque-1opaque-2'), false);
});

test('lookup maps normalized email, missing, conflict, checked-in, and invalid values', () => {
  const { gas } = createApiHarness();
  const found = gas.apiLookupByEmail(request('e1', { email: ' LIN@EXAMPLE.COM ' }));
  const missing = gas.apiLookupByEmail(request('e2', { email: 'none@example.com' }));
  const conflict = gas.apiLookupByPhone(request('p2', { phone: '0900000000' }));
  const checked = gas.apiLookupByEmail(request('e3', { email: 'wang@example.com' }));
  const invalid = gas.apiLookupByEmail(request('e4', { email: 'bad@' }));
  assert.equal(found.code, 'FOUND');
  assert.deepEqual(JSON.parse(JSON.stringify(missing)), { version: 1, requestId: 'e2', ok: false, code: 'NOT_FOUND', data: {} });
  assert.equal(conflict.code, 'DATA_CONFLICT');
  assert.deepEqual(JSON.parse(JSON.stringify(checked)), {
    version: 1, requestId: 'e3', ok: true, code: 'ALREADY_CHECKED_IN',
    data: { checkedInAt: 'Asia/Taipei:yyyy/MM/dd HH:mm' },
  });
  assert.equal(invalid.code, 'INVALID_INPUT');
  [found, missing, conflict, checked, invalid].forEach(assertSanitized);
});

test('invalid request envelopes and internal failures are sanitized', () => {
  const normal = createApiHarness();
  assert.equal(normal.gas.apiLookupByPhone(request('bad', { phone: '0912345678' }, 2)).code, 'INVALID_INPUT');
  assert.equal(normal.gas.apiLookupByPhone({ version: 1, requestId: 7, payload: {} }).requestId, '');
  const failed = createApiHarness({ readError: new Error('lin@example.com 0912345678 row 2') });
  const result = failed.gas.apiLookupByPhone(request('failure', { phone: '0912345678' }));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { version: 1, requestId: 'failure', ok: false, code: 'SYSTEM_ERROR', data: {} });
  assertSanitized(result);
});

test('successful and already-confirmed tokens are removed and cannot replay', () => {
  for (const code of ['CHECKED_IN', 'ALREADY_CHECKED_IN']) {
    const { gas, state } = createApiHarness({ confirmResult: { code, checkedInAt: new Date('2026-08-03T06:00:00Z'), row: 2 } });
    const token = `${code}-token`;
    state.cache.set(`token:${hash(token)}`, JSON.stringify({ row: 2, issuedAt: Date.now() }));
    const first = gas.apiConfirmCheckIn(request('c1', { token }));
    const replay = gas.apiConfirmCheckIn(request('c2', { token }));
    assert.equal(first.code, code);
    assert.equal(replay.code, 'TOKEN_EXPIRED');
    assert.deepEqual(state.removed, [`token:${hash(token)}`]);
    assertSanitized(first);
  }
});

test('BUSY leaves the same token valid for retry and expired or malformed tokens do not confirm', () => {
  const { gas, state } = createApiHarness({ confirmResult: { code: 'BUSY' } });
  const token = 'retry-token';
  state.cache.set(`token:${hash(token)}`, JSON.stringify({ row: 2, issuedAt: Date.now() }));
  assert.equal(gas.apiConfirmCheckIn(request('c1', { token })).code, 'BUSY');
  assert.equal(gas.apiConfirmCheckIn(request('c2', { token })).code, 'BUSY');
  assert.equal(state.removed.length, 0);
  assert.equal(state.confirms, 2);
  assert.equal(gas.apiConfirmCheckIn(request('c3', { token: 'expired' })).code, 'TOKEN_EXPIRED');
  state.cache.set(`token:${hash('malformed')}`, '{bad');
  assert.equal(gas.apiConfirmCheckIn(request('c4', { token: 'malformed' })).code, 'TOKEN_EXPIRED');
});

test('walk-in validates release gates and maps repository outcomes without identity leakage', () => {
  const disabled = createApiHarness({ properties: { WALK_IN_ENABLED: 'false' } });
  assert.equal(disabled.gas.apiRegisterWalkIn(request('w0', { name: '陳來賓', phone: '0922334455', email: 'walkin@example.com', consent: true })).code, 'INVALID_INPUT');
  assert.equal(disabled.state.registers, 0);

  const registered = createApiHarness();
  const success = registered.gas.apiRegisterWalkIn(request('w1', { name: '陳來賓', phone: '0922334455', email: 'walkin@example.com', consent: true }));
  assert.deepEqual(JSON.parse(JSON.stringify(success)), { version: 1, requestId: 'w1', ok: true, code: 'WALK_IN_REGISTERED', data: {} });
  assertSanitized(success);

  const existing = createApiHarness({ registerResult: { code: 'FOUND', row: 2 } });
  const found = existing.gas.apiRegisterWalkIn(request('w2', { name: '林小宇', phone: '0912345678', email: 'lin@example.com', consent: true }));
  assert.equal(found.code, 'FOUND');
  assert.deepEqual(Object.keys(found.data).sort(), ['maskedName', 'token']);
  assertSanitized(found);

  const conflict = createApiHarness({ registerResult: { code: 'DATA_CONFLICT' } });
  assert.equal(conflict.gas.apiRegisterWalkIn(request('w3', { name: '陳來賓', phone: '0922334455', email: 'walkin@example.com', consent: true })).code, 'DATA_CONFLICT');
});

test('health check exposes only release state, version, and server time', () => {
  const { gas } = createApiHarness();
  const result = gas.apiHealthCheck(request('h1', {}));
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data).sort(), ['privacyNoticeApproved', 'serverTime', 'version', 'walkInEnabled']);
  assert.equal(result.data.version, 1);
  assert.equal(result.data.walkInEnabled, true);
  assert.equal(result.data.privacyNoticeApproved, true);
  assert.equal(typeof result.data.serverTime, 'number');
  assertSanitized(result);
});

test('allowed origins are strict and doGet injects only server-serialized JSON with ALLOWALL', () => {
  const { gas } = createApiHarness();
  assert.deepEqual([...gas.getAllowedOrigins_()], ['https://example.github.io', 'http://127.0.0.1:4173']);
  for (const invalid of ['"https://good.example/path"', '["https://good.example/path"]', '["javascript:alert(1)"]', '{}']) {
    const { gas: invalidGas } = createApiHarness({ properties: { ALLOWED_ORIGINS: invalid } });
    assert.throws(() => invalidGas.getAllowedOrigins_(), /ALLOWED_ORIGINS_MUST_BE_ARRAY|INVALID_ALLOWED_ORIGIN/);
  }

  const calls = [];
  const output = { setTitle(v) { calls.push(['title', v]); return this; }, addMetaTag(...v) { calls.push(['meta', ...v]); return this; }, setXFrameOptionsMode(v) { calls.push(['frame', v]); return this; } };
  const template = { evaluate: () => output };
  const harness = createApiHarness();
  harness.gas.HtmlService = undefined;
  const gasWithHtml = loadGas(['Config.gs', 'Domain.gs', 'Api.gs', 'Code.gs'], {
    Utilities: harness.gas.Utilities,
    CacheService: harness.gas.CacheService,
    PropertiesService: harness.gas.PropertiesService,
    HtmlService: { createTemplateFromFile: name => { assert.equal(name, 'Bridge'); return template; }, XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' } },
  });
  gasWithHtml.doGet();
  assert.equal(template.allowedOriginsJson, '["https://example.github.io","http://127.0.0.1:4173"]');
  assert.ok(calls.some(call => call[0] === 'frame' && call[1] === 'ALLOWALL'));
});

function runBridge() {
  const html = fs.readFileSync('apps-script/Bridge.html', 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace('<?!= allowedOriginsJson ?>', '["https://allowed.example"]');
  let listener;
  const calls = [];
  let success;
  let failure;
  const runner = {
    withSuccessHandler(fn) { success = fn; return runner; },
    withFailureHandler(fn) { failure = fn; return runner; },
  };
  for (const name of ['apiHealthCheck', 'apiLookupByPhone', 'apiLookupByEmail', 'apiConfirmCheckIn', 'apiRegisterWalkIn']) {
    runner[name] = envelope => calls.push({ name, envelope, success, failure });
  }
  vm.runInNewContext(script, {
    Object, google: { script: { run: runner } },
    addEventListener: (_name, fn) => { listener = fn; },
    parent: { postMessage() {} },
  });
  return { html, calls, dispatch: event => listener(event) };
}

test('Bridge rejects unknown origins, sources, versions, request IDs, and actions', () => {
  const bridge = runBridge();
  const source = { postMessage() {} };
  const valid = { origin: 'https://allowed.example', source, data: { version: 1, requestId: 'r1', action: 'healthCheck', payload: {} } };
  bridge.dispatch({ ...valid, origin: 'https://evil.example' });
  bridge.dispatch({ ...valid, source: null });
  bridge.dispatch({ ...valid, data: { ...valid.data, version: 2 } });
  bridge.dispatch({ ...valid, data: { ...valid.data, requestId: 7 } });
  bridge.dispatch({ ...valid, data: { ...valid.data, action: 'unknown' } });
  assert.equal(bridge.calls.length, 0);
});

test('Bridge dispatches allowlisted actions and replies to exact observed source and origin', () => {
  const bridge = runBridge();
  const posts = [];
  const source = { postMessage: (...args) => posts.push(args) };
  bridge.dispatch({ origin: 'https://allowed.example', source, data: { version: 1, requestId: 'r1', action: 'lookupByPhone', payload: { phone: '0912345678' } } });
  assert.equal(bridge.calls[0].name, 'apiLookupByPhone');
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.calls[0].envelope)), { version: 1, requestId: 'r1', payload: { phone: '0912345678' } });
  bridge.calls[0].success({ version: 1, requestId: 'r1', ok: true, code: 'FOUND', data: {} });
  assert.equal(posts[0][1], 'https://allowed.example');
  bridge.calls[0].failure(new Error('secret identity'));
  assert.deepEqual(JSON.parse(JSON.stringify(posts[1])), [{ version: 1, requestId: 'r1', ok: false, code: 'SYSTEM_ERROR', data: {} }, 'https://allowed.example']);
  assert.match(bridge.html, /allowed\.includes\(event\.origin\)/);
  assert.match(bridge.html, /source\.postMessage\(result,\s*origin\)/);
});

test('API and Bridge production sources contain no identity or token logging', () => {
  const source = ['apps-script/Api.gs', 'apps-script/Code.gs', 'apps-script/Bridge.html']
    .map(file => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(source, /\b(?:console|Logger)\s*\./);
});
