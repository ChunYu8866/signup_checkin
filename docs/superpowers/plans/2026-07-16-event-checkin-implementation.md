# Event Check-in System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a mobile-first GitHub Pages check-in site backed by Google Apps Script and Google Sheets for the Hua Nan Securities 2026 second-half investment outlook event.

**Architecture:** GitHub Pages owns the visible UI. A hidden Apps Script Bridge built with an HTML-service iframe validates the GitHub origin, relays versioned `postMessage` requests through `google.script.run`, and returns sanitized responses. Apps Script uses hashed, sharded cache indexes for reads and a short script lock plus a second data check for idempotent writes; Google Sheet remains the source of truth. The browser uses a 虛擬等候室 for bounded, jittered retries when the backend reports temporary pressure.

**Tech Stack:** HTML5, CSS3, browser ES modules, Node.js 20+ built-in test runner, Playwright, Google Apps Script V8, Google Sheets, GitHub Pages, GitHub Actions.

## Global Constraints

- Support viewport widths from 320px upward; desktop content has a maximum width of 560px.
- Use `#B3000E`, `#42515B`, white, and light gray with `Noto Sans TC` and system sans-serif fallbacks.
- Do not download or redistribute Hua Nan website images; use the text brand until the organizer supplies an approved logo.
- The visible phone field has a fixed `09` prefix and accepts exactly 8 digits through `inputmode="numeric"`.
- Normalize E-mail by trimming and lowercasing for comparison; preserve the submitted spelling in the sheet.
- Never place full name, phone, E-mail, row number, token, or request payload in URLs, browser storage, or logs.
- The browser may receive only masked name, status, formatted first check-in time, request ID, response code, and a five-minute confirmation token.
- Use `Asia/Taipei` for both Apps Script and Google Sheet; block deployment validation if either differs.
- Keep the sheet columns in this exact order: `姓名`, `手機`, `E-mail`, `報名類型`, `報到狀態`, `報到時間`, `資料建立時間`.
- Preserve the first check-in time and never create a second check-in record for the same row.
- Treat duplicate phones, duplicate E-mails, and a phone/E-mail cross-person mismatch as `DATA_CONFLICT`; never merge automatically.
- The virtual waiting room uses 2, 4, 8, 12, and 16 second base delays with jitter and stops automatic retries by 60 seconds.
- The personal-data notice and approved logo are release gates; the walk-in path stays disabled until the organizer supplies approved notice copy.
- Use fake data for automated and load tests; never copy the production attendee list into test fixtures.

---

## File Structure

```text
.
├── .github/workflows/verify.yml       # CI for unit and browser tests
├── apps-script/
│   ├── Api.gs                         # Versioned public server functions and response mapping
│   ├── Bridge.html                    # Origin-checked postMessage/google.script.run relay
│   ├── Code.gs                        # doGet, setup, health, and deployment validation
│   ├── Config.gs                      # Script properties, constants, headers, and error codes
│   ├── Domain.gs                      # Pure normalization, masking, hashing, and validation
│   ├── Index.gs                       # Sharded Script Cache lookup index
│   └── Repository.gs                  # Sheet reads, conflict resolution, and locked writes
├── docs/
│   ├── operations/event-day-runbook.md
│   └── privacy-notice-draft.md
├── scripts/
│   ├── configure-deployment.mjs       # Writes observed deployment values into local config
│   └── load-gas.mjs                   # Loads .gs files into a test VM with service mocks
├── tests/
│   ├── e2e/checkin.spec.mjs
│   ├── fixtures/fake-attendees.mjs
│   ├── unit/bridge-client.test.mjs
│   ├── unit/domain.test.mjs
│   ├── unit/gas-api.test.mjs
│   ├── unit/gas-domain.test.mjs
│   ├── unit/gas-repository.test.mjs
│   └── unit/retry.test.mjs
├── web/
│   ├── assets/css/app.css
│   ├── assets/js/app.js                # Screen controller and event bindings
│   ├── assets/js/bridge-client.js      # postMessage request/response client
│   ├── assets/js/config.js             # Generated Bridge URL and release gates
│   ├── assets/js/domain.js             # Browser input normalization and validation
│   ├── assets/js/retry.js              # Waiting-room backoff policy
│   └── index.html                      # Accessible single-page check-in shell
├── appsscript.json
├── package-lock.json
├── package.json
└── playwright.config.mjs
```

---

### Task 1: Establish the testable static site and CI baseline

**Files:**
- Create: `package.json`
- Create: `playwright.config.mjs`
- Create: `.github/workflows/verify.yml`
- Create: `web/index.html`
- Create: `web/assets/css/app.css`
- Create: `tests/unit/smoke.test.mjs`
- Create: `tests/e2e/checkin.spec.mjs`

**Interfaces:**
- Consumes: None.
- Produces: `web/index.html` with stable `data-screen`, form IDs, status region, and buttons used by later tasks; `npm test` and `npm run test:e2e` verification commands.

- [ ] **Step 1: Create the package manifest and install the browser-test dependency**

```json
{
  "name": "hua-nan-event-checkin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test tests/unit/*.test.mjs",
    "test:e2e": "playwright test",
    "verify": "npm test && npm run test:e2e"
  },
  "devDependencies": {
    "@playwright/test": "1.55.0"
  }
}
```

Run: `npm install`  
Expected: `package-lock.json` is created and `npm audit` reports no unresolved critical vulnerability.

Create the initial unit-test sentinel so the test glob is valid from the first commit:

```js
// tests/unit/smoke.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
test('unit test runner is active', () => assert.equal(1 + 1, 2));
```

- [ ] **Step 2: Write the failing responsive-shell browser test**

```js
// tests/e2e/checkin.spec.mjs
import { test, expect } from '@playwright/test';

test('shows event details and both entry paths at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '2026 下半年投資展望會' })).toBeVisible();
  await expect(page.getByText('2026/08/03 14:00')).toBeVisible();
  await expect(page.getByText('華南銀行國際會議中心')).toBeVisible();
  await expect(page.getByRole('button', { name: '我有事先報名' })).toBeVisible();
  await expect(page.getByRole('button', { name: '我要現場報名' })).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
});
```

```js
// playwright.config.mjs
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: {
    command: 'python -m http.server 4173 --directory web',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true
  }
});
```

Run: `npm run test:e2e`  
Expected: FAIL because `web/index.html` does not exist.

- [ ] **Step 3: Implement the accessible HTML shell and core layout**

Create `web/index.html` with this fixed structure. Later tasks fill screen behavior without replacing these IDs:

```html
<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#B3000E">
  <title>2026 下半年投資展望會｜活動報到</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="./assets/css/app.css">
</head>
<body>
  <main class="shell" id="app">
    <header class="brand"><span aria-label="華南永昌證券">華南永昌證券</span></header>
    <section class="event-card" aria-labelledby="event-title">
      <p class="eyebrow">活動報到</p>
      <h1 id="event-title">2026 下半年投資展望會</h1>
      <dl class="event-meta">
        <div><dt>時間</dt><dd>2026/08/03 14:00</dd></div>
        <div><dt>地點</dt><dd>華南銀行國際會議中心</dd></div>
        <div><dt>地址</dt><dd>台北市松仁路 123 號 2 樓</dd></div>
      </dl>
      <a class="text-link" href="https://www.google.com/maps/search/?api=1&query=%E5%8F%B0%E5%8C%97%E5%B8%82%E6%9D%BE%E4%BB%81%E8%B7%AF123%E8%99%9F2%E6%A8%93" target="_blank" rel="noopener noreferrer">開啟地圖</a>
    </section>
    <section class="panel" data-screen="home">
      <h2>請選擇報到方式</h2>
      <button id="pre-registered" class="button button--primary" type="button">我有事先報名</button>
      <button id="walk-in" class="button button--secondary" type="button" disabled aria-describedby="walk-in-release-note">我要現場報名</button>
      <p id="walk-in-release-note" class="hint">現場報名將於個資蒐集告知核准後開放。</p>
    </section>
    <section id="screen-host" class="panel" hidden></section>
    <div id="status" class="sr-only" role="status" aria-live="polite"></div>
  </main>
  <script type="module" src="./assets/js/app.js"></script>
</body>
</html>
```

Create `web/assets/css/app.css` with the production tokens and responsive rules:

