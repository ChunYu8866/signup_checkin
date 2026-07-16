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
    { bridgeUrl: 'https://script.google.com/macros/s/abc/exec?x=1' },
    { pagesUrl: 'http://owner.github.io/repo/' },
    { pagesUrl: 'https://user:pass@owner.github.io/repo/' },
    { walkInEnabled: true, privacyNoticeApproved: true, approvedNotice: '' },
  ]) assert.throws(() => renderConfig({ ...base, ...overrides }));
});

function operationsHarness({ headers, sheetZone = 'Asia/Taipei', scriptZone = 'Asia/Taipei', origins = ['https://owner.github.io'] } = {}) {
  const expected = ['姓名', '手機', 'E-mail', '報名類型', '報到狀態', '報到時間', '資料建立時間'];
  const state = { headers: [...(headers ?? expected)], writes: [], frozen: [], rebuilds: [], validationCalls: 0 };
  const sheet = {
    getLastRow: () => 3,
    getRange: () => ({
      getDisplayValues: () => [[...state.headers]],
      setValues(values) { state.writes.push(values); state.headers = [...values[0]]; },
    }),
    setFrozenRows: rows => state.frozen.push(rows),
  };
  const spreadsheet = { getSheetByName: () => sheet, getSpreadsheetTimeZone: () => sheetZone };
  const globals = {
    SpreadsheetApp: { openById: () => spreadsheet },
    Session: { getScriptTimeZone: () => scriptZone },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => ({ ALLOWED_ORIGINS: JSON.stringify(origins), WALK_IN_ENABLED: 'false', PRIVACY_NOTICE_APPROVED: 'false' })[key] ?? null }) },
    HtmlService: { createTemplateFromFile() {}, XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' } },
    getSheet_: () => sheet,
    validateSheetShape_() {
      state.validationCalls += 1;
      if (state.headers.some((value, index) => value !== expected[index])) throw new Error('SHEET_HEADERS_MISMATCH');
    },
    getIndexGeneration_: () => 'current-generation',
    rebuildIndexes_: generation => state.rebuilds.push(generation),
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

test('validateDeployment requires both Taipei zones, exact headers, and at least one origin', () => {
  const valid = operationsHarness();
  assert.deepEqual({ ...valid.gas.validateDeployment() }, { ok: true, rows: 2, walkInEnabled: false });
  assert.throws(() => operationsHarness({ sheetZone: 'UTC' }).gas.validateDeployment(), /SHEET_TIME_ZONE_MUST_BE_ASIA_TAIPEI/);
  assert.throws(() => operationsHarness({ scriptZone: 'UTC' }).gas.validateDeployment(), /SCRIPT_TIME_ZONE_MUST_BE_ASIA_TAIPEI/);
  assert.throws(() => operationsHarness({ origins: [] }).gas.validateDeployment(), /ALLOWED_ORIGINS_REQUIRED/);
});

test('warmIndexes validates deployment before rebuilding the current generation', () => {
  const valid = operationsHarness();
  assert.deepEqual({ ...valid.gas.warmIndexes() }, { ok: true });
  assert.deepEqual(valid.state.rebuilds, ['current-generation']);
  const invalid = operationsHarness({ sheetZone: 'UTC' });
  assert.throws(() => invalid.gas.warmIndexes(), /SHEET_TIME_ZONE/);
  assert.deepEqual(invalid.state.rebuilds, []);
});
