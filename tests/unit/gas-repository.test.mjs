import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadGas } from '../../scripts/load-gas.mjs';
import { rows as fixtureRows } from '../fixtures/fake-attendees.mjs';

const FIXED_NOW = Date.parse('2026-08-03T06:00:00Z');

function cloneRows(rows) {
  return rows.map(row => row.map(value => value instanceof Date ? new Date(value) : value));
}

function createHarness(options = {}) {
  const state = {
    rows: cloneRows(options.rows || fixtureRows),
    sourceRows: cloneRows(options.sourceRows || [['姓名', '手機', 'E-mail']]),
    cache: new Map(options.cache || []),
    events: [],
    rangeReads: [],
    rangeWrites: [],
    flushes: 0,
    lockAvailable: options.lockAvailable !== false,
    setValuesError: options.setValuesError || null,
    appendRowError: options.appendRowError || null,
    uuid: 0,
  };

  function range(row, column, numRows = 1, numColumns = 1) {
    return {
      getValues() {
        state.rangeReads.push({ row, column, numRows, numColumns, mode: 'values' });
        return Array.from({ length: numRows }, (_, rowOffset) =>
          Array.from({ length: numColumns }, (_, columnOffset) =>
            state.rows[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? ''
          )
        );
      },
      getDisplayValues() {
        state.rangeReads.push({ row, column, numRows, numColumns, mode: 'display' });
        return Array.from({ length: numRows }, (_, rowOffset) =>
          Array.from({ length: numColumns }, (_, columnOffset) => {
            const value = state.rows[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? '';
            return value instanceof Date ? value.toISOString() : String(value);
          })
        );
      },
      setValues(values) {
        state.events.push('setValues');
        if (state.setValuesError) throw state.setValuesError;
        assert.equal(values.length, numRows);
        values.forEach(valuesRow => assert.equal(valuesRow.length, numColumns));
        state.rangeWrites.push({ row, column, numRows, numColumns, values });
        values.forEach((valuesRow, rowOffset) => {
          if (!state.rows[row - 1 + rowOffset]) state.rows[row - 1 + rowOffset] = [];
          valuesRow.forEach((value, columnOffset) => {
            state.rows[row - 1 + rowOffset][column - 1 + columnOffset] = value;
          });
        });
        return this;
      },
    };
  }

  function sourceRange(row, column, numRows = 1, numColumns = 1) {
    return {
      getValues() {
        state.rangeReads.push({ sheet: 'source', row, column, numRows, numColumns, mode: 'values' });
        return Array.from({ length: numRows }, (_, rowOffset) =>
          Array.from({ length: numColumns }, (_, columnOffset) =>
            state.sourceRows[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? ''
          )
        );
      },
      getDisplayValues() {
        state.rangeReads.push({ sheet: 'source', row, column, numRows, numColumns, mode: 'display' });
        return Array.from({ length: numRows }, (_, rowOffset) =>
          Array.from({ length: numColumns }, (_, columnOffset) => String(
            state.sourceRows[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? ''
          ))
        );
      },
      setValues(values) {
        values.forEach((valuesRow, rowOffset) => {
          if (!state.sourceRows[row - 1 + rowOffset]) state.sourceRows[row - 1 + rowOffset] = [];
          valuesRow.forEach((value, columnOffset) => {
            state.sourceRows[row - 1 + rowOffset][column - 1 + columnOffset] = value;
          });
        });
        return this;
      },
    };
  }

  const sheet = {
    getLastRow: () => state.rows.length,
    getRange: range,
    appendRow(values) {
      state.events.push('appendRow');
      if (state.appendRowError) throw state.appendRowError;
      state.rows.push([...values]);
      return this;
    },
  };
  const sourceSheet = {
    getLastRow: () => state.sourceRows.length,
    getRange: sourceRange,
  };

  const SpreadsheetApp = {
    openById(id) {
      if (id !== '179uW_qocdZQ8H-yZNYz3_IhNEyviKWCkBDnrnHZQkQU') throw new Error('WRONG_SHEET_ID');
      return {
        getSpreadsheetTimeZone: () => 'Asia/Taipei',
        getSheetByName(name) {
          return name === '簽到表' ? sheet : name === '報名表' ? sourceSheet : null;
        },
      };
    },
    flush() {
      state.events.push('flush');
      state.flushes += 1;
    },
  };

  const scriptCache = {
    get(key) {
      state.events.push(`cache:get:${key}`);
      return state.cache.has(key) ? state.cache.get(key) : null;
    },
    put(key, value, ttl) {
      state.events.push(`cache:put:${key}:${ttl}`);
      state.cache.set(key, String(value));
    },
    putAll(values, ttl) {
      state.events.push(`cache:putAll:${ttl}`);
      Object.entries(values).forEach(([key, value]) => state.cache.set(key, String(value)));
    },
    remove(key) {
      state.events.push(`cache:remove:${key}`);
      state.cache.delete(key);
    },
  };

  const lock = {
    tryLock(waitMs) {
      state.events.push(`tryLock:${waitMs}`);
      return state.lockAvailable;
    },
    releaseLock() {
      state.events.push('releaseLock');
    },
  };

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest(algorithm, value, charset) {
      assert.equal(algorithm, 'SHA_256');
      assert.equal(charset, 'UTF_8');
      if (options.digestByteCount) return Array(options.digestByteCount).fill(0);
      return [...crypto.createHash('sha256').update(String(value), 'utf8').digest()]
        .map(byte => byte > 127 ? byte - 256 : byte);
    },
    getUuid() {
      state.uuid += 1;
      return `generation-${state.uuid}`;
    },
    newBlob(value) {
      return {
        getBytes: () => [...Buffer.from(String(value), 'utf8')].map(byte => byte > 127 ? byte - 256 : byte),
      };
    },
  };

  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [FIXED_NOW]));
    }

    static now() {
      return FIXED_NOW;
    }
  }

  const gas = loadGas(
    ['Config.gs', 'Domain.gs', 'Index.gs', 'Repository.gs', 'Code.gs'],
    {
      SpreadsheetApp,
      CacheService: { getScriptCache: () => scriptCache },
      LockService: { getScriptLock: () => lock },
      Utilities,
      Date: FixedDate,
      Session: { getScriptTimeZone: () => 'Asia/Taipei' },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: key => ({
            ALLOWED_ORIGINS: '["https://owner.github.io"]',
            WALK_IN_ENABLED: 'false',
            PRIVACY_NOTICE_APPROVED: 'false',
          })[key] ?? null,
        }),
      },
      HtmlService: { createTemplateFromFile() {}, XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' } },
    }
  );

  return { gas, state };
}

