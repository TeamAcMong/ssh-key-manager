import { randomUUID } from 'node:crypto';
import { BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, type IpcMainInvokeEvent } from 'electron';
import type { Result } from '../core/types';
import { CH } from '../core/ipc';
import { SkmError, toErrorData } from '../core/errors/SkmError';
import { containsPrivateKeyMaterial } from '../core/security/redact';
import { validateNewKeyFileName } from '../core/security/PathGuard';
import { exists } from '../core/store/fsutil';
import { identityFileRef } from '../core/config/ConfigStore';
import type { AppServices } from './services';
import * as v from './validate';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>;

/**
 * Registers a handler that only answers our own renderer, never throws across IPC, and never
 * logs arguments. `secrets` extracts values that must be redacted from any error detail.
 */
function handle(channel: string, isTrusted: (e: IpcMainInvokeEvent) => boolean, fn: Handler, secrets?: (args: unknown[]) => string[]): void {
  ipcMain.handle(channel, async (event, ...args): Promise<Result<unknown>> => {
    if (!isTrusted(event)) {
      console.error(`[ipc] rejected ${channel} from untrusted frame`);
      return { ok: false, error: { code: 'INVALID_INPUT', messageVi: 'Yêu cầu không hợp lệ.' } };
    }
    try {
      return { ok: true, value: await fn(event, ...args) };
    } catch (err) {
      const extracted = secrets ? secrets(args).filter((s): s is string => typeof s === 'string') : [];
      const data = toErrorData(err, extracted);
      // Only the channel and error code are logged: never the payload.
      console.error(`[ipc] ${channel} failed: ${data.code}`);
      return { ok: false, error: data };
    }
  });
}

