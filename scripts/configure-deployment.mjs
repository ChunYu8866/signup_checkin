import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function observedUrl(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be an exact observed HTTPS URL`);
  }
  return url;
}

export function renderConfig({
  bridgeUrl,
  pagesUrl,
  walkInEnabled = false,
  privacyNoticeApproved = false,
  approvedNotice = '',
}) {
  const bridge = observedUrl(bridgeUrl, 'Bridge URL');
  const pages = observedUrl(pagesUrl, 'Pages URL');
  if (bridge.hostname !== 'script.google.com' || bridge.port || !/^\/macros\/s\/[^/]+\/exec$/.test(bridge.pathname)) {
    throw new Error('Bridge URL must be an observed Apps Script /exec URL');
  }
  const enabled = walkInEnabled === true;
  const approved = privacyNoticeApproved === true;
  const notice = String(approvedNotice || '').trim();
  if (enabled && (!approved || !notice)) {
    throw new Error('Walk-in release requires approved privacy notice text');
  }
  const web = `export const APP_CONFIG = Object.freeze({
  bridgeUrl: ${JSON.stringify(bridge.href)},
  bridgeOrigin: "https://script.googleusercontent.com",
  walkInEnabled: ${enabled},
  privacyNoticeApproved: ${approved},
  privacyNoticeText: ${JSON.stringify(approved ? notice : '')},
});
`;
  return { web, origins: [pages.origin] };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const pairs = [];
  for (let index = 2; index < process.argv.length; index += 2) pairs.push([process.argv[index], process.argv[index + 1]]);
  const args = Object.fromEntries(pairs);
  const output = renderConfig({
    bridgeUrl: args['--bridge-url'],
    pagesUrl: args['--pages-url'],
    walkInEnabled: args['--walk-in-enabled'] === 'true',
    privacyNoticeApproved: args['--privacy-approved'] === 'true',
    approvedNotice: args['--approved-notice'] || '',
  });
  fs.writeFileSync(new URL('../web/assets/js/config.js', import.meta.url), output.web, 'utf8');
  process.stdout.write(`${JSON.stringify({ allowedOrigins: output.origins })}\n`);
}