test('rebuilds bounded A:C indexes and finds normalized phone and email values', () => {
  const { gas, state } = createHarness();

  assert.deepEqual([...gas.lookupByPhone_('09-1234-5678')], [2]);
  assert.deepEqual([...gas.lookupByEmail_(' LIN@EXAMPLE.COM ')], [2]);
  assert.deepEqual(state.rangeReads, [
    { row: 2, column: 1, numRows: 2, numColumns: 3, mode: 'values' },
  ]);
  assert.ok([...state.cache.keys()].some(key => /^idx:generation-1:phone:[0-9a-f]{2}$/.test(key)));
  assert.ok([...state.cache.keys()].some(key => /^idx:generation-1:email:[0-9a-f]{2}$/.test(key)));
  assert.equal([...state.cache.keys()].some(key => key.includes('0912345678') || key.includes('lin@example.com')), false);
  assert.ok(state.events.includes('cache:putAll:900'));
});

test('generation invalidation makes old shards unreachable and rebuilds current data', () => {
  const { gas, state } = createHarness();
  assert.deepEqual([...gas.lookupByPhone_('0912345678')], [2]);
  const oldShardKeys = [...state.cache.keys()].filter(key => key.startsWith('idx:generation-1:'));

  gas.invalidateIndexes_();
  state.rows.push(['陳來賓', '0922334455', 'walkin@example.com', '現場報名', '已報到', new Date(), new Date()]);
  const eventBoundary = state.events.length;

  assert.deepEqual([...gas.lookupByPhone_('0922334455')], [4]);
  const laterGets = state.events.slice(eventBoundary).filter(event => event.startsWith('cache:get:'));
  assert.equal(laterGets.some(event => oldShardKeys.some(key => event === `cache:get:${key}`)), false);
  assert.ok(laterGets.some(event => event.includes('idx:generation-2:phone:')));
});

