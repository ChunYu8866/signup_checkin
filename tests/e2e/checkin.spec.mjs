import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const replies = [];
    const calls = [];
    window.__CHECKIN_TEST_API__ = {
      calls,
      setReplies(values) { replies.splice(0, replies.length, ...values); calls.length = 0; },
      async request(action, payload, requestId) {
        calls.push({ action, payload, requestId });
        return replies.shift() ?? { version: 1, ok: false, code: 'SYSTEM_ERROR', data: {} };
      },
    };
  });
});

async function setReplies(page, replies) {
  await page.evaluate(values => window.__CHECKIN_TEST_API__.setReplies(values), replies);
}

async function openPhoneLookup(page) {
  await page.getByRole('button', { name: '我有事先報名' }).click();
  await page.getByLabel('手機號碼後 8 碼').fill('12345678');
}

async function submitPhoneLookup(page) {
  await openPhoneLookup(page);
  await page.getByRole('button', { name: '查詢報名資料' }).click();
}

async function routeConfig(page, { walkInEnabled, privacyNoticeApproved }) {
  await page.route('**/assets/js/config.js', route => route.fulfill({
    contentType: 'text/javascript; charset=utf-8',
    body: `export const APP_CONFIG = Object.freeze({
      bridgeUrl: '',
      bridgeOrigin: 'https://script.googleusercontent.com',
      walkInEnabled: ${walkInEnabled},
      privacyNoticeApproved: ${privacyNoticeApproved}
    });`,
  }));
}

