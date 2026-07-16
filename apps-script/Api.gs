function response_(requestId, ok, code, data) {
  return {
    version: CHECKIN.VERSION,
    requestId: String(requestId || ''),
    ok: Boolean(ok),
    code: code,
    data: data || {}
  };
}

function issueToken_(row) {
  var token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put(
    'token:' + sha256_(token),
    JSON.stringify({ row: row, issuedAt: Date.now() }),
    CHECKIN.TOKEN_TTL_SECONDS
  );
  return token;
}

function readToken_(token) {
  var raw = CacheService.getScriptCache().get('token:' + sha256_(String(token || '')));
  if (raw === null) return null;
  try {
    var value = JSON.parse(raw);
    return Number.isInteger(value.row) && value.row >= 2 ? value : null;
  } catch (_error) {
    return null;
  }
}

function removeToken_(token) {
  CacheService.getScriptCache().remove('token:' + sha256_(String(token || '')));
}

function validRequest_(request) {
  return Boolean(
    request &&
    request.version === CHECKIN.VERSION &&
    typeof request.requestId === 'string' &&
    request.payload &&
    typeof request.payload === 'object'
  );
}

function requestId_(request) {
  return request && typeof request.requestId === 'string' ? request.requestId : '';
}

function lookupResponse_(request, kind) {
  var requestId = requestId_(request);
  if (!validRequest_(request)) return response_(requestId, false, CHECKIN.CODES.INVALID_INPUT);
  try {
    var payload = request.payload;
    var error = kind === 'phone' ? validatePhone_(payload.phone) : validateEmail_(payload.email);
    if (error) return response_(requestId, false, CHECKIN.CODES.INVALID_INPUT);
    var rows = kind === 'phone'
      ? lookupByPhone_(normalizePhone_(payload.phone))
      : lookupByEmail_(normalizeEmail_(payload.email));
    var classification = classifyRows_(rows);
    if (classification.kind === 'none') return response_(requestId, false, CHECKIN.CODES.NOT_FOUND);
    if (classification.kind === 'conflict') return response_(requestId, false, CHECKIN.CODES.DATA_CONFLICT);
    var attendee = readAttendee_(classification.row);
    if (attendee.status === '已報到') {
      return response_(requestId, true, CHECKIN.CODES.ALREADY_CHECKED_IN, {
        checkedInAt: formatTaipei_(attendee.checkedInAt)
      });
    }
    return response_(requestId, true, CHECKIN.CODES.FOUND, {
      maskedName: maskName_(attendee.name),
      token: issueToken_(classification.row)
    });
  } catch (_error) {
    return response_(requestId, false, CHECKIN.CODES.SYSTEM_ERROR);
  }
}

function apiHealthCheck(request) {
  var requestId = requestId_(request);
  if (!validRequest_(request)) return response_(requestId, false, CHECKIN.CODES.INVALID_INPUT);
  try {
    return response_(requestId, true, CHECKIN.CODES.FOUND, {
      version: CHECKIN.VERSION,
      walkInEnabled: isWalkInEnabled_(),
      privacyNoticeApproved: isPrivacyApproved_(),
      serverTime: Date.now()
    });
  } catch (_error) {
    return response_(requestId, false, CHECKIN.CODES.SYSTEM_ERROR);
  }
}

function apiLookupByPhone(request) {
  return lookupResponse_(request, 'phone');
}

function apiLookupByEmail(request) {
  return lookupResponse_(request, 'email');
}

function apiConfirmCheckIn(request) {
  var requestId = requestId_(request);
  if (!validRequest_(request) || typeof request.payload.token !== 'string' || !request.payload.token) {
    return response_(requestId, false, CHECKIN.CODES.INVALID_INPUT);
  }
  try {
    var token = request.payload.token;
    var tokenValue = readToken_(token);
    if (!tokenValue) return response_(requestId, false, CHECKIN.CODES.TOKEN_EXPIRED);
    var result = confirmRow_(tokenValue.row);
    if (result.code === CHECKIN.CODES.BUSY) return response_(requestId, false, CHECKIN.CODES.BUSY);
    if (result.code === CHECKIN.CODES.CHECKED_IN || result.code === CHECKIN.CODES.ALREADY_CHECKED_IN) {
      removeToken_(token);
      return response_(requestId, true, result.code, {
        checkedInAt: formatTaipei_(result.checkedInAt)
      });
    }
    return response_(requestId, false, CHECKIN.CODES.SYSTEM_ERROR);
  } catch (_error) {
    return response_(requestId, false, CHECKIN.CODES.SYSTEM_ERROR);
  }
}

function apiRegisterWalkIn(request) {
  var requestId = requestId_(request);
  if (!validRequest_(request)) return response_(requestId, false, CHECKIN.CODES.INVALID_INPUT);
  try {
    var payload = request.payload;
    if (
      !isWalkInEnabled_() ||
      !isPrivacyApproved_() ||
      payload.consent !== true ||
      validateName_(payload.name) ||
      validatePhone_(payload.phone) ||
      validateEmail_(payload.email)
    ) {
      return response_(requestId, false, CHECKIN.CODES.INVALID_INPUT);
    }
    var result = registerWalkIn_({
      name: normalizeName_(payload.name),
      phone: normalizePhone_(payload.phone),
      email: normalizeEmail_(payload.email)
    });
    if (result.code === CHECKIN.CODES.WALK_IN_REGISTERED) {
      return response_(requestId, true, result.code);
    }
    if (result.code === CHECKIN.CODES.FOUND) {
      var attendee = readAttendee_(result.row);
      if (attendee.status === '已報到') {
        return response_(requestId, true, CHECKIN.CODES.ALREADY_CHECKED_IN, {
          checkedInAt: formatTaipei_(attendee.checkedInAt)
        });
      }
      return response_(requestId, true, CHECKIN.CODES.FOUND, {
        maskedName: maskName_(attendee.name),
        token: issueToken_(result.row)
      });
    }
    if (result.code === CHECKIN.CODES.BUSY || result.code === CHECKIN.CODES.DATA_CONFLICT) {
      return response_(requestId, false, result.code);
    }
    return response_(requestId, false, CHECKIN.CODES.SYSTEM_ERROR);
  } catch (_error) {
    return response_(requestId, false, CHECKIN.CODES.SYSTEM_ERROR);
  }
}
