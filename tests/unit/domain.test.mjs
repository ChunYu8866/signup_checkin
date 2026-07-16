import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhoneSuffix,
  fullPhone,
  normalizeEmail,
  normalizeName,
  validatePhoneSuffix,
  validateEmail,
  validateName,
} from '../../web/assets/js/domain.js';

test('phone suffix keeps eight digits and builds a Taiwan mobile number', () => {
  assert.equal(normalizePhoneSuffix('12 34-5678'), '12345678');
  assert.equal(fullPhone('12345678'), '0912345678');
  assert.equal(validatePhoneSuffix('12345678'), null);
  assert.equal(validatePhoneSuffix('1234567'), '請輸入手機號碼後 8 碼');
});

test('phone suffix validation rejects raw input containing more than eight digits', () => {
  assert.equal(validatePhoneSuffix('123456789'), '請輸入手機號碼後 8 碼');
  assert.equal(validatePhoneSuffix('0912345678'), '請輸入手機號碼後 8 碼');
});

test('email comparison is trimmed and case-insensitive', () => {
  assert.equal(normalizeEmail(' User@Example.COM '), 'user@example.com');
  assert.equal(validateEmail('user@example.com'), null);
  assert.equal(validateEmail('user@'), '請輸入有效的 E-mail');
});

test('name normalization accepts common name punctuation and rejects markup', () => {
  assert.equal(normalizeName('  歐陽  明  '), '歐陽 明');
  assert.equal(validateName('王小明'), null);
  assert.equal(validateName('<王>'), '姓名包含不支援的字元');
  assert.equal(validateName('王'), '姓名需為 2 至 50 個字元');
});

test('name validation rejects control whitespace and names without letters', () => {
  assert.equal(validateName('王\n小明'), '姓名包含不支援的字元');
  assert.equal(validateName('王\t小明'), '姓名包含不支援的字元');
  assert.equal(validateName('・-'), '姓名包含不支援的字元');
  assert.equal(validateName('\u0301\u0301'), '姓名包含不支援的字元');
});