test('caches an empty shard sentinel so repeated misses do not rescan the Sheet', () => {
  const { gas, state } = createHarness();

  assert.deepEqual([...gas.lookupByPhone_('0999999999')], []);
  assert.deepEqual([...gas.lookupByPhone_('0999999999')], []);

  assert.equal(state.rangeReads.filter(read => read.column === 1 && read.numColumns === 3).length, 1);
});

test('refresh after row deletion makes the deleted identity unreachable and shifted row numbers current', () => {
  const { gas, state } = createHarness();
  assert.deepEqual([...gas.lookupByPhone_('0912345678')], [2]);
  assert.deepEqual([...gas.lookupByPhone_('0987654321')], [3]);

  state.rows.splice(1, 1);
  assert.deepEqual({ ...gas.refreshIndexes() }, { ok: true });

  assert.deepEqual([...gas.lookupByPhone_('0912345678')], []);
  assert.deepEqual([...gas.lookupByPhone_('0987654321')], [2]);
});

test('rejects an index shard at or above the 95000-byte cache guard', () => {
  const { gas, state } = createHarness({ digestByteCount: 48_000 });
  assert.throws(() => gas.rebuildIndexes_('oversized'), /INDEX_SHARD_TOO_LARGE/);
  assert.equal(state.events.some(event => event.startsWith('cache:putAll:')), false);
});

test('classifies no rows, one collapsed row, and duplicate rows', () => {
  const { gas } = createHarness();
  assert.deepEqual({ ...gas.classifyRows_([]) }, { kind: 'none' });
  assert.deepEqual({ ...gas.classifyRows_([2, 2]) }, { kind: 'one', row: 2 });
  assert.deepEqual({ ...gas.classifyRows_([2, 3]) }, { kind: 'conflict' });
});

test('walk-in identity conflicts on duplicate or mismatched identifiers', () => {
  const duplicateRows = cloneRows(fixtureRows);
  duplicateRows.push(['另一位林', '0912345678', 'other@example.com', '預先報名', '', '', '']);
  const duplicate = createHarness({ rows: duplicateRows });
  assert.equal(duplicate.gas.resolveWalkInIdentity_('0912345678', 'lin@example.com').kind, 'conflict');

  const mismatch = createHarness();
  assert.equal(mismatch.gas.resolveWalkInIdentity_('0912345678', 'wang@example.com').kind, 'conflict');
  assert.deepEqual(
    { ...mismatch.gas.resolveWalkInIdentity_('0912345678', 'lin@example.com') },
    { kind: 'one', row: 2 }
  );
});

test('reads an attendee without changing Sheet value types', () => {
  const { gas } = createHarness();
  const attendee = gas.readAttendee_(3);
  assert.deepEqual({ ...attendee }, {
    row: 3,
    name: '王大明',
    phone: '0987654321',
    email: 'wang@example.com',
    registrationType: '預先報名',
    status: '已報到',
    checkedInAt: new Date('2026-08-03T05:40:00Z'),
    createdAt: '',
  });
});

test('returns BUSY without reading or writing when the confirmation lock is unavailable', () => {
  const { gas, state } = createHarness({ lockAvailable: false });
  assert.deepEqual({ ...gas.confirmRow_(2) }, { code: 'BUSY' });
  assert.deepEqual(state.rangeReads, []);
  assert.deepEqual(state.events, ['tryLock:1200']);
});

