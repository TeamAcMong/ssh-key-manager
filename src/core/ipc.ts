// IPC contract between preload (window.skm) and main. Only type imports and constants: no Node APIs.
import type {
  AclReport,
  AgentKey,
  AgentServiceStatus,
  AgentStartResult,
  ConfigPreview,
  ConfigSnapshot,
  ConnectionTestResult,
  EnvInfo,
  GenerateKeyRequest,
  HostEdit,
  HostKeyScan,
  KeyDetail,
  KeyInfo,
  RenameResult,
  Result,
  Settings
} from './types';

export interface TestOutputEvent {
  runId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}

export interface TestDoneEvent {
  runId: string;
  result: ConnectionTestResult;
}

export interface SkmApi {
  env: {
    info(): Promise<Result<EnvInfo & { defaultComment: string }>>;
  };
  settings: {
    get(): Promise<Result<Settings>>;
    set(patch: Partial<Pick<Settings, 'sshDir' | 'binDir' | 'theme' | 'language'>>): Promise<Result<Settings>>;
    pickDir(kind: 'ssh' | 'bin'): Promise<Result<string | null>>;
  };
  keys: {
    list(): Promise<Result<KeyInfo[]>>;
    detail(id: string): Promise<Result<KeyDetail>>;
    /** Returns a Vietnamese reason, or null when the name is free and valid. */
    checkName(fileName: string): Promise<Result<string | null>>;
    generate(req: GenerateKeyRequest): Promise<Result<KeyDetail>>;
    changePassphrase(id: string, oldPassphrase: string, newPassphrase: string): Promise<Result<void>>;
    rename(id: string, newName: string): Promise<Result<RenameResult>>;
    /** Main shows a native confirmation dialog; resolves { deleted: false } when the user cancels. */
    delete(id: string): Promise<Result<{ deleted: boolean }>>;
    import(sourcePath: string): Promise<Result<KeyInfo>>;
    fixPerms(ids: string[] | 'all'): Promise<Result<AclReport[]>>;
    setMeta(id: string, tags: string[], notes: string): Promise<Result<void>>;
    copyPublic(id: string): Promise<Result<void>>;
  };
  agent: {
    status(): Promise<Result<AgentServiceStatus>>;
    start(): Promise<Result<AgentStartResult>>;
    enableAsAdmin(): Promise<Result<AgentServiceStatus>>;
    list(): Promise<Result<AgentKey[]>>;
    add(id: string, passphrase?: string): Promise<Result<void>>;
    remove(fingerprint: string): Promise<Result<void>>;
  };
  config: {
    read(): Promise<Result<ConfigSnapshot>>;
    preview(edits: HostEdit[]): Promise<Result<ConfigPreview>>;
    write(edits: HostEdit[], expectedHash: string): Promise<Result<{ backupPath: string | null; snapshot: ConfigSnapshot }>>;
    identityFileRef(keyId: string): Promise<Result<string>>;
  };
  test: {
    run(host: string, timeoutSec: number): Promise<Result<{ runId: string }>>;
    cancel(runId: string): Promise<Result<void>>;
    onOutput(cb: (e: TestOutputEvent) => void): () => void;
    onDone(cb: (e: TestDoneEvent) => void): () => void;
    scanHostKey(host: string): Promise<Result<HostKeyScan>>;
    trustHostKey(host: string, fingerprints: string[]): Promise<Result<{ added: number; backupPath: string | null }>>;
  };
  clipboard: {
    /** Copies non-secret text (fingerprints, commands). Main rejects private key material. */
    copyText(text: string): Promise<Result<void>>;
  };
  /** Absolute path of a dropped File (Electron webUtils). */
  pathForFile(file: File): string;
}

export const CH = {
  envInfo: 'env:info',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsPickDir: 'settings:pickDir',
  keysList: 'keys:list',
  keysDetail: 'keys:detail',
  keysCheckName: 'keys:checkName',
  keysGenerate: 'keys:generate',
  keysChangePassphrase: 'keys:changePassphrase',
  keysRename: 'keys:rename',
  keysDelete: 'keys:delete',
  keysImport: 'keys:import',
  keysFixPerms: 'keys:fixPerms',
  keysSetMeta: 'keys:setMeta',
  keysCopyPublic: 'keys:copyPublic',
  agentStatus: 'agent:status',
  agentStart: 'agent:start',
  agentEnableAsAdmin: 'agent:enableAsAdmin',
  agentList: 'agent:list',
  agentAdd: 'agent:add',
  agentRemove: 'agent:remove',
  configRead: 'config:read',
  configPreview: 'config:preview',
  configWrite: 'config:write',
  configIdentityRef: 'config:identityFileRef',
  testRun: 'test:run',
  testCancel: 'test:cancel',
  testOutput: 'test:output',
  testDone: 'test:done',
  testScanHostKey: 'test:scanHostKey',
  testTrustHostKey: 'test:trustHostKey',
  clipboardCopy: 'clipboard:copy'
} as const;
