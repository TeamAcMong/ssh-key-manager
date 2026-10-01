// Pure type declarations shared by core, main, preload and renderer.
// This file must have no imports and no Node APIs: the renderer bundles it.

export type KeyType = 'ed25519' | 'rsa' | 'ecdsa';
export type DetectedKeyType = KeyType | 'dsa' | 'ed25519-sk' | 'ecdsa-sk' | 'unknown';

export const RSA_BITS = [3072, 4096] as const;
export const ECDSA_BITS = [256, 384, 521] as const;

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'PATH_OUTSIDE_SSH_DIR'
  | 'FILE_EXISTS'
  | 'NOT_FOUND'
  | 'NOT_A_KEY'
  | 'PERMISSION_DENIED_PUBLICKEY'
  | 'HOST_KEY_VERIFICATION_FAILED'
  | 'HOST_KEY_CHANGED'
  | 'CONNECTION_TIMEOUT'
  | 'CONNECTION_REFUSED'
  | 'HOST_NOT_FOUND'
  | 'UNPROTECTED_PRIVATE_KEY'
  | 'INCORRECT_PASSPHRASE'
  | 'AGENT_NOT_RUNNING'
  | 'AGENT_NEEDS_ADMIN'
  | 'BINARY_NOT_FOUND'
  | 'PROCESS_FAILED'
  | 'CANCELLED'
  | 'CONFIG_CHANGED'
  | 'SETTINGS_INVALID'
  | 'UNKNOWN';

export type SuggestedFix = 'fix-perms' | 'add-to-agent' | 'start-agent';

/** Serializable error shape that crosses IPC. `detail` is always redacted. */
export interface SkmErrorData {
  code: ErrorCode;
  messageVi: string;
  detail?: string;
  fix?: SuggestedFix;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: SkmErrorData };

export interface KeyInfo {
  /** File name of the private key (or of the .pub when the private half is missing), relative to the SSH dir. */
  id: string;
  hasPrivate: boolean;
  hasPublic: boolean;
  type: DetectedKeyType;
  bits: number | null;
  /** "SHA256:..." */
  fingerprint: string | null;
  comment: string;
  createdAt: string | null;
  /** null = could not be determined (e.g. only the public half exists). */
  hasPassphrase: boolean | null;
  /** null = no private file to check. */
  aclSafe: boolean | null;
  tags: string[];
  /** Per-key problem while reading it (already redacted); the key is still listed. */
  error?: string;
}

export interface KeyDetail extends KeyInfo {
  publicKey: string | null;
  randomart: string | null;
  notes: string;
}

export interface GenerateKeyRequest {
  type: KeyType;
  bits?: number;
  comment: string;
  fileName: string;
  passphrase: string;
}

export interface AclEntry {
  principal: string;
  rights: string;
  inherited: boolean;
  deny: boolean;
}

export interface AclReport {
  file: string;
  safe: boolean;
  entries: AclEntry[];
  /** Principals other than the current user, SYSTEM and Administrators that are granted access. */
  offending: string[];
}

export type AgentServiceState = 'running' | 'stopped' | 'disabled' | 'not-installed' | 'unknown';

export interface AgentServiceStatus {
  state: AgentServiceState;
  startType: string | null;
}

export interface AgentStartResult {
  started: boolean;
  needsAdmin: boolean;
  /** Command the user can run in an elevated prompt. */
  adminCommand?: string;
  messageVi: string;
}

export interface AgentKey {
  bits: number | null;
  fingerprint: string;
  comment: string;
  type: DetectedKeyType;
}

export interface HostEntry {
  /** Index of the block inside the parsed document; valid only for the document version it came from. */
  index: number;
  kind: 'host' | 'match';
  patterns: string[];
  hostName: string | null;
  user: string | null;
  port: number | null;
  identityFiles: string[];
  identitiesOnly: 'yes' | 'no' | null;
  /** Lowercased first value of StrictHostKeyChecking, or null when not set. */
  strictHostKeyChecking: StrictHostKeyChecking | null;
  /** Directives the editor does not manage; preserved verbatim on save. */
  otherDirectives: { key: string; value: string }[];
}

export interface HostFields {
  patterns: string[];
  hostName: string | null;
  user: string | null;
  port: number | null;
  identityFiles: string[];
  identitiesOnly: 'yes' | 'no' | null;
  strictHostKeyChecking: StrictHostKeyChecking | null;
}

/** Values OpenSSH accepts for StrictHostKeyChecking ("off" is an alias of "no"). */
export const STRICT_HOST_KEY_CHECKING = ['accept-new', 'yes', 'ask', 'no', 'off'] as const;
export type StrictHostKeyChecking = (typeof STRICT_HOST_KEY_CHECKING)[number];

export type HostEdit =
  | { op: 'add'; fields: HostFields }
  | { op: 'update'; index: number; fields: HostFields }
  | { op: 'delete'; index: number };

export interface ConfigSnapshot {
  path: string;
  exists: boolean;
  raw: string;
  hash: string;
  hosts: HostEntry[];
}

export interface ConfigPreview {
  before: string;
  after: string;
  hash: string;
}

export type ThemeSetting = 'system' | 'light' | 'dark';
export type Language = 'vi' | 'en';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface Settings {
  schemaVersion: 1;
  sshDir: string;
  binDir: string | null;
  theme: ThemeSetting;
  language: Language;
  window: WindowBounds | null;
}

export interface EnvInfo {
  opensshVersion: string | null;
  sshDir: string;
  defaultSshDir: string;
  isSandbox: boolean;
  platform: string;
  /** Unpacked (development) build: the UI warns when the real ~/.ssh is in use. */
  devMode: boolean;
  /** OpenSSH directory actually in use (the configured one, or the auto-detected one). */
  opensshBinDir: string;
}

export interface ScannedHostKey {
  type: string;
  /** "SHA256:..." */
  fingerprint: string;
  /** true/false = matches/differs from the provider's published list; null = no published list for this host. */
  published: boolean | null;
}

export interface HostKeyScan {
  hostName: string;
  port: number;
  provider: string | null;
  keys: ScannedHostKey[];
}

export interface ConnectionTestResult {
  success: boolean;
  exitCode: number | null;
  durationMs: number;
  error?: SkmErrorData;
}

export interface RenameResult {
  key: KeyInfo;
  /** Host patterns in ~/.ssh/config that still reference the old file name. */
  configReferences: string[];
}