test('preserves the first timestamp and repairs missing metadata on repeated confirmation', () => {
  const { gas, state } = createHarness();
  const firstTimestamp = state.rows[2][5];
  const identityHash = gas.attendeeIdentityHash_(gas.readAttendee_(3));

  const result = gas.confirmRow_(3, identityHash);

  assert.equal(result.code, 'ALREADY_CHECKED_IN');
  assert.equal(result.checkedInAt, firstTimestamp);
  assert.equal(state.rows[2][5], firstTimestamp);
  assert.equal(state.rangeWrites.length, 1);
  assert.equal(state.rangeWrites[0].column, 4);
  assert.equal(state.rows[2][3], '預先報名');
  assert.equal(state.rows[2][6].getTime(), FIXED_NOW);
  assert.equal(state.events.at(-1), 'releaseLock');
});

test('confirmation re-reads A:G and writes metadata, status, and timestamp before flushing', () => {
  const { gas, state } = createHarness();
  const identityHash = gas.attendeeIdentityHash_(gas.readAttendee_(2));
  state.rangeReads = [];

  const result = gas.confirmRow_(2, identityHash);

  assert.equal(result.code, 'CHECKED_IN');
  assert.equal(result.checkedInAt.getTime(), FIXED_NOW);
  assert.deepEqual(state.rangeReads, [
    { row: 1, column: 1, numRows: 1, numColumns: 7, mode: 'display' },
    { row: 2, column: 1, numRows: 1, numColumns: 7, mode: 'values' },
    { row: 2, column: 1, numRows: 2, numColumns: 3, mode: 'values' },
  ]);
  assert.equal(state.rangeWrites.length, 1);
  assert.equal(state.rangeWrites[0].row, 2);
  assert.equal(state.rangeWrites[0].column, 4);
  assert.equal(state.rangeWrites[0].numColumns, 4);
  assert.equal(state.rows[1][4], '已報到');
  assert.equal(state.rows[1][5].getTime(), FIXED_NOW);
  assert.deepEqual(state.events.slice(-3), ['setValues', 'flush', 'releaseLock']);
});

test('confirmation fills registration type and creation time while preserving check-in time', () => {
  const rows = cloneRows(fixtureRows);
  rows[1][3] = '';
  rows[1][4] = '';
  rows[1][5] = '';
  rows[1][6] = '';
  const { gas, state } = createHarness({ rows });
  const identityHash = gas.attendeeIdentityHash_(gas.readAttendee_(2));

  const result = gas.confirmRow_(2, identityHash);

  assert.equal(result.code, 'CHECKED_IN');
  assert.equal(state.rows[1][3], '預先報名');
  assert.equal(state.rows[1][4], '已報到');
  assert.equal(state.rows[1][5].getTime(), FIXED_NOW);
  assert.equal(state.rows[1][6].getTime(), FIXED_NOW);
  assert.equal(state.rangeWrites[0].column, 4);
  assert.equal(state.rangeWrites[0].numColumns, 4);
});

test('syncs a matching registration row into the check-in sheet with metadata', () => {
  const { gas, state } = createHarness({
    sourceRows: [
      ['姓名', '手機', 'E-mail'],
      ['新報名者', '0922334455', 'new@example.com'],
    ],
  });

  const result = gas.syncRegistration_('0922334455', 'new@example.com');

  assert.deepEqual({ ...result }, { kind: 'one', row: 4 });
  assert.deepEqual(state.rows[3].slice(0, 4), ['新報名者', '0922334455', 'new@example.com', '預先報名']);
  assert.equal(state.rows[3][4], '');
  assert.equal(state.rows[3][5], '');
  assert.equal(state.rows[3][6].getTime(), FIXED_NOW);
});