```css
:root{color-scheme:light;--brand:#b3000e;--ink:#42515b;--muted:#68747c;--line:#d9dee2;--surface:#fff;--canvas:#f6f7f8;--ok:#157347;--danger:#b3261e;--radius:18px;--shadow:0 16px 40px rgba(20,26,38,.10);font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif}
*{box-sizing:border-box}html{min-width:320px;background:var(--canvas)}body{margin:0;min-width:320px;color:var(--ink);background:linear-gradient(180deg,#fff 0,#f6f7f8 45%);font-size:16px;line-height:1.6;overflow-x:hidden}
button,input{font:inherit}.shell{width:min(100%,560px);min-height:100svh;margin:auto;padding:env(safe-area-inset-top) 16px calc(24px + env(safe-area-inset-bottom))}.brand{padding:22px 4px 14px;color:var(--brand);font-size:20px;font-weight:800;letter-spacing:.04em}.event-card,.panel{background:var(--surface);border:1px solid rgba(66,81,91,.12);border-radius:var(--radius);box-shadow:var(--shadow);padding:22px}.panel{margin-top:16px}.eyebrow{margin:0;color:var(--brand);font-weight:700}.event-card h1{margin:.25rem 0 1rem;font-size:clamp(1.55rem,7vw,2rem);line-height:1.3}.event-meta{margin:0}.event-meta div{display:grid;grid-template-columns:3.2rem 1fr;gap:.75rem}.event-meta dt{color:var(--muted)}.event-meta dd{margin:0;font-weight:600}.text-link{display:inline-block;margin-top:12px;color:var(--brand);font-weight:700}.button{display:block;width:100%;min-height:50px;margin-top:12px;border-radius:12px;border:1px solid var(--brand);font-weight:750;cursor:pointer}.button--primary{color:#fff;background:var(--brand)}.button--secondary{color:var(--brand);background:#fff}.button:disabled{cursor:not-allowed;opacity:.55}.hint{margin:.65rem 0 0;color:var(--muted);font-size:.875rem}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(min-width:700px){.shell{padding-top:28px}.event-card,.panel{padding:28px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;transition-duration:.01ms!important}}
```

Create `web/assets/js/app.js` with a no-op release-gated start so the module loads:

```js
document.documentElement.dataset.appReady = 'true';
```

- [ ] **Step 4: Run the browser test**

Run: `npx playwright install chromium; npm run test:e2e`  
Expected: 1 test passes at 320px with no horizontal overflow.

- [ ] **Step 5: Add CI and commit**

```yaml
# .github/workflows/verify.yml
name: verify
on:
  push:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run verify
```

Run:

```powershell
git add package.json package-lock.json playwright.config.mjs .github web tests/unit/smoke.test.mjs tests/e2e/checkin.spec.mjs
git commit -m "build: add responsive site and test baseline"
```

Expected: clean commit; `git status --short` prints nothing.

---

### Task 2: Implement browser-side normalization and validation

**Files:**
- Create: `web/assets/js/domain.js`
- Create: `tests/unit/domain.test.mjs`

**Interfaces:**
- Consumes: Raw strings from visible forms.
- Produces: `normalizePhoneSuffix(raw): string`, `fullPhone(suffix): string`, `normalizeEmail(raw): string`, `normalizeName(raw): string`, `validatePhoneSuffix(raw): string|null`, `validateEmail(raw): string|null`, and `validateName(raw): string|null`.

- [ ] **Step 1: Write failing tests for accepted and rejected inputs**

```js
// tests/unit/domain.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhoneSuffix, fullPhone, normalizeEmail, normalizeName, validatePhoneSuffix, validateEmail, validateName } from '../../web/assets/js/domain.js';

test('phone suffix keeps eight digits and builds a Taiwan mobile number', () => {
  assert.equal(normalizePhoneSuffix('12 34-5678'), '12345678');
  assert.equal(fullPhone('12345678'), '0912345678');
  assert.equal(validatePhoneSuffix('12345678'), null);
  assert.equal(validatePhoneSuffix('1234567'), '請輸入手機號碼後 8 碼');
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
```

Run: `npm test`  
Expected: FAIL with module-not-found for `web/assets/js/domain.js`.

- [ ] **Step 2: Implement the pure browser domain module**

```js
// web/assets/js/domain.js
export const normalizePhoneSuffix = raw => String(raw ?? '').replace(/\D/g, '').slice(0, 8);
export const fullPhone = suffix => `09${normalizePhoneSuffix(suffix)}`;
export const normalizeEmail = raw => String(raw ?? '').trim().toLowerCase();
export const normalizeName = raw => String(raw ?? '').trim().replace(/\s+/gu, ' ');

export function validatePhoneSuffix(raw) {
  return /^\d{8}$/.test(normalizePhoneSuffix(raw)) ? null : '請輸入手機號碼後 8 碼';
}

export function validateEmail(raw) {
  const value = String(raw ?? '').trim();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '請輸入有效的 E-mail';
  return null;
}

export function validateName(raw) {
  const value = normalizeName(raw);
  if ([...value].length < 2 || [...value].length > 50) return '姓名需為 2 至 50 個字元';
  if (!/^[\p{L}\p{M} .·・'’-]+$/u.test(value)) return '姓名包含不支援的字元';
  return null;
}
```

- [ ] **Step 3: Run unit tests and commit**

Run: `npm test`  
Expected: 3 tests pass.

```powershell
git add web/assets/js/domain.js tests/unit/domain.test.mjs
git commit -m "feat: add check-in input validation"
```

---

### Task 3: Implement the Bridge client and virtual waiting room policy

**Files:**
- Create: `web/assets/js/bridge-client.js`
- Create: `web/assets/js/retry.js`
- Create: `tests/unit/bridge-client.test.mjs`
- Create: `tests/unit/retry.test.mjs`

**Interfaces:**
- Consumes: A verified Bridge iframe `contentWindow`, exact Bridge origin, action name, and payload.
- Produces: `BridgeClient.request(action, payload, requestId): Promise<ApiResponse>` and `runWithWaitingRoom(operation, hooks, options): Promise<ApiResponse>`.

- [ ] **Step 1: Write the failing Bridge correlation and origin tests**

```js
// tests/unit/bridge-client.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeClient } from '../../web/assets/js/bridge-client.js';

class FakeEvents {
  constructor(){ this.listeners = new Set(); }
  addEventListener(_type, fn){ this.listeners.add(fn); }
  removeEventListener(_type, fn){ this.listeners.delete(fn); }
  emit(event){ for (const fn of this.listeners) fn(event); }
}

test('resolves only a response from the configured origin and source', async () => {
  const events = new FakeEvents();
  const sent = [];
  const target = { postMessage: (body, origin) => sent.push({ body, origin }) };
  const client = new BridgeClient({ targetWindow: target, targetOrigin: 'https://script.google.com', eventSource: events, timeoutMs: 100 });
  const pending = client.request('healthCheck', {}, 'req-1');
  events.emit({ origin: 'https://evil.example', source: target, data: { requestId: 'req-1', ok: true } });
  events.emit({ origin: 'https://script.google.com', source: target, data: { version: 1, requestId: 'req-1', ok: true, code: 'OK', data: {} } });
  assert.equal((await pending).code, 'OK');
  assert.equal(sent[0].origin, 'https://script.google.com');
  client.destroy();
});
```

Run: `npm test`  
Expected: FAIL because `BridgeClient` does not exist.

- [ ] **Step 2: Implement the versioned Bridge client**

