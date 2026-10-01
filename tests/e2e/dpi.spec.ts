import { expect, test } from '@playwright/test';
import { launch, shot } from './app';

// Minimum window size (1000x650) at 150% and 200% scaling: nothing may overflow horizontally.
for (const scale of [1.5, 2]) {
  test(`minimum window at ${scale * 100}% scaling has no horizontal overflow`, async () => {
    const l = await launch('light', { extraArgs: [`--force-device-scale-factor=${scale}`], window: { width: 1000, height: 650 } });
    try {
      const { page } = l;
      await page.keyboard.press('ControlOrMeta+N');
      await page.getByTestId('gen-label').fill('dpi');
      await page.getByTestId('gen-submit').click();
      await expect(page.getByTestId('result-fingerprint')).toContainText('SHA256:', { timeout: 30_000 });
      await page.getByRole('button', { name: 'Xong' }).click();
      await page.getByTestId('key-row-id_ed25519_dpi').click();
      await expect(page.getByTestId('detail-randomart')).toBeVisible();
      const nameCell = await page.getByTestId('key-row-id_ed25519_dpi').locator('td').first().boundingBox();
      expect(nameCell?.width ?? 0, 'name column collapsed').toBeGreaterThanOrEqual(110);

      const size = await l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getContentSize());
      expect(size?.[0]).toBeGreaterThanOrEqual(1000 - 20);
      for (const p of ['keys', 'settings'] as const) {
        await page.getByTestId(`nav-${p}`).click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${p} overflows horizontally`).toBeLessThanOrEqual(0);
        const statusVisible = await page.getByTestId('status-bar').isVisible();
        expect(statusVisible).toBe(true);
      }
      await page.getByTestId('nav-keys').click();
      await shot(page, `keys-min-${scale * 100}pct`);
    } finally {
      await l.close();
    }
  });
}
