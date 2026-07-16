function normalizePhone_(value) {
  return String(value == null ? '' : value).replace(/\D/g, '');
}

function normalizeEmail_(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function normalizeName_(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

function validatePhone_(value) {
  return /^09\d{8}$/.test(normalizePhone_(value)) ? '' : '手機格式錯誤';
}

function validateEmail_(value) {
  var normalized = normalizeEmail_(value);
  return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? ''
    : 'E-mail 格式錯誤';
}

function validateName_(value) {
  var raw = String(value == null ? '' : value);
  if (/[\u0009-\u000D\u0085]/u.test(raw)) return '姓名字元錯誤';

  var normalized = normalizeName_(raw);
  var length = Array.from(normalized).length;
  if (length < 2 || length > 50) return '姓名長度錯誤';
  return /\p{L}/u.test(normalized) && /^[\p{L}\p{M} .·・'’-]+$/u.test(normalized)
    ? ''
    : '姓名字元錯誤';
}

function maskName_(value) {
  var chars = Array.from(normalizeName_(value));
  if (chars.length <= 1) return '○';
  if (chars.length === 2) return chars[0] + '○';
  return chars[0] + '○'.repeat(chars.length - 2) + chars[chars.length - 1];
}

function sha256_(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (byte) {
    return ('0' + (byte < 0 ? byte + 256 : byte).toString(16)).slice(-2);
  }).join('');
}

function attendeeIdentityHash_(attendee) {
  return sha256_(
    'attendee:' + normalizePhone_(attendee && attendee.phone) + '\n' +
    normalizeEmail_(attendee && attendee.email)
  );
}

function validAttendeeIdentityHash_(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function formatTaipei_(value) {
  return Utilities.formatDate(new Date(value), CHECKIN.TIME_ZONE, 'yyyy/MM/dd HH:mm');
}