```js
// web/assets/js/bridge-client.js
export class BridgeClient {
  constructor({ targetWindow, targetOrigin, eventSource = window, timeoutMs = 12000 }) {
    if (!targetWindow || !targetOrigin) throw new Error('Bridge target is required');
    this.targetWindow = targetWindow;
    this.targetOrigin = targetOrigin;
    this.eventSource = eventSource;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.onMessage = this.onMessage.bind(this);
    eventSource.addEventListener('message', this.onMessage);
  }
  request(action, payload, requestId = crypto.randomUUID()) {
    if (this.pending.has(requestId)) return this.pending.get(requestId).promise;
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    const timer = setTimeout(() => {
      this.pending.delete(requestId);
      reject(Object.assign(new Error('Bridge timeout'), { code: 'NETWORK_RETRYABLE' }));
    }, this.timeoutMs);
    this.pending.set(requestId, { promise, resolve, reject, timer });
    this.targetWindow.postMessage({ version: 1, requestId, action, payload }, this.targetOrigin);
    return promise;
  }
  onMessage(event) {
    if (event.origin !== this.targetOrigin || event.source !== this.targetWindow) return;
    const message = event.data;
    if (!message || message.version !== 1 || typeof message.requestId !== 'string') return;
    const item = this.pending.get(message.requestId);
    if (!item) return;
    clearTimeout(item.timer);
    this.pending.delete(message.requestId);
    item.resolve(message);
  }
  destroy() {
    this.eventSource.removeEventListener('message', this.onMessage);
    for (const item of this.pending.values()) clearTimeout(item.timer);
    this.pending.clear();
  }
}
```

- [ ] **Step 3: Write failing retry-policy tests**

```js
// tests/unit/retry.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithWaitingRoom } from '../../web/assets/js/retry.js';

test('retries BUSY with one request id and stops on success', async () => {
  const calls = [];
  const waits = [];
  const operation = async requestId => {
    calls.push(requestId);
    return calls.length < 3 ? { ok:false, code:'BUSY' } : { ok:true, code:'CHECKED_IN' };
  };
  const result = await runWithWaitingRoom(operation, { onWait: ms => waits.push(ms) }, { delays:[2,4], jitter:() => 0, sleep: async()=>{} });
  assert.equal(result.code, 'CHECKED_IN');
  assert.equal(new Set(calls).size, 1);
  assert.deepEqual(waits, [2000, 4000]);
});
```

Run: `npm test`  
Expected: FAIL because `runWithWaitingRoom` does not exist.

- [ ] **Step 4: Implement bounded exponential retry with jitter**

```js
// web/assets/js/retry.js
const RETRYABLE = new Set(['BUSY', 'NETWORK_RETRYABLE']);

export async function runWithWaitingRoom(operation, hooks = {}, options = {}) {
  const delays = options.delays ?? [2, 4, 8, 12, 16];
  const jitter = options.jitter ?? Math.random;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const requestId = options.requestId ?? crypto.randomUUID();
  let elapsed = 0;
  for (let attempt = 0; ; attempt += 1) {
    let result;
    try { result = await operation(requestId); }
    catch (error) { result = { ok:false, code:error.code ?? 'NETWORK_RETRYABLE' }; }
    if (!RETRYABLE.has(result.code)) return result;
    if (attempt >= delays.length) return result;
    const waitMs = Math.round(delays[attempt] * 1000 + jitter() * 750);
    if (elapsed + waitMs > 60000) return result;
    elapsed += waitMs;
    hooks.onWait?.(waitMs, attempt + 1);
    await sleep(waitMs);
  }
}
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test`  
Expected: Bridge and retry tests pass; no timer remains open.

```powershell
git add web/assets/js/bridge-client.js web/assets/js/retry.js tests/unit/bridge-client.test.mjs tests/unit/retry.test.mjs
git commit -m "feat: add bridge client and waiting room"
```

---

### Task 4: Build the complete accessible browser flow

**Files:**
- Modify: `web/index.html`
- Modify: `web/assets/css/app.css`
- Modify: `web/assets/js/app.js`
- Create: `web/assets/js/config.js`
- Modify: `tests/e2e/checkin.spec.mjs`

**Interfaces:**
- Consumes: Domain helpers, `BridgeClient`, `runWithWaitingRoom`, and API response codes.
- Produces: The complete screen controller for `home`, `phone`, `email`, `confirm`, `walkIn`, `waiting`, `success`, `already`, `conflict`, and `error` states.

- [ ] **Step 1: Add a deterministic fake Bridge to the E2E page and write failing flow tests**

Append these tests to `tests/e2e/checkin.spec.mjs`; the app must accept `window.__CHECKIN_TEST_API__` only when the URL host is `127.0.0.1` or `localhost`:

```js
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const replies = [];
    window.__CHECKIN_TEST_API__ = {
      setReplies(values){ replies.splice(0, replies.length, ...values); },
      async request(){ return replies.shift() ?? { version:1, ok:false, code:'SYSTEM_ERROR', data:{} }; }
    };
  });
});

test('phone miss falls back to email then shows masked confirmation', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.__CHECKIN_TEST_API__.setReplies([
    {version:1,ok:false,code:'NOT_FOUND',data:{}},
    {version:1,ok:true,code:'FOUND',data:{maskedName:'林○宇',token:'opaque'}},
    {version:1,ok:true,code:'CHECKED_IN',data:{checkedInAt:'2026/08/03 13:45'}}
  ]));
  await page.getByRole('button', { name:'我有事先報名' }).click();
  await page.getByLabel('手機號碼後 8 碼').fill('12345678');
  await page.getByRole('button', { name:'查詢報名資料' }).click();
  await page.getByLabel('E-mail').fill('guest@example.com');
  await page.getByRole('button', { name:'使用 E-mail 查詢' }).click();
  await expect(page.getByText('林○宇')).toBeVisible();
  await page.getByRole('button', { name:'確認報到' }).click();
  await expect(page.getByRole('heading', { name:'報到成功' })).toBeVisible();
});

test('busy response enters waiting room and preserves one submission', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.__CHECKIN_TEST_API__.setReplies([
    {version:1,ok:false,code:'BUSY',data:{}},
    {version:1,ok:true,code:'ALREADY_CHECKED_IN',data:{checkedInAt:'2026/08/03 13:40'}}
  ]));
  await page.getByRole('button', { name:'我有事先報名' }).click();
  await page.getByLabel('手機號碼後 8 碼').fill('12345678');
  await page.getByRole('button', { name:'查詢報名資料' }).click();
  await expect(page.getByText('目前報到人數較多')).toBeVisible();
});
```

Run: `npm run test:e2e`  
Expected: FAIL because the buttons do not change screens.

- [ ] **Step 2: Add generated deployment configuration with a closed release gate**

```js
// web/assets/js/config.js
export const APP_CONFIG = Object.freeze({
  bridgeUrl: '',
  bridgeOrigin: 'https://script.googleusercontent.com',
  walkInEnabled: false,
  privacyNoticeApproved: false
});
```

The empty URL is an intentional fail-closed default. Task 9 replaces it through the deployment script after observing the deployed Web App URL.

- [ ] **Step 3: Implement screen rendering and event bindings**

Use one controller state object and text-only template functions. The implementation in `web/assets/js/app.js` must include these exact public boundaries:

