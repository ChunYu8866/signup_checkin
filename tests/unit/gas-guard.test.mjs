import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadGas } from '../../scripts/load-gas.mjs';

const attendees = new Map([
  [2, { row: 2, name: '林小宇', phone: '0912345678', email: 'lin@example.com', status: '', checkedInAt: '' }],
]);

// 固定 vm 內的時鐘：速率限制 bucket 不會在測試中跨越時間邊界。
const FIXED_NOW = Date.parse('2026-08-03T06:00:00Z');
class FakeDate extends Date {
  constructor(...args) {
    if (args.length === 0) super(FIXED_NOW);
    else super(...args);
  }
  static now() { return FIXED_NOW; }
}

function createGuardHarness(options = {}) {
  const state = {
    cache: new Map(), puts: [], confirms: 0, registers: 0, uuid: 0,
    properties: {
      ALLOWED_ORIGINS: '["https://example.github.io"]',
      WALK_IN_ENABLED: 'true',
      PRIVACY_NOTICE_APPROVED: 'true',
      ...options.properties,
    },
  };
  const cache = {
    get: key => state.cache.has(key) ? state.cache.get(key) : null,
    put(key, value, ttl) { state.puts.push({ key, value, ttl }); state.cache.set(key, value); },
    remove(key) { state.cache.delete(key); },
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
    Date: FakeDate,
    Utilities,
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => state.properties[key] ?? null }) },
    lookupByPhone_: value => value === '0912345678' ? [2] : [],
    lookupByEmail_: value => value === 'lin@example.com' ? [2] : [],
    classifyRows_: rows => rows.length === 0 ? { kind: 'none' } : rows.length === 1 ? { kind: 'one', row: rows[0] } : { kind: 'conflict' },
    readAttendee_: row => attendees.get(row),
    confirmRow_: () => { state.confirms += 1; return { code: 'CHECKED_IN', checkedInAt: new Date('2026-08-03T06:00:00Z') }; },
    registerWalkIn_: () => { state.registers += 1; return { code: 'WALK_IN_REGISTERED', row: 4 }; },
    invalidateIndexes_: () => {},
  };
  const gas = loadGas(['Config.gs', 'Domain.gs', 'Api.gs', 'Code.gs'], globals);
  return { gas, state };
}

function request(requestId, payload) {
  return { version: 1, requestId, payload };
}

test('per-identity lookup rate limit trips into BUSY without blocking other identities', () => {
  const { gas } = createGuardHarness();
  const limit = gas.CHECKIN.RATE_LIMITS.LOOKUP_IDENTITY.limit;
  for (let i = 0; i < limit; i += 1) {
    assert.equal(gas.apiLookupByPhone(request(`rl-${i}`, { phone: '0912345678' })).code, 'FOUND');
  }
  const tripped = gas.apiLookupByPhone(request('rl-over', { phone: '0912345678' }));
  assert.equal(tripped.ok, false);
  assert.equal(tripped.code, 'BUSY');
  assert.equal(gas.apiLookupByPhone(request('rl-other', { phone: '0987654321' })).code, 'NOT_FOUND');
});

test('global lookup rate limit bounds bulk probing across identities', () => {
  const { gas } = createGuardHarness();
  const limit = gas.CHECKIN.RATE_LIMITS.LOOKUP_GLOBAL.limit;
  for (let i = 0; i < limit; i += 1) {
    const phone = `09${String(11000000 + i)}`;
    assert.equal(gas.apiLookupByPhone(request(`gl-${i}`, { phone })).code, 'NOT_FOUND');
  }
  const tripped = gas.apiLookupByPhone(request('gl-over', { phone: '0999999999' }));
  assert.equal(tripped.ok, false);
  assert.equal(tripped.code, 'BUSY');
});

test('global walk-in rate limit caps registration floods at 20 per minute', () => {
  const { gas, state } = createGuardHarness();
  const limit = gas.CHECKIN.RATE_LIMITS.WALK_IN_GLOBAL.limit;
  assert.equal(limit, 20);
  for (let i = 0; i < limit; i += 1) {
    const payload = { name: '陳來賓', phone: `09${String(22000000 + i)}`, email: `walkin${i}@example.com`, consent: true };
    assert.equal(gas.apiRegisterWalkIn(request(`w-${i}`, payload)).code, 'WALK_IN_REGISTERED');
  }
  const tripped = gas.apiRegisterWalkIn(request('w-over', { name: '陳來賓', phone: '0922999999', email: 'flood@example.com', consent: true }));
  assert.equal(tripped.ok, false);
  assert.equal(tripped.code, 'BUSY');
  assert.equal(state.registers, limit);
});

test('rate-limit cache keys never contain readable identities', () => {
  const { gas, state } = createGuardHarness();
  gas.apiLookupByPhone(request('k1', { phone: '0912345678' }));
  gas.apiLookupByEmail(request('k2', { email: 'lin@example.com' }));
  const limiterPuts = state.puts.filter(put => put.key.startsWith('rl:'));
  assert.ok(limiterPuts.length >= 4);
  for (const put of limiterPuts) {
    assert.equal(put.key.includes('0912345678'), false);
    assert.equal(put.key.includes('lin@example.com'), false);
    assert.match(put.key, /^rl:[a-z-]+:\d+:[0-9a-f]{16}$/);
  }
});
