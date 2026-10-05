import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, shot } from './app';
import { makeWorldReadable } from '../unit/helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`pages render correctly (${theme})`, async () => {
    const l = await launch(theme);
    const { page } = l;
    try {
      await expect(page.locator('.fui-FluentProvider').first()).toHaveAttribute('data-theme', theme);

      // Keys: empty state
      await expect(page.getByTestId('empty-state').first()).toContainText('Chưa có key nào');
      await expect(page.getByTestId('agent-badge')).toBeVisible();
      await expect(page.getByTestId('status-bar')).toContainText('SANDBOX');
      await shot(page, `keys-empty-${theme}`);

      // Generate dialog via Ctrl+N
      await page.keyboard.press('ControlOrMeta+N');
      const dlg = page.getByTestId('generate-dialog');
      await expect(dlg).toBeVisible();
      await page.getByTestId('gen-label').fill('github');
      await expect(page.getByTestId('gen-filename')).toHaveValue('id_ed25519_github');
      await page.getByTestId('gen-pass').fill('correct horse battery 42');
      await page.getByTestId('gen-confirm').fill('correct horse battery 42');
      await expect(page.getByTestId('strength')).toBeVisible();
      await shot(page, `generate-${theme}`);

      await page.getByTestId('gen-submit').click();
      await expect(page.getByTestId('result-fingerprint')).toContainText('SHA256:', { timeout: 30_000 });
      // The passphrase must be gone from the DOM once submitted.
      expect(await page.content()).not.toContain('correct horse battery 42');
      await shot(page, `generate-result-${theme}`);
      await dlg.getByRole('button', { name: 'Xong' }).click();

      // Name validation: existing file is reported live
      await page.keyboard.press('ControlOrMeta+N');
      await page.getByTestId('gen-filename').fill('id_ed25519_github');
      await expect(dlg).toContainText('Đã có file');
      await page.getByTestId('gen-filename').fill('id_rsa_legacy');
      await page.getByTestId('type-rsa').click();
      await page.getByTestId('gen-submit').click();
      await expect(page.getByTestId('result-fingerprint')).toContainText('SHA256:', { timeout: 60_000 });
      await dlg.getByRole('button', { name: 'Xong' }).click();

      // Keys list + detail
      await page.getByTestId('key-row-id_ed25519_github').click();
      await expect(page.getByTestId('detail-randomart')).toContainText('[ED25519 256]');
      await expect(page.getByTestId('detail-public-key')).toHaveValue(/^ssh-ed25519 /);
      await shot(page, `keys-${theme}`);

      // Unsafe ACL banner, then fix all
      await makeWorldReadable(path.join(l.sshDir, 'id_rsa_legacy'));
      await page.keyboard.press('F5');
      await expect(page.getByTestId('unsafe-banner')).toContainText('1 key có quyền không an toàn');
      await expect(page.getByTestId('acl-warning')).toBeVisible();
      await shot(page, `keys-unsafe-${theme}`);
      await page.getByTestId('unsafe-banner').getByRole('button', { name: 'Sửa tất cả' }).click();
      await expect(page.getByTestId('unsafe-banner')).toHaveCount(0);

      // Delete with the native confirmation stubbed to "Xoá vĩnh viễn"
      await l.app.evaluate(({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });
      await page.getByTestId('key-row-id_rsa_legacy').click();
      await expect(page.getByTestId('key-detail')).toContainText('id_rsa_legacy');
      await page.getByTestId('delete-key').click();
      await expect(page.getByTestId('key-row-id_rsa_legacy')).toHaveCount(0);
      await expect(page.getByTestId('key-row-id_ed25519_github')).toHaveCount(1);

      // Settings
      await page.getByTestId('nav-settings').click();
      await expect(page.getByTestId('settings-sshdir')).toHaveValue(l.sshDir);
      await expect(page.getByTestId('real-dir-warning')).toHaveCount(0);
      // Auto-detected OpenSSH dir is shown as a real path, not as a placeholder.
      await expect(page.getByTestId('settings-bindir')).toHaveValue(process.platform === 'win32' ? /OpenSSH$/i : /\/bin$/);
      await shot(page, `settings-${theme}`);

      // Agent: this machine's service is Disabled, so Start must explain the admin requirement.
      await page.getByTestId('nav-agent').click();
      await expect(page.getByTestId('agent-state')).not.toHaveText('Không rõ');
      const state = await page.getByTestId('agent-state').textContent();
      if (state === 'Bị tắt' || state === 'Đã dừng') {
        await page.getByTestId('agent-start').click();
        if (state === 'Bị tắt' && process.platform === 'win32') await expect(page.getByTestId('agent-admin')).toContainText('sc.exe config ssh-agent start= auto');
        if (process.platform === 'darwin') await expect(page.getByTestId('agent-terminal')).toContainText('launchctl');
        await shot(page, `agent-${theme}`);
      } else if (state === 'Đang chạy') {
        // Add the passphrase-protected sandbox key through the GUI (askpass runs via electron.exe), then remove it.
        const fp = (await page.evaluate(() => window.skm.keys.detail('id_ed25519_github'))) as { ok: boolean; value?: { fingerprint: string } };
        const fingerprint = fp.value?.fingerprint ?? '';
        await page.getByTestId('agent-pick').click();
        await page.getByRole('option', { name: 'id_ed25519_github' }).click();
        await page.getByTestId('agent-add').click();
        const passDlg = page.getByTestId('agent-pass-dialog');
        await passDlg.locator('input[type="password"]').fill('wrong passphrase!');
        await passDlg.getByRole('button', { name: 'Thêm vào agent' }).click();
        await expect(passDlg.getByTestId('error-card')).toContainText('Passphrase');
        await passDlg.locator('input[type="password"]').fill('correct horse battery 42');
        await passDlg.getByRole('button', { name: 'Thêm vào agent' }).click();
        await expect(passDlg).toHaveCount(0);
        await expect(page.getByTestId(`agent-key-${fingerprint}`)).toBeVisible();
        await shot(page, `agent-${theme}`);
        await page.getByTestId(`agent-key-${fingerprint}`).getByRole('button', { name: 'Gỡ' }).click();
        await expect(page.getByTestId(`agent-key-${fingerprint}`)).toHaveCount(0);
      }

      // Generate -> "Tạo Host trong config" -> prefilled form -> diff -> write
      await page.getByTestId('nav-keys').click();
      await page.keyboard.press('ControlOrMeta+N');
      await page.getByTestId('gen-label').fill('work');
      await page.getByTestId('gen-submit').click();
      await expect(page.getByTestId('result-fingerprint')).toContainText('SHA256:', { timeout: 30_000 });
      await dlg.getByRole('button', { name: 'Tạo Host trong config' }).click();
      await expect(page.getByTestId('config-page')).toBeVisible();
      await expect(page.getByTestId('cfg-patterns')).toHaveValue('work');
      await expect(page.getByTestId('cfg-identity')).toContainText('id_ed25519_work');
      await page.getByTestId('cfg-hostname').fill('127.0.0.1');
      await page.getByTestId('cfg-user').fill('git');
      await page.getByTestId('cfg-port').fill('1'); // closed port: the test below gets "Connection refused" without leaving the machine
      await page.getByTestId('cfg-save').click();
      await expect(page.getByTestId('diff-dialog')).toContainText('HostName 127.0.0.1');
      await shot(page, `config-diff-${theme}`);
      await page.getByTestId('diff-confirm').click();
      await expect(page.getByTestId('diff-dialog')).toHaveCount(0);
      const written = await fs.readFile(path.join(l.sshDir, 'config'), 'utf8');
      expect(written).toContain('Host work\n    HostName 127.0.0.1\n    User git\n    Port 1\n');
      expect(written).toContain(`IdentityFile ${path.join(l.sshDir, 'id_ed25519_work').replace(/\\/g, '/')}`);

      // Second save of an existing file must leave a timestamped backup.
      await page.getByTestId('cfg-user').fill('deploy');
      await page.getByTestId('cfg-save').click();
      await page.getByTestId('diff-confirm').click();
      await expect(page.getByTestId('diff-dialog')).toHaveCount(0);
      const backups = (await fs.readdir(l.sshDir)).filter((f) => /^config\.\d{8}-\d{6}-\d{3}\.bak$/.test(f));
      expect(backups).toHaveLength(1);
      await shot(page, `config-${theme}`);
      await page.getByTestId('config-tab-raw').click();
      await expect(page.getByTestId('config-raw')).toHaveValue(/User deploy/);
      await shot(page, `config-raw-${theme}`);

      // Service presets fill the form; AWS ones explain what the user must fill in.
      await page.getByRole('tab', { name: 'Form' }).click();
      await page.getByTestId('config-add').click();
      await page.getByTestId('cfg-preset').click();
      await page.getByRole('option', { name: 'GitHub (port 443)' }).click();
      await expect(page.getByTestId('cfg-patterns')).toHaveValue('github.com');
      await expect(page.getByTestId('cfg-hostname')).toHaveValue('ssh.github.com');
      await expect(page.getByTestId('cfg-port')).toHaveValue('443');
      await page.getByTestId('cfg-preset').click();
      await page.getByRole('option', { name: 'AWS CodeCommit' }).click();
      await expect(page.getByTestId('cfg-hostname')).toHaveValue('');
      await expect(page.getByTestId('cfg-patterns')).toHaveValue('aws-codecommit');
      await expect(page.getByTestId('cfg-hostname')).toHaveAttribute('placeholder', /git-codecommit\..+\.amazonaws\.com/);
      await expect(page.getByTestId('cfg-preset-note')).toContainText('SSH Key ID');
      await shot(page, `config-preset-${theme}`);

      // Connection test against the closed local port
      await page.getByTestId('nav-test').click();
      await page.getByTestId('test-host').fill('work');
      await page.getByTestId('test-run').click();
      await expect(page.getByTestId('test-result')).toContainText('từ chối kết nối', { timeout: 20_000 });
      await expect(page.getByTestId('test-console')).toContainText('Connection refused');
      await shot(page, `test-${theme}`);

      // Theme switch from Settings updates the UI live
      await page.getByTestId('nav-settings').click();
      const other = theme === 'light' ? 'dark' : 'light';
      await page.getByTestId(`theme-${other}`).click();
      await expect(page.locator('.fui-FluentProvider').first()).toHaveAttribute('data-theme', other);
    } finally {
      await l.close();
    }
  });
}