```js
import { APP_CONFIG } from './config.js';
import { BridgeClient } from './bridge-client.js';
import { runWithWaitingRoom } from './retry.js';
import { fullPhone, normalizeEmail, normalizeName, normalizePhoneSuffix, validateEmail, validateName, validatePhoneSuffix } from './domain.js';

const state = { screen:'home', phoneSuffix:'', email:'', name:'', token:'', maskedName:'', checkedInAt:'', lastAction:null };
const host = document.querySelector('#screen-host');
const home = document.querySelector('[data-screen="home"]');
const status = document.querySelector('#status');
const localTest = ['127.0.0.1','localhost'].includes(location.hostname) ? window.__CHECKIN_TEST_API__ : null;

function announce(text){ status.textContent = ''; requestAnimationFrame(() => { status.textContent = text; }); }
function escapeHtml(value){const node=document.createElement('span');node.textContent=String(value??'');return node.innerHTML;}
function show(screen, html){ state.screen = screen; home.hidden = true; host.hidden = false; host.dataset.screen = screen; host.innerHTML = html; host.querySelector('h2,[data-focus]')?.focus(); }
function fieldError(id, message){ const node=document.querySelector(`#${id}-error`); if(node) node.textContent=message ?? ''; const input=document.querySelector(`#${id}`); input?.setAttribute('aria-invalid', String(Boolean(message))); if(message) input?.focus(); }
function phoneMarkup(){ return `<h2 tabindex="-1">查詢報名資料</h2><form id="phone-form" novalidate><label for="phone">手機號碼後 8 碼</label><div class="phone-field"><span>09</span><input id="phone" name="phone" type="text" inputmode="numeric" autocomplete="tel-national" maxlength="8" value="${escapeHtml(state.phoneSuffix)}" aria-describedby="phone-error"></div><p id="phone-error" class="field-error"></p><button class="button button--primary" type="submit">查詢報名資料</button><button class="button button--text" type="button" data-home>返回</button></form>`; }
function emailMarkup(){ return `<h2 tabindex="-1">改用 E-mail 查詢</h2><p>手機查無報名資料，請輸入報名時使用的 E-mail。</p><form id="email-form" novalidate><label for="email">E-mail</label><input id="email" type="email" inputmode="email" autocomplete="email" maxlength="254" value="${escapeHtml(state.email)}" aria-describedby="email-error"><p id="email-error" class="field-error"></p><button class="button button--primary" type="submit">使用 E-mail 查詢</button><button class="button button--text" type="button" data-home>返回</button></form>`; }
function confirmMarkup(){ return `<h2 tabindex="-1">確認報到資料</h2><p>請確認以下姓名是否為本人：</p><p class="masked-name">${escapeHtml(state.maskedName)}</p><button id="confirm" class="button button--primary" type="button">確認報到</button><button class="button button--text" type="button" data-home>不是本人，重新查詢</button>`; }
function walkInMarkup(){ return `<h2 tabindex="-1">現場報名</h2><form id="walk-in-form" novalidate><label for="name">姓名</label><input id="name" autocomplete="name" maxlength="50" value="${escapeHtml(state.name)}"><p id="name-error" class="field-error"></p><label for="walk-phone">手機號碼後 8 碼</label><div class="phone-field"><span>09</span><input id="walk-phone" type="text" inputmode="numeric" autocomplete="tel-national" maxlength="8" value="${escapeHtml(state.phoneSuffix)}"></div><p id="walk-phone-error" class="field-error"></p><label for="walk-email">E-mail</label><input id="walk-email" type="email" inputmode="email" autocomplete="email" maxlength="254" value="${escapeHtml(state.email)}"><p id="walk-email-error" class="field-error"></p><details><summary>個人資料蒐集告知</summary><div id="privacy-notice"></div></details><label class="consent"><input id="privacy-consent" type="checkbox">我已閱讀並同意個人資料蒐集告知</label><p id="privacy-consent-error" class="field-error"></p><button class="button button--primary" type="submit">完成現場報名與報到</button></form>`; }

async function call(action, payload) {
  const api = localTest ?? await createBridgeClient();
  state.lastAction = { action, payload };
  return runWithWaitingRoom(requestId => api.request(action, payload, requestId), { onWait: ms => show('waiting', `<h2 tabindex="-1">目前報到人數較多</h2><p>系統正在為您安排報到，請勿關閉頁面。</p><p>約 ${Math.ceil(ms/1000)} 秒後自動重試</p>`) });
}

function handleResponse(response) {
  if (response.code === 'NOT_FOUND') return state.lastAction?.action === 'lookupByPhone' ? show('email', emailMarkup()) : beginWalkIn();
  if (response.code === 'FOUND') { state.maskedName=response.data.maskedName; state.token=response.data.token; return show('confirm', confirmMarkup()); }
  if (response.code === 'ALREADY_CHECKED_IN') return show('already', `<h2 tabindex="-1">您已完成報到</h2><p>第一次報到時間：${escapeHtml(response.data.checkedInAt)}</p>`);
  if (response.code === 'CHECKED_IN') return show('success', `<h2 tabindex="-1">報到成功</h2><p>報到時間：${escapeHtml(response.data.checkedInAt)}</p>`);
  if (response.code === 'WALK_IN_REGISTERED') return show('success', '<h2 tabindex="-1">現場登記與報到已完成</h2><p>感謝您的參與。</p>');
  if (response.code === 'DATA_CONFLICT') return show('conflict', '<h2 tabindex="-1">資料需要確認</h2><p>請洽現場工作人員協助。</p>');
  if (response.code === 'TOKEN_EXPIRED') return show(state.phoneSuffix ? 'phone' : 'email', state.phoneSuffix ? phoneMarkup() : emailMarkup());
  if (response.code === 'BUSY' || response.code === 'NETWORK_RETRYABLE') return show('error', '<h2 tabindex="-1">目前仍無法完成</h2><button id="retry" class="button button--primary">再次嘗試</button>');
  return show('error', `<h2 tabindex="-1">系統暫時無法使用</h2><p>請稍後再試。識別碼：${escapeHtml(response.requestId ?? '無')}</p>`);
}
```

Complete the same file with `createBridgeClient()`, `beginWalkIn()`, submit handlers, home/back handlers, and a `popstate` handler. `createBridgeClient()` must create one hidden iframe from `APP_CONFIG.bridgeUrl`, wait for `load`, use the exact configured `APP_CONFIG.bridgeOrigin` (`https://script.googleusercontent.com` for the redirected Apps Script HTML-service document), call `healthCheck`, and cache one `BridgeClient`. `beginWalkIn()` must refuse to render unless both release gates are true, except on localhost E2E where it may render for fake-data testing. Submit handlers must call:

```js
lookupByPhone: { phone: fullPhone(state.phoneSuffix) }
lookupByEmail: { email: normalizeEmail(state.email) }
confirmCheckIn: { token: state.token }
registerWalkIn: { name: normalizeName(state.name), phone: fullPhone(state.phoneSuffix), email: state.email.trim(), consent: true }
```

Use these concrete controller functions and bind each form after rendering:

```js
let bridgePromise;
function createBridgeClient(){
  if(bridgePromise)return bridgePromise;
  bridgePromise=new Promise((resolve,reject)=>{
    if(!APP_CONFIG.bridgeUrl)return reject(Object.assign(new Error('Bridge not configured'),{code:'SYSTEM_ERROR'}));
    const frame=document.createElement('iframe');
    frame.hidden=true;frame.title='報到系統安全連線';frame.src=APP_CONFIG.bridgeUrl;
    const timer=setTimeout(()=>reject(Object.assign(new Error('Bridge load timeout'),{code:'NETWORK_RETRYABLE'})),12000);
    frame.addEventListener('load',async()=>{clearTimeout(timer);try{const client=new BridgeClient({targetWindow:frame.contentWindow,targetOrigin:APP_CONFIG.bridgeOrigin});const health=await client.request('healthCheck',{});if(!health.ok)throw new Error('Bridge health check failed');resolve(client);}catch(error){reject(error);}},{once:true});
    document.body.append(frame);
  });
  return bridgePromise;
}

function beginWalkIn(){
  if(!localTest&&(!APP_CONFIG.walkInEnabled||!APP_CONFIG.privacyNoticeApproved))return show('error','<h2 tabindex="-1">現場報名尚未開放</h2><p>請洽現場工作人員。</p>');
  show('walkIn',walkInMarkup());bindWalkInForm();
}

function bindPhoneForm(){
  const form=document.querySelector('#phone-form');
  const input=document.querySelector('#phone');
  input.addEventListener('input',()=>{input.value=normalizePhoneSuffix(input.value);state.phoneSuffix=input.value;});
  form.addEventListener('submit',async event=>{event.preventDefault();const error=validatePhoneSuffix(input.value);fieldError('phone',error);if(error)return;handleResponse(await call('lookupByPhone',{phone:fullPhone(state.phoneSuffix)}));});
}

function bindEmailForm(){
  const form=document.querySelector('#email-form');const input=document.querySelector('#email');
  form.addEventListener('submit',async event=>{event.preventDefault();state.email=input.value.trim();const error=validateEmail(state.email);fieldError('email',error);if(error)return;handleResponse(await call('lookupByEmail',{email:normalizeEmail(state.email)}));});
}

function bindWalkInForm(){
  const form=document.querySelector('#walk-in-form');
  form.addEventListener('submit',async event=>{
    event.preventDefault();state.name=document.querySelector('#name').value;state.phoneSuffix=normalizePhoneSuffix(document.querySelector('#walk-phone').value);state.email=document.querySelector('#walk-email').value.trim();
    const errors={name:validateName(state.name),'walk-phone':validatePhoneSuffix(state.phoneSuffix),'walk-email':validateEmail(state.email),'privacy-consent':document.querySelector('#privacy-consent').checked?null:'請先閱讀並同意個人資料蒐集告知'};
    Object.entries(errors).forEach(([id,message])=>fieldError(id,message));const first=Object.values(errors).find(Boolean);if(first)return;
    handleResponse(await call('registerWalkIn',{name:normalizeName(state.name),phone:fullPhone(state.phoneSuffix),email:state.email,consent:true}));
  });
}

document.querySelector('#pre-registered').addEventListener('click',()=>{show('phone',phoneMarkup());bindPhoneForm();});
document.querySelector('#walk-in').addEventListener('click',beginWalkIn);
if(localTest||(APP_CONFIG.walkInEnabled&&APP_CONFIG.privacyNoticeApproved)){document.querySelector('#walk-in').disabled=false;document.querySelector('#walk-in-release-note').hidden=true;}
host.addEventListener('click',async event=>{if(event.target.closest('[data-home]')){location.reload();return;}if(event.target.closest('#confirm'))handleResponse(await call('confirmCheckIn',{token:state.token}));if(event.target.closest('#retry')&&state.lastAction)handleResponse(await call(state.lastAction.action,state.lastAction.payload));});
addEventListener('popstate',()=>{if(state.screen!=='home')location.reload();});
```

