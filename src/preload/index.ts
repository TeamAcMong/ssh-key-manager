// Sandboxed preload: exposes a narrow, typed API. No Node APIs reach the renderer.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CH, type SkmApi, type TestDoneEvent, type TestOutputEvent } from '../core/ipc';

const invoke = (channel: string, ...args: unknown[]): Promise<never> => ipcRenderer.invoke(channel, ...args) as Promise<never>;

function subscribe<T>(channel: string, cb: (e: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: SkmApi = {
  env: { info: () => invoke(CH.envInfo) },
  settings: {
    get: () => invoke(CH.settingsGet),
    set: (patch) => invoke(CH.settingsSet, patch),
    pickDir: (kind) => invoke(CH.settingsPickDir, kind)
  },
  keys: {
    list: () => invoke(CH.keysList),
    detail: (id) => invoke(CH.keysDetail, id),
    checkName: (name) => invoke(CH.keysCheckName, name),
    generate: (req) => invoke(CH.keysGenerate, req),
    changePassphrase: (id, o, n) => invoke(CH.keysChangePassphrase, id, o, n),
    rename: (id, n) => invoke(CH.keysRename, id, n),
    delete: (id) => invoke(CH.keysDelete, id),
    import: (p) => invoke(CH.keysImport, p),
    fixPerms: (ids) => invoke(CH.keysFixPerms, ids),
    setMeta: (id, tags, notes) => invoke(CH.keysSetMeta, id, tags, notes),
    copyPublic: (id) => invoke(CH.keysCopyPublic, id)
  },
  agent: {
    status: () => invoke(CH.agentStatus),
    start: () => invoke(CH.agentStart),
    enableAsAdmin: () => invoke(CH.agentEnableAsAdmin),
    list: () => invoke(CH.agentList),
    add: (id, pass, useKeychain) => invoke(CH.agentAdd, id, pass, useKeychain),
    remove: (fp) => invoke(CH.agentRemove, fp)
  },
  config: {
    read: () => invoke(CH.configRead),
    preview: (edits) => invoke(CH.configPreview, edits),
    write: (edits, hash) => invoke(CH.configWrite, edits, hash),
    identityFileRef: (id) => invoke(CH.configIdentityRef, id)
  },
  test: {
    run: (host, t) => invoke(CH.testRun, host, t),
    cancel: (runId) => invoke(CH.testCancel, runId),
    onOutput: (cb) => subscribe<TestOutputEvent>(CH.testOutput, cb),
    onDone: (cb) => subscribe<TestDoneEvent>(CH.testDone, cb),
    scanHostKey: (host) => invoke(CH.testScanHostKey, host),
    trustHostKey: (host, fps) => invoke(CH.testTrustHostKey, host, fps)
  },
  clipboard: { copyText: (text) => invoke(CH.clipboardCopy, text) },
  pathForFile: (file) => webUtils.getPathForFile(file),
  platform: process.platform
};

contextBridge.exposeInMainWorld('skm', api);
