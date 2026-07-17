import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// 公開 repo 個資守門：正式參加者名單絕不能進入版本控制。
// 這裡擋兩類事故：(1) 試算表檔案被直接 commit；(2) 名單內容被貼進任何非測試檔案。
// 測試資料（tests/ 底下的假名單）不受限。

const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

test('no spreadsheet-like data files are ever tracked in the public repo', () => {
  const dataFiles = trackedFiles.filter(file => /\.(csv|tsv|xlsx|xlsm|xls|ods)$/i.test(file));
  assert.deepEqual(dataFiles, [], `發現疑似名單資料檔，禁止 commit：${dataFiles.join(', ')}`);
});

test('no non-test file contains a bulk list of Taiwan mobile numbers', () => {
  const offenders = [];
  for (const file of trackedFiles) {
    if (file.startsWith('tests/')) continue;
    if (!fs.existsSync(file) || fs.statSync(file).size > 2 * 1024 * 1024) continue;
    const content = fs.readFileSync(file, 'utf8');
    const distinct = new Set(content.match(/09\d{8}/g) ?? []);
    if (distinct.size >= 10) offenders.push(`${file} (${distinct.size} 組手機號)`);
  }
  assert.deepEqual(offenders, [], `疑似把名單貼進了公開檔案：${offenders.join(', ')}`);
});