export function registerIpc(services: AppServices, isTrusted: (e: IpcMainInvokeEvent) => boolean, tmpDir: string): void {
  const h = (channel: string, fn: Handler, secrets?: (args: unknown[]) => string[]): void => handle(channel, isTrusted, fn, secrets);
  const s = services;

  h(CH.envInfo, async () => s.envInfo());
  h(CH.settingsGet, async () => s.settings);
  h(CH.settingsSet, async (_e, patch) => {
    const next = await s.updateSettings(v.settingsPatch(patch));
    nativeTheme.themeSource = next.theme;
    return next;
  });
  h(CH.settingsPickDir, async (e, kind) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const defaultPath = kind === 'bin' ? (s.settings.binDir ?? undefined) : s.settings.sshDir;
    const opts = { properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[], defaultPath };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  h(CH.keysList, async () => s.keys.list());
  h(CH.keysDetail, async (_e, id) => s.keys.detail(v.keyId(id)));
  h(CH.keysCheckName, async (_e, name) => {
    const n = v.str(name, 'tên file', 200);
    const err = validateNewKeyFileName(n);
    if (err) return err;
    const full = s.ctx.guard.resolveFile(n);
    if ((await exists(full)) || (await exists(`${full}.pub`))) return `Đã có file "${n}" (hoặc "${n}.pub") trong thư mục SSH.`;
    return null;
  });
  h(CH.keysGenerate, async (_e, req) => s.keys.generate(v.generateRequest(req)), (a) => [(a[0] as { passphrase?: string } | undefined)?.passphrase ?? '']);
  h(
    CH.keysChangePassphrase,
    async (_e, id, oldP, newP) => s.keys.changePassphrase(v.keyId(id), v.str(oldP, 'passphrase', 1024), v.str(newP, 'passphrase', 1024)),
    (a) => [a[1] as string, a[2] as string]
  );
  h(CH.keysRename, async (_e, id, newName) => s.keys.rename(v.keyId(id), v.str(newName, 'tên mới', 100)));
  h(CH.keysDelete, async (e, id) => {
    const key = v.keyId(id);
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      type: 'warning' as const,
      buttons: ['Xoá vĩnh viễn', 'Huỷ'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'Xác nhận xoá key',
      message: `Xoá key "${key}"?`,
      detail: 'File private key và public key (.pub) sẽ bị xoá vĩnh viễn khỏi thư mục SSH. Không thể hoàn tác.\nNhớ gỡ public key khỏi các máy chủ/dịch vụ đang dùng nó.'
    };
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (r.response !== 0) return { deleted: false };
    await s.keys.delete(key, true);
    return { deleted: true };
  });
  h(CH.keysImport, async (_e, p) => s.keys.import(v.str(p, 'đường dẫn file', 1024)));
  h(CH.keysFixPerms, async (_e, ids) => s.keys.fixPermissions(v.keyIds(ids)));
  h(CH.keysSetMeta, async (_e, id, tags, notes) => s.keys.setMeta(v.keyId(id), v.stringArray(tags, 'tags', 20, 64), v.str(notes, 'ghi chú', 2000)));
  h(CH.keysCopyPublic, async (_e, id) => {
    const pub = await s.keys.publicKey(v.keyId(id));
    if (containsPrivateKeyMaterial(pub)) throw new SkmError('INVALID_INPUT', 'Từ chối sao chép: nội dung không phải public key.');
    clipboard.writeText(pub);
  });

  h(CH.agentStatus, async () => s.platform.agentService.status());
  h(CH.agentStart, async () => s.platform.agentService.start());
  h(CH.agentEnableAsAdmin, async () => {
    await s.platform.agentService.launchElevatedEnable();
    return s.platform.agentService.status();
  });
  h(CH.agentList, async () => s.agent.list());
  h(
    CH.agentAdd,
    async (_e, id, pass, useKeychain) => s.agent.add(await s.keys.privateKeyPath(v.keyId(id)), v.optStr(pass, 'passphrase', 1024), { useKeychain: v.optBool(useKeychain, 'useKeychain') }),
    (a) => [a[1] as string]
  );
  h(CH.agentRemove, async (_e, fp) => {
    const fingerprint = v.str(fp, 'fingerprint', 128);
    if (!/^SHA256:[A-Za-z0-9+/]+$/.test(fingerprint)) throw new SkmError('INVALID_INPUT', 'Fingerprint không hợp lệ.');
    await s.agent.removeByFingerprint(fingerprint, tmpDir);
  });

  h(CH.configRead, async () => s.config.read());
  h(CH.configPreview, async (_e, edits) => s.config.preview(v.hostEdits(edits)));
  h(CH.configWrite, async (_e, edits, hash) => s.config.write(v.hostEdits(edits), v.str(hash, 'hash', 128)));
  h(CH.configIdentityRef, async (_e, id) => {
    const key = v.keyId(id);
    s.ctx.guard.resolveFile(key);
    return identityFileRef(s.ctx.sshDir, s.platform.paths.defaultSshDir(), key);
  });

  const runs = new Map<string, AbortController>();
  h(CH.testRun, async (e, host, timeout) => {
    const runId = randomUUID();
    const ac = new AbortController();
    runs.set(runId, ac);
    const sender = e.sender;
    const hostName = v.str(host, 'host', 255);
    const t = v.timeoutSec(timeout);
    void s.tester
      .run({
        host: hostName,
        timeoutSec: t,
        signal: ac.signal,
        onOutput: (stream, chunk) => {
          if (!sender.isDestroyed()) sender.send(CH.testOutput, { runId, stream, chunk });
        }
      })
      .then((result) => {
        runs.delete(runId);
        if (!sender.isDestroyed()) sender.send(CH.testDone, { runId, result });
      });
    return { runId };
  });
  h(CH.testCancel, async (_e, runId) => {
    runs.get(v.str(runId, 'runId', 64))?.abort();
  });
  h(CH.testScanHostKey, async (_e, host) => s.hostKeys.scan(v.str(host, 'host', 255)));
  h(CH.testTrustHostKey, async (_e, host, fps) => {
    if (!Array.isArray(fps) || fps.length === 0 || fps.length > 10) throw new SkmError('INVALID_INPUT', 'Danh sách fingerprint không hợp lệ.');
    const fingerprints = fps.map((f) => v.str(f, 'fingerprint', 128));
    if (fingerprints.some((f) => !/^SHA256:[A-Za-z0-9+/]+$/.test(f))) throw new SkmError('INVALID_INPUT', 'Fingerprint không hợp lệ.');
    return s.hostKeys.trust(v.str(host, 'host', 255), fingerprints);
  });

  h(CH.clipboardCopy, async (_e, text) => {
    const t = v.str(text, 'nội dung', 16_384);
    if (containsPrivateKeyMaterial(t)) throw new SkmError('INVALID_INPUT', 'Từ chối sao chép nội dung private key.');
    clipboard.writeText(t);
  });
}