Never interpolate API-returned content with `innerHTML`. Set `maskedName`, `checkedInAt`, and request ID through `textContent` nodes or an HTML-escape helper. The static templates above interpolate only locally validated form values; escape those values before insertion.

- [ ] **Step 4: Finish production styles for forms and states**

Append to `web/assets/css/app.css`:

```css
.panel h2{margin-top:0;line-height:1.35}.panel label{display:block;margin-top:14px;font-weight:700}.panel input{width:100%;min-height:50px;margin-top:6px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:16px;color:var(--ink);background:#fff}.panel input:focus{outline:3px solid rgba(179,0,14,.2);border-color:var(--brand)}.panel input[aria-invalid="true"]{border-color:var(--danger)}.phone-field{display:grid;grid-template-columns:auto 1fr;align-items:center;margin-top:6px;border:1px solid var(--line);border-radius:10px;overflow:hidden}.phone-field span{padding:0 0 0 12px;font-weight:800}.phone-field input{margin:0;border:0}.field-error{min-height:1.5rem;margin:.2rem 0;color:var(--danger);font-size:.875rem}.button--text{border-color:transparent;background:transparent;color:var(--ink)}.masked-name{margin:24px 0;text-align:center;color:var(--brand);font-size:2rem;font-weight:800;letter-spacing:.16em}.consent{display:grid!important;grid-template-columns:24px 1fr;gap:8px;align-items:start}.consent input{width:20px;min-height:20px;margin:3px 0 0}.status-icon{width:56px;height:56px;margin:auto;color:var(--ok)}details{margin-top:18px;padding:12px;border:1px solid var(--line);border-radius:10px}summary{cursor:pointer;font-weight:700}
```

- [ ] **Step 5: Run unit and browser tests at all required widths**

Add a Playwright parameterized test for 320, 375, 390, 430, 768, and 1440 widths. Assert no horizontal overflow, every input has a visible label, phone inputs have `inputmode=numeric`, and the active heading receives focus after a screen change.

Run: `npm run verify`  
Expected: all unit tests and browser flows pass.

- [ ] **Step 6: Commit**

```powershell
git add web tests/e2e/checkin.spec.mjs
git commit -m "feat: build accessible mobile check-in flow"
```

---

### Task 5: Implement and test Apps Script domain rules

**Files:**
- Create: `appsscript.json`
- Create: `apps-script/Config.gs`
- Create: `apps-script/Domain.gs`
- Create: `scripts/load-gas.mjs`
- Create: `tests/unit/gas-domain.test.mjs`

**Interfaces:**
- Consumes: Raw Sheet and request values.
- Produces: `normalizePhone_`, `normalizeEmail_`, `normalizeName_`, `maskName_`, `sha256_`, `validatePhone_`, `validateEmail_`, and `validateName_` globals for repository and API files.

- [ ] **Step 1: Create the Apps Script manifest and test VM loader**

```json
{
  "timeZone": "Asia/Taipei",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
}
```

```js
// scripts/load-gas.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export function loadGas(files, globals = {}) {
  const context = vm.createContext({ console, ...globals });
  for (const file of files) {
    const source = fs.readFileSync(path.resolve('apps-script', file), 'utf8');
    vm.runInContext(source, context, { filename:file });
  }
  return context;
}
```

- [ ] **Step 2: Write failing parity tests for the server rules**

```js
// tests/unit/gas-domain.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from '../../scripts/load-gas.mjs';

const Utilities = {
  DigestAlgorithm:{SHA_256:'SHA_256'},
  Charset:{UTF_8:'UTF_8'},
  computeDigest:(_a, value) => [...new TextEncoder().encode(value)].slice(0,32)
};
const gas = loadGas(['Config.gs','Domain.gs'], { Utilities });

test('server normalizes phone and masks names without leaking inner characters', () => {
  assert.equal(gas.normalizePhone_('09-1234-5678'), '0912345678');
  assert.equal(gas.maskName_('林小宇'), '林○宇');
  assert.equal(gas.maskName_('歐陽文明'), '歐○○明');
});

test('server rejects malformed values', () => {
  assert.equal(gas.validatePhone_('0912345678'), '');
  assert.notEqual(gas.validateEmail_('bad@'), '');
  assert.notEqual(gas.validateName_('<王>'), '');
});
```

Run: `npm test`  
Expected: FAIL because Apps Script files do not exist.

- [ ] **Step 3: Implement constants and pure domain functions**

```js
// apps-script/Config.gs
var CHECKIN = Object.freeze({
  VERSION:1,
  SHEET_ID:'179uW_qocdZQ8H-yZNYz3_IhNEyviKWCkBDnrnHZQkQU',
  SHEET_NAME:'工作表1',
  HEADERS:['姓名','手機','E-mail','報名類型','報到狀態','報到時間','資料建立時間'],
  TIME_ZONE:'Asia/Taipei',
  TOKEN_TTL_SECONDS:300,
  INDEX_TTL_SECONDS:900,
  LOCK_WAIT_MS:1200,
  MAX_ROWS:1000,
  CODES:Object.freeze({FOUND:'FOUND',NOT_FOUND:'NOT_FOUND',ALREADY_CHECKED_IN:'ALREADY_CHECKED_IN',CHECKED_IN:'CHECKED_IN',WALK_IN_REGISTERED:'WALK_IN_REGISTERED',DATA_CONFLICT:'DATA_CONFLICT',TOKEN_EXPIRED:'TOKEN_EXPIRED',BUSY:'BUSY',INVALID_INPUT:'INVALID_INPUT',FORBIDDEN_ORIGIN:'FORBIDDEN_ORIGIN',SYSTEM_ERROR:'SYSTEM_ERROR'})
});
```

```js
// apps-script/Domain.gs
function normalizePhone_(value){ return String(value == null ? '' : value).replace(/\D/g,''); }
function normalizeEmail_(value){ return String(value == null ? '' : value).trim().toLowerCase(); }
function normalizeName_(value){ return String(value == null ? '' : value).trim().replace(/\s+/g,' '); }
function validatePhone_(value){ return /^09\d{8}$/.test(normalizePhone_(value)) ? '' : '手機格式錯誤'; }
function validateEmail_(value){ var v=String(value==null?'':value).trim(); return v.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : 'E-mail 格式錯誤'; }
function validateName_(value){ var v=normalizeName_(value); if(Array.from(v).length<2||Array.from(v).length>50) return '姓名長度錯誤'; return /^[\p{L}\p{M} .·・'’-]+$/u.test(v) ? '' : '姓名字元錯誤'; }
function maskName_(value){ var chars=Array.from(normalizeName_(value)); if(chars.length<=1)return '○'; if(chars.length===2)return chars[0]+'○'; return chars[0]+'○'.repeat(chars.length-2)+chars[chars.length-1]; }
function sha256_(value){ var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value),Utilities.Charset.UTF_8); return bytes.map(function(b){return ('0'+((b<0?b+256:b).toString(16))).slice(-2);}).join(''); }
function formatTaipei_(value){ return Utilities.formatDate(new Date(value),CHECKIN.TIME_ZONE,'yyyy/MM/dd HH:mm'); }
```

- [ ] **Step 4: Run tests and commit**

