import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConfig } from '../../scripts/configure-deployment.mjs';
import { loadGas } from '../../scripts/load-gas.mjs';

test('renders exact observed deployment values and all frontend-required fields', () => {
  const output = renderConfig({
    bridgeUrl: 'https://script.google.com/macros/s/abc-123/exec',
    pagesUrl: 'https://owner.github.io/repo/',
    walkInEnabled: true,
    privacyNoticeApproved: true,
    approvedNotice: '法遵核准文字。',
  });
  assert.match(output.web, /bridgeUrl: "https:\/\/script\.google\.com\/macros\/s\/abc-123\/exec"/);
  assert.match(output.web, /bridgeOrigin: "https:\/\/script\.googleusercontent\.com"/);
  assert.match(output.web, /privacyNoticeText: "法遵核准文字。"/);
  assert.deepEqual(output.origins, ['https://owner.github.io']);
});

test('carries an approved HTTPS privacy notice URL into the frontend config and rejects non-HTTPS', () => {
  const output = renderConfig({
    bridgeUrl: 'https://script.google.com/macros/s/abc/exec',
    pagesUrl: 'https://owner.github.io/repo/',
    walkInEnabled: true,
    privacyNoticeApproved: true,
    approvedNoticeUrl: 'https://www.entrust.com.tw/entrust/footer/statement.do?id=abc123',
  });
  assert.match(output.web, /privacyNoticeUrl: "https:\/\/www\.entrust\.com\.tw\/entrust\/footer\/statement\.do\?id=abc123"/);
  assert.throws(() => renderConfig({
    bridgeUrl: 'https://script.google.com/macros/s/abc/exec',
    pagesUrl: 'https://owner.github.io/repo/',
    approvedNoticeUrl: 'http://insecure.example.com/notice',
  }));
});

test('defaults every release gate and approved notice closed', () => {
  const output = renderConfig({
    bridgeUrl: 'https://script.google.com/macros/s/abc/exec',
    pagesUrl: 'https://owner.github.io/repo/',
  });
  assert.match(output.web, /walkInEnabled: false/);
  assert.match(output.web, /privacyNoticeApproved: false/);
  assert.match(output.web, /privacyNoticeText: ""/);
});

test('rejects non-https, non-exec, credentialed, query, and unapproved release values', () => {
  const base = { bridgeUrl: 'https://script.google.com/macros/s/abc/exec', pagesUrl: 'https://owner.github.io/repo/' };
  for (const overrides of [
    { bridgeUrl: 'http://script.google.com/macros/s/abc/exec' },
    { bridgeUrl: 'https://example.com/macros/s/abc/exec' },
    { bridgeUrl: 'https://script.google.com/macros/s/abc/dev' },
    { bridgeUrl: 'https://script.google.com:8443/macros/s/abc/exec' },
    { bridgeUrl: 'https://script.google.com/macros/s/abc/exec?x=1' },
    { pagesUrl: 'http://owner.github.io/repo/' },
    { pagesUrl: 'https://user:pass@owner.github.io/repo/' },
    { walkInEnabled: true, privacyNoticeApproved: true, approvedNotice: '' },
  ]) assert.throws(() => renderConfig({ ...base, ...overrides }));
});

function operationsHarness({ headers, attendeeRows = 2, sheetZone = 'Asia/Taipei', scriptZone = 'Asia/Taipei', origins = ['https://owner.github.io'], operatorEmail = 'owner@example.com', effectiveEmail } = {}) {
  const expected = ['姓名', '手機', 'E-mail', '報名類型', '報到狀態', '報到時間', '資料建立時間'];
  const state = { headers: [...(headers ?? expected)], writes: [], frozen: [], rebuilds: [], invalidations: 0, generation: 'old-generation', validationCalls: 0, events: [] };
  const sheet = {
    getLastRow: () => attendeeRows + 1,
    getRange: () => ({
      getDisplayValues: () => [[...state.headers]],
      setValues(values) { state.writes.push(values); state.headers = [...values[0]]; },
    }),
    setFrozenRows: rows => state.frozen.push(rows),
  };
  const spreadsheet = { getSheetByName: () => sheet, getSpreadsheetTimeZone: () => sheetZone };
  const globals = {
    SpreadsheetApp: { openById: () => spreadsheet },
    Session: {
      getScriptTimeZone: () => scriptZone,
      getActiveUser: () => ({ getEmail: () => operatorEmail }),
      getEffectiveUser: () => ({ getEmail: () => effectiveEmail ?? operatorEmail }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => ({ ALLOWED_ORIGINS: JSON.stringify(origins), WALK_IN_ENABLED: 'false', PRIVACY_NOTICE_APPROVED: 'false' })[key] ?? null }) },
    HtmlService: { createTemplateFromFile() {}, XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' } },
    getSheet_: () => sheet,
    validateSheetShape_() {
      state.events.push('validate');
      state.validationCalls += 1;
      if (state.headers.some((value, index) => value !== expected[index])) throw new Error('SHEET_HEADERS_MISMATCH');
    },
    invalidateIndexes_() { state.events.push('invalidate'); state.invalidations += 1; state.generation = 'new-generation'; },
    getIndexGeneration_() { state.events.push(`get:${state.generation}`); return state.generation; },
    rebuildIndexes_(generation) { state.events.push(`rebuild:${generation}`); state.rebuilds.push(generation); },
  };
  const gas = loadGas(['Config.gs', 'Code.gs'], globals);
  return { gas, state };
}

