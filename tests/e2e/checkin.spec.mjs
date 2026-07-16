import { test, expect } from '@playwright/test';

for (const width of [320, 1440]) {
  test(`shows event details and both entry paths at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '2026 下半年投資展望會' })).toBeVisible();
    await expect(page.getByText('2026/08/03 14:00')).toBeVisible();
    await expect(page.getByText('華南銀行國際會議中心')).toBeVisible();
    await expect(page.getByRole('button', { name: '我有事先報名' })).toBeVisible();
    await expect(page.getByRole('button', { name: '我要現場報名' })).toBeVisible();
    await expect(page.getByRole('button', { name: '我要現場報名' })).toBeDisabled();
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true);
  });
}