test('confirmation rejects a duplicate identity even when the token row still matches', () => {
  const duplicateRows = cloneRows(fixtureRows);
  duplicateRows.push(['另一位來賓', '0912345678', 'lin@example.com', '預先報名', '', '', '']);
  const duplicate = createHarness({ rows: duplicateRows });
  const identityHash = duplicate.gas.attendeeIdentityHash_(duplicate.gas.readAttendee_(2));

  const result = duplicate.gas.confirmRow_(2, identityHash);

  assert.equal(result.code, 'DATA_CONFLICT');
  assert.equal(duplicate.state.rangeWrites.length, 0);
});

test('confirmation re-resolves the same attendee after rows move and never writes the new row occupant', () => {
  const { gas, state } = createHarness();
  const identityHash = gas.attendeeIdentityHash_(gas.readAttendee_(2));
  state.rows.splice(1, 0, ['新住戶', '0977777777', 'new@example.com', '預先報名', '', '', '']);
  state.rangeReads = [];

  const result = gas.confirmRow_(2, identityHash);

  assert.equal(result.code, 'CHECKED_IN');
  assert.equal(state.rows[1][4], '');
  assert.equal(state.rows[2][4], '已報到');
  assert.ok(state.rangeReads.some(read => read.row === 2 && read.column === 1 && read.numColumns === 3));
});

test('confirmation rejects a missing or ambiguous attendee identity without writing', () => {
  const { gas, state } = createHarness();
  const missing = gas.confirmRow_(2, '0'.repeat(64));
  assert.equal(missing.code, 'DATA_CONFLICT');
  assert.equal(state.rangeWrites.length, 0);

  const duplicateRows = cloneRows(fixtureRows);
  duplicateRows.push([...duplicateRows[1]]);
  const duplicate = createHarness({ rows: duplicateRows });
  const identityHash = duplicate.gas.attendeeIdentityHash_(duplicate.gas.readAttendee_(2));
  const ambiguous = duplicate.gas.confirmRow_(99, identityHash);
  assert.equal(ambiguous.code, 'DATA_CONFLICT');
  assert.equal(duplicate.state.rangeWrites.length, 0);
});

test('confirmation validates exact headers and releases the lock on write failure', () => {
  const badHeaders = cloneRows(fixtureRows);
  badHeaders[0][6] = '錯誤欄位';
  const invalid = createHarness({ rows: badHeaders });
  assert.throws(() => invalid.gas.confirmRow_(2, '0'.repeat(64)), /SHEET_HEADERS_MISMATCH/);
  assert.equal(invalid.state.events.at(-1), 'releaseLock');
  assert.deepEqual(invalid.state.rangeWrites, []);

  const failed = createHarness({ setValuesError: new Error('WRITE_FAILED') });
  const identityHash = failed.gas.attendeeIdentityHash_(failed.gas.readAttendee_(2));
  assert.throws(() => failed.gas.confirmRow_(2, identityHash), /WRITE_FAILED/);
  assert.equal(failed.state.events.at(-1), 'releaseLock');
  assert.equal(failed.state.flushes, 0);
});

test('two identical locked walk-in calls append only once and ignore stale old-generation shards', () => {
  const { gas, state } = createHarness();
  gas.lookupByPhone_('0922334455');
  const input = { name: '陳來賓', phone: '0922334455', email: 'walkin@example.com' };

  const first = gas.registerWalkIn_(input);
  const second = gas.registerWalkIn_(input);

  assert.deepEqual({ ...first }, { code: 'WALK_IN_REGISTERED', row: 4 });
  assert.deepEqual({ ...second }, { code: 'FOUND', row: 4 });
  assert.equal(state.rows.length, 4);
  assert.deepEqual(state.rows[3].slice(0, 5), ['陳來賓', '0922334455', 'walkin@example.com', '現場報名', '已報到']);
  assert.equal(state.rows[3][5].getTime(), FIXED_NOW);
  assert.equal(state.rows[3][6].getTime(), FIXED_NOW);
  assert.equal(state.events.filter(event => event === 'appendRow').length, 1);
  assert.equal(state.events.filter(event => event === 'flush').length, 1);
  assert.equal(state.events.filter(event => event === 'releaseLock').length, 2);
});

