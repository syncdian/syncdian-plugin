export interface UserProfile {
  id: string;
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface CloudVault {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteFile {
  id: string;
  encryptedPath: string;
  hash: string;
  size: number;
  version: number;
  revision: number;
  updatedAt: number;
  deleted: boolean;
  deviceId: string;
}

export interface SyncedFile extends RemoteFile {
  path: string;
  plainHash: string;
}

export interface VaultSyncState {
  initialized: boolean;
  lastRevision: number;
  files: Record<string, SyncedFile>;
}

export interface PluginData {
  sessionToken: string;
  user: UserProfile | null;
  activeVaultId: string;
  deviceId: string;
  autoSync: boolean;
  vaultKeys: Record<string, string>;
  states: Record<string, VaultSyncState>;
}

export const EMPTY_DATA: PluginData = {
  sessionToken: "",
  user: null,
  activeVaultId: "",
  deviceId: "",
  autoSync: true,
  vaultKeys: {},
  states: {},
};

export interface DeviceChallenge {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

export interface WrappedVaultKey {
  wrappedKey: string;
  wrapSalt: string;
  wrapNonce: string;
  wrapIterations: number;
  keyVersion: number;
}