test('initializeSheet writes only a completely blank header row, then validates and freezes', () => {
  const blank = operationsHarness({ headers: Array(7).fill('') });
  assert.deepEqual({ ...blank.gas.initializeSheet() }, { ok: true });
  assert.equal(blank.state.writes.length, 1);
  assert.deepEqual(blank.state.frozen, [1]);
  assert.equal(blank.state.validationCalls, 1);

  const partial = operationsHarness({ headers: ['姓名', '', '', '', '', '', ''] });
  assert.throws(() => partial.gas.initializeSheet(), /SHEET_HEADERS_MISMATCH/);
  assert.equal(partial.state.writes.length, 0);
  assert.deepEqual(partial.state.frozen, []);
});

test('operations functions refuse anonymous web-app callers and stay editor-only', () => {
  for (const name of ['initializeSheet', 'validateDeployment', 'warmIndexes', 'refreshIndexes']) {
    const anonymous = operationsHarness({ operatorEmail: '' });
    assert.throws(() => anonymous.gas[name](), /OPERATOR_ONLY/, `${name} must reject anonymous callers`);
    assert.deepEqual(anonymous.state.writes, []);
    assert.deepEqual(anonymous.state.rebuilds, []);

    // 同 Workspace 網域的已登入訪客：getActiveUser 有 email，但不等於執行身分（部署者），仍須拒絕。
    const sameDomainVisitor = operationsHarness({ operatorEmail: 'colleague@corp.example', effectiveEmail: 'owner@corp.example' });
    assert.throws(() => sameDomainVisitor.gas[name](), /OPERATOR_ONLY/, `${name} must reject same-domain visitors`);
    assert.deepEqual(sameDomainVisitor.state.rebuilds, []);
  }
  const broken = operationsHarness();
  broken.gas.Session = undefined;
  const rethrown = loadGas(['Config.gs', 'Code.gs'], {
    ...Object.fromEntries(['SpreadsheetApp', 'PropertiesService', 'HtmlService', 'getSheet_', 'validateSheetShape_', 'invalidateIndexes_', 'getIndexGeneration_', 'rebuildIndexes_'].map(key => [key, broken.gas[key]])),
    Session: { getScriptTimeZone: () => 'Asia/Taipei', getActiveUser: () => { throw new Error('no user'); } },
  });
  assert.throws(() => rethrown.validateDeployment(), /OPERATOR_ONLY/);
});

test('validateDeployment requires both Taipei zones, exact headers, and at least one origin', () => {
  const valid = operationsHarness();
  assert.deepEqual({ ...valid.gas.validateDeployment() }, { ok: true, rows: 2, walkInEnabled: false });
  assert.throws(() => operationsHarness({ sheetZone: 'UTC' }).gas.validateDeployment(), /SHEET_TIME_ZONE_MUST_BE_ASIA_TAIPEI/);
  assert.throws(() => operationsHarness({ scriptZone: 'UTC' }).gas.validateDeployment(), /SCRIPT_TIME_ZONE_MUST_BE_ASIA_TAIPEI/);
  assert.throws(() => operationsHarness({ origins: [] }).gas.validateDeployment(), /ALLOWED_ORIGINS_REQUIRED/);
});

test('validateDeployment allows 999 and 1000 attendees but rejects 1001', () => {
  assert.equal(operationsHarness({ attendeeRows: 999 }).gas.validateDeployment().rows, 999);
  assert.equal(operationsHarness({ attendeeRows: 1000 }).gas.validateDeployment().rows, 1000);
  assert.throws(() => operationsHarness({ attendeeRows: 1001 }).gas.validateDeployment(), /SHEET_MAX_ROWS_EXCEEDED/);
});

test('warmIndexes validates deployment before rebuilding the current generation', () => {
  const valid = operationsHarness();
  assert.deepEqual({ ...valid.gas.warmIndexes() }, { ok: true });
  assert.deepEqual(valid.state.rebuilds, ['old-generation']);
  const invalid = operationsHarness({ sheetZone: 'UTC' });
  assert.throws(() => invalid.gas.warmIndexes(), /SHEET_TIME_ZONE/);
  assert.deepEqual(invalid.state.rebuilds, []);
});

test('refreshIndexes validates, invalidates, obtains the new generation, then rebuilds it', () => {
  const harness = operationsHarness();

  assert.deepEqual({ ...harness.gas.refreshIndexes() }, { ok: true });
  assert.equal(harness.state.invalidations, 1);
  assert.deepEqual(harness.state.rebuilds, ['new-generation']);
  assert.deepEqual(harness.state.events, [
    'validate',
    'invalidate',
    'get:new-generation',
    'rebuild:new-generation',
  ]);
});
