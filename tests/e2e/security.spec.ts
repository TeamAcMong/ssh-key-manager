import { expect, test } from '@playwright/test';
import { launch, type Launched } from './app';

let l: Launched;
test.beforeAll(async () => {
  l = await launch('light');
});
test.afterAll(async () => {
  await l.close();
});

test('BrowserWindow uses hardened web preferences', async () => {
  const prefs = await l.app.evaluate(({ BrowserWindow }) => {
    // getLastWebPreferences exists at runtime but is missing from the Electron 44 typings.
    const wc = BrowserWindow.getAllWindows()[0]?.webContents as unknown as { getLastWebPreferences(): Electron.WebPreferences } | undefined;
    const p = wc?.getLastWebPreferences();
    return { contextIsolation: p?.contextIsolation, nodeIntegration: p?.nodeIntegration, sandbox: p?.sandbox, webSecurity: p?.webSecurity, webviewTag: p?.webviewTag };
  });
  expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false });
});

test('renderer has no Node access and only the narrow window.skm API', async () => {
  const r = await l.page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    skmKeys: Object.keys(window.skm).sort(),
    platform: window.skm.platform
  }));
  expect(r.require).toBe('undefined');
  expect(r.process).toBe('undefined');
  expect(r.skmKeys).toEqual(['agent', 'clipboard', 'config', 'env', 'keys', 'pathForFile', 'platform', 'settings', 'test']);
  // `platform` is a plain string (for shortcuts/wording), not a capability.
  expect(r.platform).toBe(process.platform);
});

test('strict CSP is present and enforced', async () => {
  const csp = await l.page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-eval');
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  // page.evaluate itself runs through CDP and bypasses CSP, so probe from inside the page:
  // an injected inline script must be refused and reported as a CSP violation.
  const r = await l.page.evaluate(
    () =>
      new Promise<{ ran: boolean; violation: string | null }>((resolve) => {
        let violation: string | null = null;
        document.addEventListener('securitypolicyviolation', (e) => (violation = e.violatedDirective), { once: true });
        const el = document.createElement('script');
        el.textContent = 'window.__cspProbe = true;';
        document.head.appendChild(el);
        setTimeout(() => resolve({ ran: (window as unknown as { __cspProbe?: boolean }).__cspProbe === true, violation }), 200);
      })
  );
  expect(r.ran).toBe(false);
  expect(r.violation).toMatch(/^script-src/);
});

test('new windows and navigation to remote URLs are blocked', async () => {
  const opened = await l.page.evaluate(() => window.open('https://example.com') === null);
  expect(opened).toBe(true);
  const before = l.page.url();
  await l.page.evaluate(() => {
    window.location.href = 'https://example.com';
  });
  await l.page.waitForTimeout(500);
  expect(l.page.url()).toBe(before);
  expect(await l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test('IPC rejects paths outside the SSH dir', async () => {
  const r = await l.page.evaluate(() => window.skm.keys.detail('..\\..\\Windows\\win.ini'));
  expect(r.ok).toBe(false);
});
