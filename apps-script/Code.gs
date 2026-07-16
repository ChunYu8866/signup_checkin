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