Run: `npm test`  
Expected: all server domain tests pass.

```powershell
git add appsscript.json apps-script/Config.gs apps-script/Domain.gs scripts/load-gas.mjs tests/unit/gas-domain.test.mjs
git commit -m "feat: add Apps Script domain rules"
```

---

### Task 6: Implement Sheet repository, conflict detection, cache indexes, and locked writes

**Files:**
- Create: `apps-script/Index.gs`
- Create: `apps-script/Repository.gs`
- Create: `tests/fixtures/fake-attendees.mjs`
- Create: `tests/unit/gas-repository.test.mjs`

**Interfaces:**
- Consumes: `CHECKIN`, normalization/hash helpers, and mocked or real `SpreadsheetApp`, `CacheService`, and `LockService`.
- Produces: `lookupByPhone_`, `lookupByEmail_`, `resolveWalkInIdentity_`, `confirmRow_`, `registerWalkIn_`, `rebuildIndexes_`, `invalidateIndexes_`, and `validateSheetShape_`.

- [ ] **Step 1: Define fake attendee data and failing repository tests**

```js
// tests/fixtures/fake-attendees.mjs
export const rows = [
  ['姓名','手機','E-mail','報名類型','報到狀態','報到時間','資料建立時間'],
  ['林小宇','0912345678','lin@example.com','預先報名','','',''],
  ['王大明','0987654321','wang@example.com','預先報名','已報到',new Date('2026-08-03T05:40:00Z'),'']
];
```

Repository tests must use an in-memory sheet mock and assert all of these cases:

```js
test('finds one row by normalized phone', () => assert.deepEqual([...gas.lookupByPhone_('09-1234-5678')], [2]));
test('reports duplicate phone rows as a conflict', () => assert.equal(gas.classifyRows_([2,3]).kind, 'conflict'));
test('preserves first check-in time on repeated confirmation', () => assert.equal(gas.confirmRow_(3).code, 'ALREADY_CHECKED_IN'));
test('phone and email that point to different rows are a conflict', () => assert.equal(gas.resolveWalkInIdentity_('0912345678','wang@example.com').kind, 'conflict'));
test('two identical walk-in calls append only one row', () => { const input={name:'陳來賓',phone:'0922334455',email:'walkin@example.com'}; gas.registerWalkIn_(input); gas.registerWalkIn_(input); assert.equal(sheetRows.length, 4); });
```

Run: `npm test`  
Expected: FAIL because repository globals do not exist.

- [ ] **Step 2: Implement a hashed, sharded cache index**

`apps-script/Index.gs` must use the first two hexadecimal characters of `sha256_(kind + ':' + normalizedValue)` as the shard ID. Each shard contains a JSON object from full hash to an array of 1-based row numbers. Every key includes a generation value so invalidation makes all older shards unreachable. Implement these exact boundaries:

```js
function getIndexGeneration_(){var cache=CacheService.getScriptCache();var value=cache.get('idx:generation');if(value===null){value=Utilities.getUuid();cache.put('idx:generation',value,CHECKIN.INDEX_TTL_SECONDS);}return value;}
function indexKey_(kind,normalized,generation){var hash=sha256_(kind+':'+normalized);return {hash:hash,cacheKey:'idx:'+generation+':'+kind+':'+hash.slice(0,2)};}
function getIndexedRows_(kind,normalized){var generation=getIndexGeneration_();var key=indexKey_(kind,normalized,generation);var raw=CacheService.getScriptCache().get(key.cacheKey);if(raw===null){rebuildIndexes_(generation);raw=CacheService.getScriptCache().get(key.cacheKey);}var shard=raw?JSON.parse(raw):{};return shard[key.hash]||[];}
function invalidateIndexes_(){CacheService.getScriptCache().put('idx:generation',Utilities.getUuid(),CHECKIN.INDEX_TTL_SECONDS);}
```

`rebuildIndexes_(generation)` reads A2:C only through the last data row, builds phone and E-mail shards under the supplied current generation, checks every serialized shard is below 95,000 UTF-8 bytes, and writes all shards with `putAll(..., CHECKIN.INDEX_TTL_SECONDS)`. If a shard exceeds the guard, throw `INDEX_SHARD_TOO_LARGE` rather than truncating it.

- [ ] **Step 3: Implement repository reads and conflict classification**

`apps-script/Repository.gs` must open the configured sheet, verify the seven exact headers before every write, and expose these return shapes:

```js
lookupByPhone_(phone) -> number[]
lookupByEmail_(email) -> number[]
classifyRows_(rows) -> {kind:'none'|'one'|'conflict', row?:number}
resolveWalkInIdentity_(phone,email) -> {kind:'none'|'one'|'conflict', row?:number}
readAttendee_(row) -> {row,name,phone,email,registrationType,status,checkedInAt,createdAt}
```

`resolveWalkInIdentity_` returns `one` only if all matches collapse to one row. It returns `conflict` when either identifier has multiple matches or their unique rows differ.

- [ ] **Step 4: Implement minimal locked write sections**

Use this exact lock pattern in both writes:

```js
var lock=LockService.getScriptLock();
if(!lock.tryLock(CHECKIN.LOCK_WAIT_MS)) return {code:CHECKIN.CODES.BUSY};
try {
  validateSheetShape_();
  // Re-read the row or identifiers here, then write only the required cells.
  SpreadsheetApp.flush();
} finally {
  lock.releaseLock();
}
```

`confirmRow_(row)` re-reads A:G, returns `ALREADY_CHECKED_IN` with the existing F value when E is already `已報到`, otherwise writes E=`已報到` and F=`new Date()` in one `setValues` call.

`registerWalkIn_(input)` re-runs `resolveWalkInIdentity_` inside the lock. A conflict returns `DATA_CONFLICT`; one existing row returns a lookup outcome without appending. No match appends `[name, phone, email, '現場報名', '已報到', now, now]`, flushes, then invalidates indexes.

- [ ] **Step 5: Run repository tests and commit**

Run: `npm test`  
Expected: all lookup, conflict, repeated check-in, and concurrent-walk-in simulations pass.

```powershell
git add apps-script/Index.gs apps-script/Repository.gs tests/fixtures/fake-attendees.mjs tests/unit/gas-repository.test.mjs
git commit -m "feat: add indexed and locked Sheet repository"
```

---

### Task 7: Implement sanitized API handlers and the origin-checked Bridge

**Files:**
- Create: `apps-script/Api.gs`
- Create: `apps-script/Bridge.html`
- Create: `apps-script/Code.gs`
- Create: `tests/unit/gas-api.test.mjs`

**Interfaces:**
- Consumes: Repository functions and Script Properties `ALLOWED_ORIGINS` plus `WALK_IN_ENABLED`.
- Produces: `apiHealthCheck`, `apiLookupByPhone`, `apiLookupByEmail`, `apiConfirmCheckIn`, `apiRegisterWalkIn`, and `doGet`.

- [ ] **Step 1: Write failing API privacy and token tests**

```js
test('lookup response contains a masked name and token but no raw identity', () => {
  const result=gas.apiLookupByPhone({version:1,requestId:'r1',payload:{phone:'0912345678'}});
  const text=JSON.stringify(result);
  assert.equal(result.code,'FOUND');
  assert.equal(result.data.maskedName,'林○宇');
  assert.ok(result.data.token);
  assert.equal(text.includes('0912345678'),false);
  assert.equal(text.includes('lin@example.com'),false);
  assert.equal('row' in result.data,false);
});

test('used or expired token cannot check in again', () => {
  const first=gas.apiConfirmCheckIn({version:1,requestId:'r2',payload:{token:'valid-token'}});
  const second=gas.apiConfirmCheckIn({version:1,requestId:'r3',payload:{token:'valid-token'}});
  assert.equal(first.code,'CHECKED_IN');
  assert.equal(second.code,'TOKEN_EXPIRED');
});
```

Run: `npm test`  
Expected: FAIL because the API functions do not exist.

- [ ] **Step 2: Implement fixed response envelopes and opaque tokens**

`apps-script/Api.gs` must create responses only through:

