import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, Menu, nativeTheme, session, type IpcMainInvokeEvent } from 'electron';
import { AppServices } from './services';
import { registerIpc } from './ipc';
import { createMainWindow } from './window';
import { toErrorData } from '../core/errors/SkmError';

const isDev = !app.isPackaged;
const devUrl = process.env.ELECTRON_RENDERER_URL;
const rendererFile = path.join(__dirname, '../renderer/index.html');

// Keep everything the app writes inside the repo while developing.
if (isDev && !process.env.SKM_APPDATA_DIR) process.env.SKM_APPDATA_DIR = path.join(app.getAppPath(), '.dev-appdata');

const services = new AppServices();
const appDataDir = services.platform.paths.appDataDir();
app.setPath('userData', path.join(appDataDir, 'electron'));
app.setPath('sessionData', path.join(appDataDir, 'electron'));
app.enableSandbox();

if (!app.requestSingleInstanceLock()) app.quit();

const PROD_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
// Vite dev server needs its own origin + websocket and the React refresh preamble.
const DEV_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws://localhost:* http://localhost:*; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return devUrl ? url.startsWith(devUrl) : url.startsWith(pathToFileURL(rendererFile).href);
}

function isAppUrl(url: string): boolean {
  return devUrl ? url.startsWith(devUrl) : url.startsWith(pathToFileURL(rendererFile).href);
}

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (ev, url) => {
    if (!isAppUrl(url)) ev.preventDefault();
  });
  contents.on('will-redirect', (ev) => ev.preventDefault());
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [devUrl ? DEV_CSP : PROD_CSP] } });
  });
  // Block every request that is not the app itself (no remote content, ever).
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const allowed = u.startsWith('file:') || u.startsWith('devtools:') || u.startsWith('data:') || (devUrl !== undefined && (u.startsWith(devUrl) || u.startsWith('ws://localhost')));
    cb({ cancel: !allowed });
  });

  try {
    await services.init(isDev ? path.join(app.getAppPath(), 'sandbox-ssh') : undefined);
  } catch (err) {
    const data = toErrorData(err);
    console.error(`[main] init failed: ${data.code}`);
    dialog.showErrorBox('SSH Key Manager', `Không khởi động được ứng dụng.\n\n${data.messageVi}`);
    app.quit();
    return;
  }
  nativeTheme.themeSource = services.settings.theme;
  registerIpc(services, isTrustedSender, path.join(appDataDir, 'tmp'));

  const win = createMainWindow(services.settings.window, (b) => {
    services.settingsStore.save({ window: b }).catch((err: unknown) => console.error(`[main] saving window bounds failed: ${toErrorData(err).code}`));
  });
  if (devUrl) await win.loadURL(devUrl);
  else await win.loadFile(rendererFile);

  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) app.quit();
});