test('locked walk-in re-reads A:C instead of trusting stale current-generation shards', () => {
  const { gas, state } = createHarness();
  state.cache.set('idx:generation', 'stale-current');
  const phoneKey = gas.indexKey_('phone', '0922334455', 'stale-current').cacheKey;
  const emailKey = gas.indexKey_('email', 'walkin@example.com', 'stale-current').cacheKey;
  state.cache.set(phoneKey, '{}');
  state.cache.set(emailKey, '{}');
  state.rows.push(['陳來賓', '0922334455', 'walkin@example.com', '現場報名', '已報到', new Date(), new Date()]);

  const result = gas.registerWalkIn_({
    name: '陳來賓', phone: '0922334455', email: 'walkin@example.com',
  });

  assert.deepEqual({ ...result }, { code: 'FOUND', row: 4 });
  assert.equal(state.rows.length, 4);
  assert.equal(state.events.filter(event => event === 'appendRow').length, 0);
  assert.ok(state.rangeReads.some(read =>
    read.row === 2 && read.column === 1 && read.numRows === 3 && read.numColumns === 3
  ));
});

test('walk-in returns BUSY or DATA_CONFLICT without appending', () => {
  const busy = createHarness({ lockAvailable: false });
  assert.deepEqual({ ...busy.gas.registerWalkIn_({}) }, { code: 'BUSY' });
  assert.equal(busy.state.rows.length, 3);

  const conflict = createHarness();
  const result = conflict.gas.registerWalkIn_({
    name: '陳來賓',
    phone: '0912345678',
    email: 'wang@example.com',
  });
  assert.deepEqual({ ...result }, { code: 'DATA_CONFLICT' });
  assert.equal(conflict.state.rows.length, 3);
  assert.equal(conflict.state.events.at(-1), 'releaseLock');
});

test('walk-in enforces the 1000-attendee capacity inside the write lock', () => {
  const headers = cloneRows(fixtureRows).slice(0, 1);
  const attendee = ['既有來賓', '0911111111', 'existing@example.com', '預先報名', '', '', ''];
  const rowsAtCapacity = headers.concat(Array.from({ length: 1000 }, () => [...attendee]));
  const { gas, state } = createHarness({ rows: rowsAtCapacity });

  const result = gas.registerWalkIn_({
    name: '陳來賓', phone: '0922334455', email: 'walkin@example.com',
  });

  assert.deepEqual({ ...result }, { code: 'CAPACITY_REACHED' });
  assert.equal(state.events.filter(event => event === 'appendRow').length, 0);
  assert.equal(state.events.at(-1), 'releaseLock');
});

test('walk-in validates exact headers and releases the lock on append failure', () => {
  const badHeaders = cloneRows(fixtureRows);
  badHeaders[0][0] = '錯誤欄位';
  const invalid = createHarness({ rows: badHeaders });
  assert.throws(() => invalid.gas.registerWalkIn_({
    name: '陳來賓', phone: '0922334455', email: 'walkin@example.com',
  }), /SHEET_HEADERS_MISMATCH/);
  assert.equal(invalid.state.events.at(-1), 'releaseLock');

  const failed = createHarness({ appendRowError: new Error('APPEND_FAILED') });
  assert.throws(() => failed.gas.registerWalkIn_({
    name: '陳來賓', phone: '0922334455', email: 'walkin@example.com',
  }), /APPEND_FAILED/);
  assert.equal(failed.state.events.at(-1), 'releaseLock');
  assert.equal(failed.state.flushes, 0);
});

test('repository and index sources contain no logging calls', () => {
  const source = ['apps-script/Index.gs', 'apps-script/Repository.gs']
    .map(file => fs.readFileSync(file, 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /\b(?:console|Logger)\s*\./);
});
