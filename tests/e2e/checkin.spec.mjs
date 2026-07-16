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