```js
function response_(requestId,ok,code,data){return {version:CHECKIN.VERSION,requestId:String(requestId||''),ok:Boolean(ok),code:code,data:data||{}};}
function issueToken_(row){var token=Utilities.getUuid()+Utilities.getUuid();CacheService.getScriptCache().put('token:'+sha256_(token),JSON.stringify({row:row,issuedAt:Date.now()}),CHECKIN.TOKEN_TTL_SECONDS);return token;}
function readToken_(token){var raw=CacheService.getScriptCache().get('token:'+sha256_(String(token||'')));if(raw===null)return null;var value=JSON.parse(raw);return Number.isInteger(value.row)&&value.row>=2?value:null;}
function removeToken_(token){CacheService.getScriptCache().remove('token:'+sha256_(String(token||'')));}
```

Lookup handlers validate input, classify rows, read the one attendee, and return only:

```js
{ maskedName: maskName_(attendee.name), token: issueToken_(row) }
```

or, for an existing check-in:

```js
{ checkedInAt: formatTaipei_(attendee.checkedInAt) }
```

The confirm handler calls `readToken_`, then attempts the locked write. It calls `removeToken_` only after `CHECKED_IN` or `ALREADY_CHECKED_IN`. A `BUSY` response leaves the same token valid so the waiting room can retry the identical payload. Concurrent replays remain safe because `confirmRow_` obtains the script lock and re-reads the status before writing. Do not log tokens.

- [ ] **Step 3: Implement the Bridge allowlist and dispatch table**

Create `apps-script/Bridge.html`:

```html
<!doctype html><html><head><base target="_top"><meta name="referrer" content="no-referrer"></head><body>
<script>
(() => {
  'use strict';
  const version=1;
  const allowed=Object.freeze(<?!= allowedOriginsJson ?>);
  const actions={healthCheck:'apiHealthCheck',lookupByPhone:'apiLookupByPhone',lookupByEmail:'apiLookupByEmail',confirmCheckIn:'apiConfirmCheckIn',registerWalkIn:'apiRegisterWalkIn'};
  addEventListener('message', event => {
    const message=event.data;
    if(!allowed.includes(event.origin)||!message||message.version!==version||typeof message.requestId!=='string'||!(message.action in actions)) return;
    const source=event.source;
    const origin=event.origin;
    const envelope={version,requestId:message.requestId,payload:message.payload||{}};
    google.script.run
      .withSuccessHandler(result => source.postMessage(result,origin))
      .withFailureHandler(() => source.postMessage({version,requestId:message.requestId,ok:false,code:'SYSTEM_ERROR',data:{}},origin))
      [actions[message.action]](envelope);
  });
  parent.postMessage({version,requestId:'bridge-ready',ok:true,code:'BRIDGE_READY',data:{}},'*');
})();
</script></body></html>
```

Create `apps-script/Code.gs` with these property helpers and `doGet()` implementation:

```js
function getAllowedOrigins_(){
  var raw=PropertiesService.getScriptProperties().getProperty('ALLOWED_ORIGINS')||'[]';
  var origins=JSON.parse(raw);
  if(!Array.isArray(origins))throw new Error('ALLOWED_ORIGINS_MUST_BE_ARRAY');
  origins.forEach(function(origin){if(!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin)&&!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin))throw new Error('INVALID_ALLOWED_ORIGIN');});
  return origins;
}
function isWalkInEnabled_(){return PropertiesService.getScriptProperties().getProperty('WALK_IN_ENABLED')==='true';}
function isPrivacyApproved_(){return PropertiesService.getScriptProperties().getProperty('PRIVACY_NOTICE_APPROVED')==='true';}
function doGet(){var template=HtmlService.createTemplateFromFile('Bridge');template.allowedOriginsJson=JSON.stringify(getAllowedOrigins_());return template.evaluate().setTitle('活動報到安全連線').addMetaTag('viewport','width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);}
```

The unescaped scriptlet is safe only because the server accepts strict origins and serializes them itself. `apiHealthCheck` returns only version, `walkInEnabled`, `privacyNoticeApproved`, and server time.

- [ ] **Step 4: Test API output allowlists and Bridge source text**

Add tests that scan every successful API response for the known fake full name, phone, E-mail, and `row` property. Add a source test that asserts `Bridge.html` contains `allowed.includes(event.origin)` and uses the observed `event.origin` as the `postMessage` target.

Run: `npm test`  
Expected: all API and Bridge tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps-script/Api.gs apps-script/Bridge.html apps-script/Code.gs tests/unit/gas-api.test.mjs
git commit -m "feat: add private check-in API bridge"
```

---

### Task 8: Add setup, deployment validation, privacy copy, and event-day operations

**Files:**
- Modify: `apps-script/Code.gs`
- Create: `docs/privacy-notice-draft.md`
- Create: `docs/operations/event-day-runbook.md`
- Create: `scripts/configure-deployment.mjs`
- Create: `tests/unit/configure-deployment.test.mjs`

**Interfaces:**
- Consumes: Observed Web App URL, observed GitHub Pages URL, organizer-approved privacy text, and the target Sheet.
- Produces: Safe configuration files, `initializeSheet()`, `validateDeployment()`, `warmIndexes()`, and a runbook with pass/fail checks.

- [ ] **Step 1: Write a failing deployment-config test**

```js
// tests/unit/configure-deployment.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConfig } from '../../scripts/configure-deployment.mjs';

test('writes an https bridge URL and derives exact origins', async () => {
  const output=renderConfig({bridgeUrl:'https://script.google.com/macros/s/abc/exec',pagesUrl:'https://owner.github.io/repo/'});
  assert.match(output.web,/bridgeUrl: "https:\/\/script\.google\.com\/macros\/s\/abc\/exec"/);
  assert.deepEqual(output.origins,['https://owner.github.io']);
});
test('rejects non-https production URLs', () => assert.throws(() => renderConfig({bridgeUrl:'http://example.com/x',pagesUrl:'https://owner.github.io/repo/'})));
```

Run: `npm test`  
Expected: FAIL because the deployment module does not exist.

- [ ] **Step 2: Implement deterministic deployment configuration**

`scripts/configure-deployment.mjs` must export `renderConfig({bridgeUrl,pagesUrl,walkInEnabled=false,privacyNoticeApproved=false})`, validate URLs, derive `new URL(pagesUrl).origin`, and write `web/assets/js/config.js` only when invoked with CLI arguments:

```js
// scripts/configure-deployment.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function renderConfig({bridgeUrl,pagesUrl,walkInEnabled=false,privacyNoticeApproved=false}) {
  const bridge=new URL(bridgeUrl);
  const pages=new URL(pagesUrl);
  if(bridge.protocol!=='https:'||pages.protocol!=='https:')throw new Error('Production URLs must use HTTPS');
  if(bridge.hostname!=='script.google.com'||!bridge.pathname.endsWith('/exec'))throw new Error('Bridge URL must be an observed Apps Script /exec URL');
  const web=`export const APP_CONFIG = Object.freeze({\n  bridgeUrl: ${JSON.stringify(bridge.href)},\n  bridgeOrigin: 'https://script.googleusercontent.com',\n  walkInEnabled: ${Boolean(walkInEnabled)},\n  privacyNoticeApproved: ${Boolean(privacyNoticeApproved)}\n});\n`;
  return {web,origins:[pages.origin]};
}

