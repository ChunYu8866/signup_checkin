export const normalizePhoneSuffix = raw => String(raw ?? '').replace(/\D/g, '').slice(0, 8);
export const fullPhone = suffix => `09${normalizePhoneSuffix(suffix)}`;
export const normalizeEmail = raw => String(raw ?? '').trim().toLowerCase();
export const normalizeName = raw => String(raw ?? '').trim().replace(/\s+/gu, ' ');

export function validatePhoneSuffix(raw) {
  return /^\d{8}$/.test(normalizePhoneSuffix(raw)) ? null : '請輸入手機號碼後 8 碼';
}

export function validateEmail(raw) {
  const value = String(raw ?? '').trim();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return '請輸入有效的 E-mail';
  }
  return null;
}

export function validateName(raw) {
  const value = normalizeName(raw);
  if ([...value].length < 2 || [...value].length > 50) {
    return '姓名需為 2 至 50 個字元';
  }
  if (!/^[\p{L}\p{M} .·・'’-]+$/u.test(value)) {
    return '姓名包含不支援的字元';
  }
  return null;
}
