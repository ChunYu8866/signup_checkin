function getAllowedOrigins_() {
  var raw = PropertiesService.getScriptProperties().getProperty('ALLOWED_ORIGINS') || '[]';
  var origins = JSON.parse(raw);
  if (!Array.isArray(origins)) throw new Error('ALLOWED_ORIGINS_MUST_BE_ARRAY');
  origins.forEach(function (origin) {
    if (
      !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin) &&
      !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin)
    ) {
      throw new Error('INVALID_ALLOWED_ORIGIN');
    }
  });
  return origins;
}

function isWalkInEnabled_() {
  return PropertiesService.getScriptProperties().getProperty('WALK_IN_ENABLED') === 'true';
}

function isPrivacyApproved_() {
  return PropertiesService.getScriptProperties().getProperty('PRIVACY_NOTICE_APPROVED') === 'true';
}

function getBridgeChannel_(event) {
  var channel = event && event.parameter && event.parameter.channel;
  if (
    typeof channel !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(channel)
  ) {
    throw new Error('INVALID_BRIDGE_CHANNEL');
  }
  return channel;
}

function doGet(event) {
  var template = HtmlService.createTemplateFromFile('Bridge');
  template.allowedOriginsJson = JSON.stringify(getAllowedOrigins_());
  template.channelJson = JSON.stringify(getBridgeChannel_(event));
  return template.evaluate()
    .setTitle('活動報到安全連線')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function initializeSheet() {
  var sheet = getSheet_();
  var current = sheet.getRange(1, 1, 1, CHECKIN.HEADERS.length).getDisplayValues()[0];
  if (current.every(function (value) { return value === ''; })) {
    sheet.getRange(1, 1, 1, CHECKIN.HEADERS.length).setValues([CHECKIN.HEADERS]);
  }
  validateSheetShape_(sheet);
  sheet.setFrozenRows(1);
  return { ok: true };
}

function validateDeployment() {
  var spreadsheet = SpreadsheetApp.openById(CHECKIN.SHEET_ID);
  if (spreadsheet.getSpreadsheetTimeZone() !== CHECKIN.TIME_ZONE) {
    throw new Error('SHEET_TIME_ZONE_MUST_BE_ASIA_TAIPEI');
  }
  if (Session.getScriptTimeZone() !== CHECKIN.TIME_ZONE) {
    throw new Error('SCRIPT_TIME_ZONE_MUST_BE_ASIA_TAIPEI');
  }
  validateSheetShape_();
  var origins = getAllowedOrigins_();
  if (!origins.length) throw new Error('ALLOWED_ORIGINS_REQUIRED');
  var rows = Math.max(0, getSheet_().getLastRow() - 1);
  if (rows > CHECKIN.MAX_ROWS) throw new Error('SHEET_MAX_ROWS_EXCEEDED');
  return {
    ok: true,
    rows: rows,
    walkInEnabled: isWalkInEnabled_()
  };
}

function warmIndexes() {
  validateDeployment();
  rebuildIndexes_(getIndexGeneration_());
  return { ok: true };
}

function refreshIndexes() {
  validateDeployment();
  invalidateIndexes_();
  rebuildIndexes_(getIndexGeneration_());
  return { ok: true };
}

// ====== 對外 API 通道（doPost，供 GitHub Pages 前端跨網域呼叫） ======
function doPost(e) {
  try {
    var request = JSON.parse(e.postData.contents);
    var action = request.action;
    var result;
    if (action === 'healthCheck') result = apiHealthCheck(request);
    else if (action === 'lookupByPhone') result = apiLookupByPhone(request);
    else if (action === 'lookupByEmail') result = apiLookupByEmail(request);
    else if (action === 'confirmCheckIn') result = apiConfirmCheckIn(request);
    else if (action === 'registerWalkIn') result = apiRegisterWalkIn(request);
    else result = response_(request.requestId, false, CHECKIN.CODES.INVALID_INPUT);
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      version: CHECKIN.VERSION,
      requestId: typeof request !== 'undefined' && request ? request.requestId : '',
      ok: false,
      code: CHECKIN.CODES.SYSTEM_ERROR
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