test('phone miss falls back to email then shows masked confirmation', async ({ page }) => {
  await page.goto('/');
  await setReplies(page, [
    { version: 1, ok: false, code: 'NOT_FOUND', data: {} },
    { version: 1, ok: true, code: 'FOUND', data: { maskedName: '林○宇', token: 'opaque' } },
    { version: 1, ok: true, code: 'CHECKED_IN', data: { checkedInAt: '2026/08/03 13:45' } },
  ]);
  await submitPhoneLookup(page);
  await page.getByLabel('E-mail').fill(' Guest@Example.COM ');
  await page.getByRole('button', { name: '使用 E-mail 查詢' }).click();
  await expect(page.getByText('林○宇')).toBeVisible();
  await page.getByRole('button', { name: '確認報到' }).click();
  await expect(page.getByRole('heading', { name: '報到成功' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__CHECKIN_TEST_API__.calls)).toEqual([
    expect.objectContaining({ action: 'lookupByPhone', payload: { phone: '0912345678' } }),
    expect.objectContaining({ action: 'lookupByEmail', payload: { email: 'guest@example.com' } }),
    expect.objectContaining({ action: 'confirmCheckIn', payload: { token: 'opaque' } }),
  ]);
});

test('busy response enters waiting room and retries one preserved submission', async ({ page }) => {
  await page.goto('/');
  await setReplies(page, [
    { version: 1, ok: false, code: 'BUSY', data: {} },
    { version: 1, ok: true, code: 'ALREADY_CHECKED_IN', data: { checkedInAt: '2026/08/03 13:40' } },
  ]);
  await submitPhoneLookup(page);
  await expect(page.getByRole('heading', { name: '目前報到人數較多' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '您已完成報到' })).toBeVisible({ timeout: 5_000 });
  const calls = await page.evaluate(() => window.__CHECKIN_TEST_API__.calls);
  expect(calls).toHaveLength(2);
  expect(calls[0].payload).toEqual({ phone: '0912345678' });
  expect(calls[1].payload).toEqual(calls[0].payload);
  expect(calls[1].requestId).toBe(calls[0].requestId);
});

test('retryable network response also enters the waiting room', async ({ page }) => {
  await page.goto('/');
  await setReplies(page, [
    { version: 1, ok: false, code: 'NETWORK_RETRYABLE', data: {} },
    { version: 1, ok: true, code: 'CHECKED_IN', data: { checkedInAt: '2026/08/03 13:45' } },
  ]);
  await submitPhoneLookup(page);
  await expect(page.getByRole('heading', { name: '目前報到人數較多' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '報到成功' })).toBeVisible({ timeout: 5_000 });
});

test('email miss opens validated walk-in flow and submits normalized values', async ({ page }) => {
  await page.goto('/');
  await setReplies(page, [
    { version: 1, ok: false, code: 'NOT_FOUND', data: {} },
    { version: 1, ok: false, code: 'NOT_FOUND', data: {} },
    { version: 1, ok: true, code: 'WALK_IN_REGISTERED', data: {} },
  ]);
  await submitPhoneLookup(page);
  await page.getByLabel('E-mail').fill('missing@example.com');
  await page.getByRole('button', { name: '使用 E-mail 查詢' }).click();
  await expect(page.getByRole('heading', { name: '現場報名' })).toBeFocused();

  await page.getByRole('button', { name: '完成現場報名與報到' }).click();
  await expect(page.locator('#name-error')).toHaveText('姓名需為 2 至 50 個字元');
  await expect(page.getByLabel('姓名')).toBeFocused();

  await page.getByLabel('姓名').fill('  林  小宇  ');
  await page.getByLabel('手機號碼後 8 碼').fill('98765432');
  await page.getByLabel('E-mail').fill(' WalkIn@Example.com ');
  await page.getByLabel('我已閱讀並同意個人資料蒐集告知').check();
  await page.getByRole('button', { name: '完成現場報名與報到' }).click();
  await expect(page.getByRole('heading', { name: '現場登記與報到已完成' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__CHECKIN_TEST_API__.calls.at(-1))).toEqual(expect.objectContaining({
    action: 'registerWalkIn',
    payload: { name: '林 小宇', phone: '0998765432', email: 'WalkIn@Example.com', consent: true },
  }));
});

test('token expiry preserves phone input and the rebound form can query again', async ({ page }) => {
  await page.goto('/');
  await setReplies(page, [
    { version: 1, ok: true, code: 'FOUND', data: { maskedName: '林○宇', token: 'expired' } },
    { version: 1, ok: false, code: 'TOKEN_EXPIRED', data: {} },
    { version: 1, ok: true, code: 'FOUND', data: { maskedName: '陳○華', token: 'fresh' } },
  ]);
  await submitPhoneLookup(page);
  await page.getByRole('button', { name: '確認報到' }).click();
  await expect(page.getByLabel('手機號碼後 8 碼')).toHaveValue('12345678');
  await page.getByRole('button', { name: '查詢報名資料' }).click();
  await expect(page.getByText('陳○華')).toBeVisible();
});

for (const { code, heading, data = {} } of [
  { code: 'ALREADY_CHECKED_IN', heading: '您已完成報到', data: { checkedInAt: '2026/08/03 13:40' } },
  { code: 'DATA_CONFLICT', heading: '資料需要確認' },
  { code: 'SYSTEM_ERROR', heading: '系統暫時無法使用' },
]) {
  test(`${code} renders its safe terminal state`, async ({ page }) => {
    await page.goto('/');
    await setReplies(page, [{
      version: 1,
      ok: false,
      code,
      requestId: '<img src=x onerror="window.__unsafe=true">',
      data,
    }]);
    await submitPhoneLookup(page);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    expect(await page.locator('#screen-host img').count()).toBe(0);
    expect(await page.evaluate(() => window.__unsafe)).toBeUndefined();
  });
}

test('INVALID_INPUT restores the preserved form and focuses its first field error', async ({ page }) => {
  await page.goto('/');
  await setReplies(page, [{ version: 1, ok: false, code: 'INVALID_INPUT', data: {} }]);
  await submitPhoneLookup(page);
  await expect(page.getByLabel('手機號碼後 8 碼')).toHaveValue('12345678');
  await expect(page.getByLabel('手機號碼後 8 碼')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('手機號碼後 8 碼')).toBeFocused();
});

test('FORBIDDEN_ORIGIN stops the flow with a configuration error', async ({ page }) => {
  await page.goto('/');
  await setReplies(page, [{ version: 1, ok: false, code: 'FORBIDDEN_ORIGIN', data: {} }]);
  await submitPhoneLookup(page);
  await expect(page.getByRole('heading', { name: '系統設定錯誤' })).toBeVisible();
});

test('API-returned name and time are rendered as text, never executable markup', async ({ page }) => {
  await page.goto('/');
  const payload = '<img src=x onerror="window.__unsafe=true">';
  await setReplies(page, [
    { version: 1, ok: true, code: 'FOUND', data: { maskedName: payload, token: 'safe' } },
    { version: 1, ok: true, code: 'CHECKED_IN', data: { checkedInAt: payload } },
  ]);
  await submitPhoneLookup(page);
  await expect(page.getByText(payload)).toBeVisible();
  await page.getByRole('button', { name: '確認報到' }).click();
  await expect(page.getByText(`報到時間：${payload}`)).toBeVisible();
  expect(await page.locator('#screen-host img').count()).toBe(0);
  expect(await page.evaluate(() => window.__unsafe)).toBeUndefined();
});

test('closed release gates and non-local host ignore the fake API', async ({ page }) => {
  await page.goto('http://127.0.0.2:4173/');
  await expect(page.getByRole('button', { name: '我要現場報名' })).toBeDisabled();
  expect(await page.evaluate(() => window.__CHECKIN_TEST_API__.calls)).toHaveLength(0);
});

for (const gates of [
  { walkInEnabled: true, privacyNoticeApproved: false },
  { walkInEnabled: false, privacyNoticeApproved: true },
]) {
  test(`walk-in stays closed unless both release gates pass: ${JSON.stringify(gates)}`, async ({ page }) => {
    await routeConfig(page, gates);
    await page.goto('http://127.0.0.2:4173/');
    await expect(page.getByRole('button', { name: '我要現場報名' })).toBeDisabled();
  });
}

test('walk-in opens on a non-local host only when both release gates pass', async ({ page }) => {
  await routeConfig(page, { walkInEnabled: true, privacyNoticeApproved: true });
  await page.goto('http://127.0.0.2:4173/');
  await page.getByRole('button', { name: '我要現場報名' }).click();
  await expect(page.getByRole('heading', { name: '現場報名' })).toBeFocused();
});

for (const width of [320, 375, 390, 430, 768, 1440]) {
  test(`has accessible labeled inputs without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '2026 下半年投資展望會' })).toBeVisible();
    await expect(page.getByText('2026/08/03 14:00')).toBeVisible();
    await expect(page.getByText('華南銀行國際會議中心')).toBeVisible();
    await expect(page.getByRole('button', { name: '我有事先報名' })).toBeVisible();
    await expect(page.getByRole('button', { name: '我要現場報名' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.getByRole('button', { name: '我有事先報名' }).click();
    await expect(page.getByRole('heading', { name: '查詢報名資料' })).toBeFocused();
    const phone = page.getByLabel('手機號碼後 8 碼');
    await expect(phone).toHaveAttribute('inputmode', 'numeric');
    await expect(phone).toHaveAccessibleName('手機號碼後 8 碼');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.locator('#status')).toContainText('查詢報名資料');

    await page.getByRole('button', { name: '返回' }).click();
    await page.getByRole('button', { name: '我要現場報名' }).click();
    for (const label of ['姓名', '手機號碼後 8 碼', 'E-mail', '我已閱讀並同意個人資料蒐集告知']) {
      const input = page.getByLabel(label);
      await expect(input).toBeVisible();
      await expect(input).toHaveAccessibleName(label);
    }
    await expect(page.getByLabel('手機號碼後 8 碼')).toHaveAttribute('inputmode', 'numeric');
    await expect(page.getByLabel('E-mail')).toHaveAttribute('inputmode', 'email');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
