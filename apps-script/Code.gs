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

function doGet() {
  var template = HtmlService.createTemplateFromFile('Bridge');
  template.allowedOriginsJson = JSON.stringify(getAllowedOrigins_());
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
  return {
    ok: true,
    rows: Math.max(0, getSheet_().getLastRow() - 1),
    walkInEnabled: isWalkInEnabled_()
  };
}

function warmIndexes() {
  validateDeployment();
  rebuildIndexes_(getIndexGeneration_());
  return { ok: true };
}
