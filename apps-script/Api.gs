function response_(requestId, ok, code, data) {
  return {
    version: CHECKIN.VERSION,
    requestId: String(requestId || ''),
    ok: Boolean(ok),
    code: code,
    data: data || {}
  };
}

function issueToken_(attendee) {
  var token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put(
    'token:' + sha256_(token),
    JSON.stringify({
      row: attendee.row,
      identityHash: attendeeIdentityHash_(attendee),
      issuedAt: Date.now()
    }),
    CHECKIN.TOKEN_TTL_SECONDS
  );
  return token;
}

function readToken_(token) {
  var raw = CacheService.getScriptCache().get('token:' + sha256_(String(token || '')));
  if (raw === null) return null;
  try {
    var value = JSON.parse(raw);
    return Number.isInteger(value.row) && value.row >= 2 && validAttendeeIdentityHash_(value.identityHash)
      ? value
      : null;
  } catch (_error) {
    return null;
  }
}

function removeToken_(token) {
  CacheService.getScriptCache().remove('token:' + sha256_(String(token || '')));
}

function lookupMatchesAttendee_(attendee, kind, normalized) {
  return kind === 'phone'
    ? normalizePhone_(attendee && attendee.phone) === normalized
    : normalizeEmail_(attendee && attendee.email) === normalized;
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
    var normalized = kind === 'phone' ? normalizePhone_(payload.phone) : normalizeEmail_(payload.email);
    var error = kind === 'phone' ? validatePhone_(payload.phone) : validateEmail_(payload.email);
    if (error) return response_(requestId, false, CHECKIN.CODES.INVALID_INPUT);
    if (
      rateLimitExceeded_(CHECKIN.RATE_LIMITS.LOOKUP_IDENTITY, kind + ':' + normalized) ||
      rateLimitExceeded_(CHECKIN.RATE_LIMITS.LOOKUP_GLOBAL, 'global')
    ) {
      return response_(requestId, false, CHECKIN.CODES.BUSY);
    }
    var rows = kind === 'phone'
      ? lookupByPhone_(normalized)
      : lookupByEmail_(normalized);
    var classification = classifyRows_(rows);
    if (classification.kind === 'none') return response_(requestId, false, CHECKIN.CODES.NOT_FOUND);
    if (classification.kind === 'conflict') return response_(requestId, false, CHECKIN.CODES.DATA_CONFLICT);
    var attendee = readAttendee_(classification.row);
    if (!lookupMatchesAttendee_(attendee, kind, normalized)) {
      invalidateIndexes_();
      rows = kind === 'phone' ? lookupByPhone_(normalized) : lookupByEmail_(normalized);
      classification = classifyRows_(rows);
      if (classification.kind === 'none') return response_(requestId, false, CHECKIN.CODES.NOT_FOUND);
      if (classification.kind === 'conflict') return response_(requestId, false, CHECKIN.CODES.DATA_CONFLICT);
      attendee = readAttendee_(classification.row);
      if (!lookupMatchesAttendee_(attendee, kind, normalized)) {
        return response_(requestId, false, CHECKIN.CODES.DATA_CONFLICT);
      }
    }
    if (attendee.status === '已報到') {
      return response_(requestId, true, CHECKIN.CODES.ALREADY_CHECKED_IN, {
        checkedInAt: formatTaipei_(attendee.checkedInAt)
      });
    }
    return response_(requestId, true, CHECKIN.CODES.FOUND, {
      maskedName: maskName_(attendee.name),
      token: issueToken_(attendee)
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
    var result = confirmRow_(tokenValue.row, tokenValue.identityHash);
    if (result.code === CHECKIN.CODES.BUSY) return response_(requestId, false, CHECKIN.CODES.BUSY);
    if (result.code === CHECKIN.CODES.CHECKED_IN || result.code === CHECKIN.CODES.ALREADY_CHECKED_IN) {
      removeToken_(token);
      return response_(requestId, true, result.code, {
        checkedInAt: formatTaipei_(result.checkedInAt)
      });
    }
    if (result.code === CHECKIN.CODES.DATA_CONFLICT) {
      removeToken_(token);
      return response_(requestId, false, CHECKIN.CODES.DATA_CONFLICT);
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
    if (rateLimitExceeded_(CHECKIN.RATE_LIMITS.WALK_IN_GLOBAL, 'global')) {
      return response_(requestId, false, CHECKIN.CODES.BUSY);
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
        token: issueToken_(attendee)
      });
    }
    if (
      result.code === CHECKIN.CODES.BUSY ||
      result.code === CHECKIN.CODES.DATA_CONFLICT ||
      result.code === CHECKIN.CODES.CAPACITY_REACHED
    ) {
      return response_(requestId, false, result.code);
    }
    return response_(requestId, false, CHECKIN.CODES.SYSTEM_ERROR);
  } catch (_error) {
    return response_(requestId, false, CHECKIN.CODES.SYSTEM_ERROR);
  }
}