if(fileURLToPath(import.meta.url)===process.argv[1]){
  const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,list)=>index%2===0?[...pairs,[value,list[index+1]]]:pairs,[]));
  const output=renderConfig({bridgeUrl:args['--bridge-url'],pagesUrl:args['--pages-url'],walkInEnabled:args['--walk-in-enabled']==='true',privacyNoticeApproved:args['--privacy-approved']==='true'});
  fs.writeFileSync(new URL('../web/assets/js/config.js',import.meta.url),output.web,'utf8');
  console.log(JSON.stringify({allowedOrigins:output.origins}));
}
```

The CLI prints only the exact allowed origin needed for Script Properties; it never prints attendee data or credentials.

- [ ] **Step 3: Add Sheet initialization and deployment validation**

Add to `apps-script/Code.gs`:

```js
function initializeSheet(){var sheet=getSheet_();var current=sheet.getRange(1,1,1,CHECKIN.HEADERS.length).getDisplayValues()[0];if(current.every(function(v){return v==='';}))sheet.getRange(1,1,1,CHECKIN.HEADERS.length).setValues([CHECKIN.HEADERS]);validateSheetShape_();sheet.setFrozenRows(1);return {ok:true};}
function warmIndexes(){validateDeployment();rebuildIndexes_(getIndexGeneration_());return {ok:true};}
function validateDeployment(){var ss=SpreadsheetApp.openById(CHECKIN.SHEET_ID);if(ss.getSpreadsheetTimeZone()!==CHECKIN.TIME_ZONE)throw new Error('SHEET_TIME_ZONE_MUST_BE_ASIA_TAIPEI');if(Session.getScriptTimeZone()!==CHECKIN.TIME_ZONE)throw new Error('SCRIPT_TIME_ZONE_MUST_BE_ASIA_TAIPEI');validateSheetShape_();var origins=getAllowedOrigins_();if(!origins.length)throw new Error('ALLOWED_ORIGINS_REQUIRED');return {ok:true,rows:Math.max(0,getSheet_().getLastRow()-1),walkInEnabled:isWalkInEnabled_()};}
```

`initializeSheet()` may write only when row 1 is completely blank; otherwise it validates and stops on any mismatch.

- [ ] **Step 4: Write the privacy draft and event-day runbook**

`docs/privacy-notice-draft.md` must list all six Article 8 items, mark the organizer-owned decisions with a visible `主辦單位核准欄位` table, and state that the release gate remains false until legal/compliance approval supplies retention period, utilization recipients, rights contact, and approved wording.

`docs/operations/event-day-runbook.md` must contain exact checks and commands:

```powershell
npm ci
npm run verify
git status --short
```

It must also require: fake-data smoke test; exact header check; both time zones; duplicate phone/E-mail report; `validateDeployment()`; `warmIndexes()`; iPhone and Android QR test; Apps Script execution-dashboard monitoring; failover instruction to direct attendees to staffed manual check-in without exposing the Sheet publicly.

- [ ] **Step 5: Run tests and commit**

Run: `npm run verify`  
Expected: unit and E2E suites pass.

```powershell
git add apps-script/Code.gs scripts/configure-deployment.mjs tests/unit/configure-deployment.test.mjs docs/privacy-notice-draft.md docs/operations/event-day-runbook.md
git commit -m "docs: add safe deployment and event operations"
```

---

### Task 9: Deploy, configure the live origins, and verify the real system

**Files:**
- Modify: `web/assets/js/config.js`
- Modify: Apps Script project files through the Apps Script editor or `clasp` after project authorization
- Modify: Google Sheet `工作表1!A1:G`
- Modify: Script Properties `ALLOWED_ORIGINS`, `WALK_IN_ENABLED`, `PRIVACY_NOTICE_APPROVED`
- Test: real GitHub Pages URL, real Apps Script Web App URL, and the provided Google Sheet

**Interfaces:**
- Consumes: Approved privacy copy, approved logo if available, GitHub repository URL, and live deployment URLs observed from Google and GitHub.
- Produces: A public QR-ready GitHub Pages URL and a verified Apps Script Web App deployment.

- [ ] **Step 1: Run the complete local verification before external writes**

Run:

```powershell
npm ci
npm run verify
git status --short
```

Expected: all tests pass and the worktree is clean.

- [ ] **Step 2: Initialize and validate the real Sheet**

In Apps Script, deploy the code to the supplied project, run `initializeSheet()`, authorize the script, then read back `工作表1!A1:G3` through the Google Sheets connector. Expected headers:

```text
姓名 | 手機 | E-mail | 報名類型 | 報到狀態 | 報到時間 | 資料建立時間
```

Set both project and spreadsheet time zones to `Asia/Taipei`. Do not import the production attendee list until the schema and fake-data flows pass.

- [ ] **Step 3: Deploy the Apps Script Web App with fail-closed properties**

Set Script Properties:

```text
ALLOWED_ORIGINS=["http://127.0.0.1:4173"]
WALK_IN_ENABLED=false
PRIVACY_NOTICE_APPROVED=false
```

Deploy as the deploying user, accessible to anyone. Copy the observed `/exec` URL from the completed deployment; never infer it from the project ID.

- [ ] **Step 4: Create and publish the GitHub repository**

After the user names or approves the repository, add the remote, push `main`, enable Pages from the `web/` artifact or a Pages workflow, and wait for the GitHub Pages deployment to report success. Record the observed live URL.

Configure the two observed URLs:

```powershell
$bridge = Read-Host 'Paste the observed Apps Script /exec URL'
$pages = Read-Host 'Paste the observed GitHub Pages URL'
node scripts/configure-deployment.mjs --bridge-url $bridge --pages-url $pages
```

Update `ALLOWED_ORIGINS` to the exact `origin` printed by the script, redeploy the Apps Script Web App version, commit `web/assets/js/config.js`, and push.

- [ ] **Step 5: Perform fake-data live acceptance tests**

Using three fake attendees, verify in the deployed site:

1. Phone hit -> masked confirmation -> first check-in.
2. Phone miss -> E-mail hit -> masked confirmation.
3. Phone and E-mail miss -> walk-in remains disabled while approval flags are false.
4. Repeated check-in -> original time remains unchanged.
5. Duplicate identifier -> `DATA_CONFLICT` without exposed identity.
6. Non-allowed test origin -> Bridge request is ignored or returns no usable response.
7. Simulated `BUSY` -> waiting room appears and uses one request ID.

Read back the fake rows from Google Sheet and confirm there are no duplicate records and F-column times are real date values in Taipei time.

- [ ] **Step 6: Apply organizer approvals and open walk-in registration**

Only after the organizer supplies approved privacy copy, retention period, utilization recipients, rights contact, and any approved logo:

- Replace the privacy notice body in the page with the approved text.
- Set `PRIVACY_NOTICE_APPROVED=true` and `WALK_IN_ENABLED=true` in both Script Properties and generated frontend config.
- Add an automated test that asserts the approved notice headings render before enabling the button.
- Redeploy Apps Script and GitHub Pages.

If approval is not available, keep both flags false and operate pre-registration check-in only.

- [ ] **Step 7: Run measured concurrent-load verification with fake data**

Use a local load script that sends Bridge calls from browser contexts at controlled concurrency of 10, 20, then 30. Stop immediately if Google reports quota or service pressure. Measure success, `BUSY`, P95 response time, duplicate rows, and preserved first-check-in times. Acceptance requires zero duplicate rows and every retryable failure entering the waiting-room path. Do not claim a stable attendee capacity from this test because Apps Script quotas can change.

- [ ] **Step 8: Complete real-device and QR verification**

Create the QR Code from the observed GitHub Pages URL. On one iPhone Safari and one Android Chrome device, verify:

- QR opens the correct HTTPS URL.
- Phone field shows a numeric keyboard and accepts 8 digits only.
- E-mail field shows the E-mail keyboard.
- 320px layout has no horizontal scrolling.
- Screen headings receive focus and status updates are announced.
- Waiting-room copy and retry work after a temporary network interruption.
- Success refresh does not send a second write.

- [ ] **Step 9: Import the production list and run the final release gate**

Import only columns A:C, fill D with `預先報名`, leave E:G blank, then run duplicate-phone and duplicate-E-mail checks. Resolve every duplicate before `warmIndexes()`. Run `validateDeployment()` and one organizer-approved smoke check. Remove all fake rows, verify row count against the source list, and do not print attendee data in terminal or chat.

- [ ] **Step 10: Final commit and evidence record**

```powershell
npm run verify
git add web/assets/js/config.js docs
git commit -m "release: configure event check-in deployment"
git push origin main
```

Record in the runbook: commit SHA, Apps Script deployment version, GitHub Pages workflow URL, Sheet header verification, test counts, real-device results, and the organizer approval date. Do not record tokens, credentials, or attendee data.

---

## Plan Self-Review Result

- Spec coverage: all design sections map to Tasks 1 through 9, including Bridge security, privacy release gates, cache shards, locking, virtual waiting, accessibility, deployment, and event operations.
- Placeholder scan: the plan contains no deferred implementation marker. Runtime deployment values come from observed URLs through a deterministic script.
- Interface consistency: frontend action names match the Bridge dispatch names and Apps Script API globals; response codes match `CHECKIN.CODES`; sheet columns match the approved A:G schema.
- Scope: one end-to-end feature with independently reviewable tasks; each task ends in tests and a commit.
