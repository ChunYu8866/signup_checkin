function getSheet_() {
  var spreadsheet = SpreadsheetApp.openById(CHECKIN.SHEET_ID);
  var sheet = spreadsheet.getSheetByName(CHECKIN.SHEET_NAME);
  if (!sheet) throw new Error('SHEET_NOT_FOUND');
  return sheet;
}

function validateSheetShape_(sheet) {
  var target = sheet || getSheet_();
  var headers = target.getRange(1, 1, 1, CHECKIN.HEADERS.length).getDisplayValues()[0];
  var exact = headers.length === CHECKIN.HEADERS.length && headers.every(function (header, index) {
    return header === CHECKIN.HEADERS[index];
  });
  if (!exact) throw new Error('SHEET_HEADERS_MISMATCH');
  return true;
}

function getSourceSheet_() {
  var spreadsheet = SpreadsheetApp.openById(CHECKIN.SHEET_ID);
  var sheet = spreadsheet.getSheetByName(CHECKIN.SOURCE_SHEET_NAME);
  if (!sheet) throw new Error('SOURCE_SHEET_NOT_FOUND');
  return sheet;
}

function validateSourceSheetShape_(sheet) {
  var target = sheet || getSourceSheet_();
  var headers = target.getRange(1, 1, 1, CHECKIN.SOURCE_HEADERS.length).getDisplayValues()[0];
  var exact = headers.length === CHECKIN.SOURCE_HEADERS.length && headers.every(function (header, index) {
    return header === CHECKIN.SOURCE_HEADERS[index];
  });
  if (!exact) throw new Error('SOURCE_HEADERS_MISMATCH');
  return true;
}

function lookupByPhone_(phone) {
  return getIndexedRows_('phone', normalizePhone_(phone));
}

function lookupByEmail_(email) {
  return getIndexedRows_('email', normalizeEmail_(email));
}

function classifyRows_(rows) {
  var unique = [];
  (rows || []).forEach(function (row) {
    if (unique.indexOf(row) === -1) unique.push(row);
  });
  if (unique.length === 0) return { kind: 'none' };
  if (unique.length === 1) return { kind: 'one', row: unique[0] };
  return { kind: 'conflict' };
}

function resolveWalkInIdentity_(phone, email, sheet) {
  if (sheet) {
    var normalizedPhone = normalizePhone_(phone);
    var normalizedEmail = normalizeEmail_(email);
    var lastRow = sheet.getLastRow();
    var values = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 3).getValues() : [];
    var phoneRows = [];
    var emailRows = [];
    values.forEach(function (value, offset) {
      var row = offset + 2;
      if (normalizedPhone && normalizePhone_(value[1]) === normalizedPhone) phoneRows.push(row);
      if (normalizedEmail && normalizeEmail_(value[2]) === normalizedEmail) emailRows.push(row);
    });
    return classifyRows_(phoneRows.concat(emailRows));
  }
  return classifyRows_(lookupByPhone_(phone).concat(lookupByEmail_(email)));
}

function readAttendee_(row, sheet) {
  var target = sheet || getSheet_();
  var values = target.getRange(row, 1, 1, CHECKIN.HEADERS.length).getValues()[0];
  return {
    row: row,
    name: values[0],
    phone: values[1],
    email: values[2],
    registrationType: values[3],
    status: values[4],
    checkedInAt: values[5],
    createdAt: values[6]
  };
}

function writeAttendeeMetadata_(sheet, attendee, status, checkedInAt, createdAt) {
  var registrationType = normalizeName_(attendee.registrationType) || '預先報名';
  var nextCreatedAt = attendee.createdAt || createdAt || new Date();
  sheet.getRange(attendee.row, 4, 1, 4).setValues([[
    registrationType,
    status == null ? attendee.status : status,
    checkedInAt == null ? attendee.checkedInAt : checkedInAt,
    nextCreatedAt
  ]]);
}

function repairAttendeeMetadata_(row) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CHECKIN.LOCK_WAIT_MS)) return { code: CHECKIN.CODES.BUSY };
  try {
    var sheet = getSheet_();
    validateSheetShape_(sheet);
    var attendee = readAttendee_(row, sheet);
    if (!attendee || (attendee.registrationType && attendee.createdAt)) return { code: 'NOOP' };
    writeAttendeeMetadata_(sheet, attendee, attendee.status, attendee.checkedInAt, new Date());
    SpreadsheetApp.flush();
    return { code: 'REPAIRED' };
  } finally {
    lock.releaseLock();
  }
}

function resolveRegistrationIdentity_(phone, email, sheet) {
  var normalizedPhone = normalizePhone_(phone);
  var normalizedEmail = normalizeEmail_(email);
  var lastRow = sheet.getLastRow();
  var values = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 3).getValues() : [];
  var rows = [];
  values.forEach(function (value, offset) {
    if (
      (normalizedPhone && normalizePhone_(value[1]) === normalizedPhone) ||
      (normalizedEmail && normalizeEmail_(value[2]) === normalizedEmail)
    ) rows.push(offset + 2);
  });
  var classification = classifyRows_(rows);
  if (classification.kind !== 'one') return classification;
  var value = values[classification.row - 2] || [];
  return {
    kind: 'one',
    row: classification.row,
    name: normalizeName_(value[0]),
    phone: normalizePhone_(value[1]),
    email: normalizeEmail_(value[2])
  };
}

