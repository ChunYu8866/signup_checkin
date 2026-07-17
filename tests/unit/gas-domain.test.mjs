import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGas } from '../../scripts/load-gas.mjs';

const digestCalls = [];
const Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  computeDigest(algorithm, value, charset) {
    digestCalls.push({ algorithm, value, charset });
    return [-128, -1, 0, 1, 15, 16, 127];
  },
  formatDate: (_date, timeZone, pattern) => `${timeZone}:${pattern}`,
};
const gas = loadGas(['Config.gs', 'Domain.gs'], { Utilities });

test('Apps Script manifest and configuration use the exact deployment contract', () => {
  const manifest = JSON.parse(fs.readFileSync('appsscript.json', 'utf8'));
  assert.deepEqual(manifest, {
    timeZone: 'Asia/Taipei',
    dependencies: {},
    exceptionLogging: 'STACKDRIVER',
    runtimeVersion: 'V8',
    webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' },
  });
  assert.deepEqual({
    VERSION: gas.CHECKIN.VERSION,
    SHEET_ID: gas.CHECKIN.SHEET_ID,
    SHEET_NAME: gas.CHECKIN.SHEET_NAME,
    TIME_ZONE: gas.CHECKIN.TIME_ZONE,
    TOKEN_TTL_SECONDS: gas.CHECKIN.TOKEN_TTL_SECONDS,
    INDEX_TTL_SECONDS: gas.CHECKIN.INDEX_TTL_SECONDS,
    LOCK_WAIT_MS: gas.CHECKIN.LOCK_WAIT_MS,
    MAX_ROWS: gas.CHECKIN.MAX_ROWS,
  }, {
    VERSION: 1,
    SHEET_ID: '179uW_qocdZQ8H-yZNYz3_IhNEyviKWCkBDnrnHZQkQU',
    SHEET_NAME: '簽到表',
    TIME_ZONE: 'Asia/Taipei',
    TOKEN_TTL_SECONDS: 300,
    INDEX_TTL_SECONDS: 900,
    LOCK_WAIT_MS: 1200,
    MAX_ROWS: 1000,
  });
  assert.deepEqual(Array.from(gas.CHECKIN.HEADERS), [
    '姓名', '手機', 'E-mail', '報名類型', '報到狀態', '報到時間', '資料建立時間',
  ]);
  assert.deepEqual({ ...gas.CHECKIN.CODES }, {
    FOUND: 'FOUND',
    NOT_FOUND: 'NOT_FOUND',
    ALREADY_CHECKED_IN: 'ALREADY_CHECKED_IN',
    CHECKED_IN: 'CHECKED_IN',
    WALK_IN_REGISTERED: 'WALK_IN_REGISTERED',
    CAPACITY_REACHED: 'CAPACITY_REACHED',
    DATA_CONFLICT: 'DATA_CONFLICT',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    NOT_OPEN: 'NOT_OPEN',
    BUSY: 'BUSY',
    INVALID_INPUT: 'INVALID_INPUT',
    FORBIDDEN_ORIGIN: 'FORBIDDEN_ORIGIN',
    SYSTEM_ERROR: 'SYSTEM_ERROR',
  });
});

test('server normalizes contact values and masks every inner code point', () => {
  assert.equal(gas.normalizePhone_('09-1234-5678'), '0912345678');
  assert.equal(gas.normalizeEmail_(' User@Example.COM '), 'user@example.com');
  assert.equal(gas.normalizeName_('  歐陽  明  '), '歐陽 明');
  assert.equal(gas.maskName_('王'), '○');
  assert.equal(gas.maskName_('林宇'), '林○');
  assert.equal(gas.maskName_('林小宇'), '林○宇');
  assert.equal(gas.maskName_('歐陽文明'), '歐○○明');
});

test('server phone and email validation rejects malformed and overlong values', () => {
  assert.equal(gas.validatePhone_('0912345678'), '');
  assert.equal(gas.validatePhone_('09-1234-5678'), '');
  assert.notEqual(gas.validatePhone_('09123456789'), '');
  assert.notEqual(gas.validatePhone_('0912345678 9'), '');
  assert.equal(gas.validateEmail_('user@example.com'), '');
  assert.notEqual(gas.validateEmail_('bad@'), '');
  assert.notEqual(gas.validateEmail_(`${'a'.repeat(243)}@example.com`), '');
});

test('server name validation rejects controls, markup, and values without a letter', () => {
  assert.equal(gas.validateName_('王小明'), '');
  assert.equal(gas.validateName_("Jean-Luc O'Neill"), '');
  assert.notEqual(gas.validateName_('王\n小明'), '');
  assert.notEqual(gas.validateName_('王\t小明'), '');
  assert.notEqual(gas.validateName_('<王>'), '');
  assert.notEqual(gas.validateName_('・-'), '');
  assert.notEqual(gas.validateName_('\u0301\u0301'), '');
});

test('SHA-256 hex encoding converts signed Apps Script bytes', () => {
  assert.equal(gas.sha256_('王小明'), '80ff00010f107f');
  assert.deepEqual(digestCalls.at(-1), {
    algorithm: 'SHA_256',
    value: '王小明',
    charset: 'UTF_8',
  });
});

test('Taipei formatting uses the configured zone and exact pattern', () => {
  assert.equal(gas.formatTaipei_('2026-08-03T06:00:00Z'), 'Asia/Taipei:yyyy/MM/dd HH:mm');
});