function syncRegistration_(phone, email) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CHECKIN.LOCK_WAIT_MS)) return { kind: 'busy' };
  try {
    var sheet = getSheet_();
    validateSheetShape_(sheet);
    var existing = resolveWalkInIdentity_(phone, email, sheet);
    if (existing.kind === 'conflict') return existing;
    if (existing.kind === 'one') {
      var existingAttendee = readAttendee_(existing.row, sheet);
      if (!existingAttendee.registrationType || !existingAttendee.createdAt) {
        writeAttendeeMetadata_(sheet, existingAttendee, existingAttendee.status, existingAttendee.checkedInAt, new Date());
        SpreadsheetApp.flush();
      }
      return existing;
    }

    var sourceSheet = getSourceSheet_();
    validateSourceSheetShape_(sourceSheet);
    var source = resolveRegistrationIdentity_(phone, email, sourceSheet);
    if (source.kind !== 'one') return source;
    if (Math.max(0, sheet.getLastRow() - 1) >= CHECKIN.MAX_ROWS) return { kind: 'capacity' };

    var row = sheet.getLastRow() + 1;
    var now = new Date();
    sheet.appendRow([source.name, source.phone, source.email, '預先報名', '', '', now]);
    SpreadsheetApp.flush();
    invalidateIndexes_();
    return { kind: 'one', row: row };
  } finally {
    lock.releaseLock();
  }
}

function resolveConfirmationAttendee_(row, identityHash, sheet) {
  if (!validAttendeeIdentityHash_(identityHash)) return { kind: 'none' };
  var lastRow = sheet.getLastRow();
  var current = row >= 2 && row <= lastRow ? readAttendee_(row, sheet) : null;
  var values = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 3).getValues() : [];
  var rows = [];
  values.forEach(function (value, offset) {
    if (attendeeIdentityHash_({ phone: value[1], email: value[2] }) === identityHash) {
      rows.push(offset + 2);
    }
  });
  var classification = classifyRows_(rows);
  if (classification.kind !== 'one') return classification;
  if (classification.row === row && current && attendeeIdentityHash_(current) === identityHash) {
    return { kind: 'one', attendee: current };
  }
  return { kind: 'one', attendee: readAttendee_(classification.row, sheet) };
}

function confirmRow_(row, identityHash) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CHECKIN.LOCK_WAIT_MS)) return { code: CHECKIN.CODES.BUSY };
  try {
    var sheet = getSheet_();
    validateSheetShape_(sheet);
    var resolved = resolveConfirmationAttendee_(row, identityHash, sheet);
    if (resolved.kind !== 'one') return { code: CHECKIN.CODES.DATA_CONFLICT };
    var attendee = resolved.attendee;
    if (attendee.status === '已報到') {
      if (!attendee.registrationType || !attendee.createdAt) {
        writeAttendeeMetadata_(sheet, attendee, attendee.status, attendee.checkedInAt, new Date());
        SpreadsheetApp.flush();
      }
      return { code: CHECKIN.CODES.ALREADY_CHECKED_IN, checkedInAt: attendee.checkedInAt };
    }
    var now = new Date();
    writeAttendeeMetadata_(sheet, attendee, '已報到', now, new Date());
    SpreadsheetApp.flush();
    return { code: CHECKIN.CODES.CHECKED_IN, checkedInAt: now };
  } finally {
    lock.releaseLock();
  }
}

function registerWalkIn_(input) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CHECKIN.LOCK_WAIT_MS)) return { code: CHECKIN.CODES.BUSY };
  try {
    var sheet = getSheet_();
    validateSheetShape_(sheet);
    var normalized = {
      name: normalizeName_(input && input.name),
      phone: normalizePhone_(input && input.phone),
      email: normalizeEmail_(input && input.email)
    };
    var identity = resolveWalkInIdentity_(normalized.phone, normalized.email, sheet);
    if (identity.kind === 'conflict') return { code: CHECKIN.CODES.DATA_CONFLICT };
    if (identity.kind === 'one') return { code: CHECKIN.CODES.FOUND, row: identity.row };
    if (Math.max(0, sheet.getLastRow() - 1) >= CHECKIN.MAX_ROWS) {
      return { code: CHECKIN.CODES.CAPACITY_REACHED };
    }

    var row = sheet.getLastRow() + 1;
    var now = new Date();
    sheet.appendRow([
      normalized.name,
      normalized.phone,
      normalized.email,
      '現場報名',
      '已報到',
      now,
      now
    ]);
    SpreadsheetApp.flush();
    invalidateIndexes_();
    return { code: CHECKIN.CODES.WALK_IN_REGISTERED, row: row };
  } finally {
    lock.releaseLock();
  }
}
