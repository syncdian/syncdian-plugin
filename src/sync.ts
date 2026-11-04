import { Notice, Platform, normalizePath, type App } from "obsidian";
import { SyncClient, SyncError } from "./client";
import { sha256 } from "./crypto";
import { isTextPath, mergeText } from "./merge";
import { androidSafePath, isMissingFileError } from "./paths";
import type { PluginData, RemoteFile, SyncedFile, VaultSyncState } from "./types";

interface EngineOptions {
  app: App;
  data: () => PluginData;
  state: () => VaultSyncState;
  persist: () => Promise<void>;
  status: (text: string) => void;
  onSyncComplete?: () => void;
}

const CONFIG_FILES = new Set([
  "app.json", "appearance.json", "core-plugins.json", "community-plugins.json", "hotkeys.json",
  "templates.json", "daily-notes.json", "graph.json", "canvas.json", "bookmarks.json", "backlink.json",
  "command-palette.json", "editor.json",
]);

export class SyncEngine {
  private readonly client: SyncClient;
  private running = false;
  private runQueued = false;
  private scanRequested = true;
  private stopped = false;
  private applyingRemote = 0;
  private activeConfiguration = "";
  private socket?: WebSocket;
  private reconnectTimer?: number;
  private debounceTimer?: number;
  private scanTimer?: number;
  private readonly pendingPaths = new Set<string>();
  private readonly pendingDeletes = new Set<string>();

  constructor(private readonly options: EngineOptions) {
    this.client = new SyncClient(options.data);
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (!this.ready()) {
      this.options.status(this.options.data().sessionToken ? "Syncdian: set up sync" : "Syncdian: login required");
      return;
    }
    await this.requestRun(true);
    this.scanTimer = window.setInterval(() => {
      if (this.options.data().autoSync) {
        this.scanRequested = true;
        void this.requestRun(false);
      }
    }, 15000);
  }

  stop(): void {
    this.stopped = true;
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this.scanTimer) window.clearInterval(this.scanTimer);
    this.scanTimer = undefined;
    this.socket?.close();
    this.socket = undefined;
  }

  settingsChanged(): void {
    this.socket?.close();
    this.socket = undefined;
    this.activeConfiguration = "";
    this.scanRequested = true;
    if (this.ready()) void this.requestRun(true);
    else this.options.status(this.options.data().sessionToken ? "Syncdian: set up sync" : "Syncdian: login required");
  }

  syncNow(): void {
    if (this.ready()) void this.requestRun(true);
  }

  localChanged(path: string): void {
    if (this.applyingRemote || !this.included(path)) return;
    this.pendingDeletes.delete(path);
    this.pendingPaths.add(path);
    this.schedule();
  }

  localDeleted(path: string): void {
    if (this.applyingRemote || !this.included(path)) return;
    this.pendingPaths.delete(path);
    this.pendingDeletes.add(path);
    this.schedule();
  }

  localRenamed(path: string, oldPath: string): void {
    if (this.applyingRemote || !this.included(path)) return;
    if (this.included(oldPath)) this.pendingDeletes.add(oldPath);
    this.pendingPaths.delete(oldPath);
    this.pendingPaths.add(path);
    this.schedule();
  }

  private ready(): boolean {
    const data = this.options.data();
    return Boolean(data.sessionToken && data.activeVaultId);
  }

  private schedule(): void {
    if (this.stopped || !this.options.data().autoSync) return;
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => void this.requestRun(false), 750);
  }

  private async requestRun(scan: boolean): Promise<void> {
    if (this.stopped || !this.ready()) return;
    this.scanRequested ||= scan;
    if (this.running) {
      this.runQueued = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.runQueued = false;
        await this.cycle();
      } while (this.runQueued && !this.stopped);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unknown sync error";
      this.options.status("Syncdian: sync failed");
      new Notice(`Syncdian: ${message}`, 8000);
      console.error("Syncdian sync failed", caught);
    } finally {
      this.running = false;
    }
  }

  private async cycle(): Promise<void> {
    const data = this.options.data();
    const configuration = `${data.activeVaultId}|${data.sessionToken.slice(0, 12)}`;
    if (this.activeConfiguration !== configuration) {
      this.pendingPaths.clear();
      this.pendingDeletes.clear();
      this.scanRequested = true;
      this.activeConfiguration = configuration;
    }
    this.options.status("Syncdian: syncing…");
    if (!this.options.state().initialized) await this.initializeRemote();
    else await this.catchUp();
    if (this.scanRequested) await this.scanLocal();
    await this.pushPending();
    await this.catchUp();
    await this.options.persist();
    this.connectWebSocket();
    this.options.status(`Syncdian: live · r${this.options.state().lastRevision}`);
    this.options.onSyncComplete?.();
  }

  private async initializeRemote(): Promise<void> {
    const manifest = await this.client.manifest();
    for (const file of manifest.files) await this.applyRemote(file);
    const state = this.options.state();
    state.initialized = true;
    state.lastRevision = manifest.revision;
    this.scanRequested = true;
    await this.options.persist();
  }

  private async catchUp(): Promise<void> {
    const state = this.options.state();
    if (!state.initialized) return;
    while (true) {
      const response = await this.client.changes(state.lastRevision);
      for (const file of response.changes) {
        await this.applyRemote(file);
        state.lastRevision = Math.max(state.lastRevision, file.revision);
      }
      await this.options.persist();
      if (!response.hasMore || response.changes.length === 0) break;
    }
  }

  private async scanLocal(): Promise<void> {
    const state = this.options.state();
    const actualPaths = new Set(await this.listLocalFiles());
    for (const path of actualPaths) {
      const data = await this.readLocal(path);
      if (!data) {
        actualPaths.delete(path);
        continue;
      }
      const plainHash = await sha256(data);
      const synced = state.files[path];
      if (!synced || synced.deleted || synced.plainHash !== plainHash) this.pendingPaths.add(path);
    }
    for (const [path, synced] of Object.entries(state.files)) {
      if (!synced.deleted && !actualPaths.has(path)) this.pendingDeletes.add(path);
    }
    this.scanRequested = false;
  }

  private async pushPending(): Promise<void> {
    for (const path of Array.from(this.pendingDeletes).sort()) {
      const state = this.options.state();
      const synced = state.files[path];
      try {
        const result = await this.client.remove(synced?.remotePath ?? path, synced?.version ?? 0);
        state.files[path] = { ...result.file, path, remotePath: result.file.path, plainHash: synced?.plainHash ?? "" };
        state.lastRevision = Math.max(state.lastRevision, result.revision);
        this.pendingDeletes.delete(path);
        await this.options.persist();
      } catch (caught) {
        if (caught instanceof SyncError && caught.status === 409 && caught.payload.current) {
          // Edit wins over a concurrent delete so no modified content is lost.
          await this.applyRemote(caught.payload.current as RemoteFile);
          this.pendingDeletes.delete(path);
          this.scanRequested = true;
          await this.options.persist();
          continue;
        }
        throw caught;
      }
    }

    for (const path of Array.from(this.pendingPaths).sort()) {
      const data = await this.readLocal(path);
      if (!data) {
        this.pendingPaths.delete(path);
        this.pendingDeletes.add(path);
        continue;
      }
      const state = this.options.state();
      const plainHash = await sha256(data);
      const synced = state.files[path];
      if (synced && !synced.deleted && synced.plainHash === plainHash) {
        this.pendingPaths.delete(path);
        continue;
      }
      try {
        await this.uploadData(path, data, synced?.version ?? 0);
        this.pendingPaths.delete(path);
        const latest = await this.readLocal(path);
        if (latest && await sha256(latest) !== plainHash) {
          this.pendingPaths.add(path);
        } else if (!latest) {
          this.pendingDeletes.add(path);
        }
        await this.options.persist();
      } catch (caught) {
        if (caught instanceof SyncError && caught.status === 409 && caught.payload.current) {
          await this.applyRemote(caught.payload.current as RemoteFile);
          this.pendingPaths.delete(path);
          this.scanRequested = true;
          await this.options.persist();
          continue;
        }
        throw caught;
      }
    }
  }

  private async uploadData(path: string, data: ArrayBuffer, baseVersion: number): Promise<void> {
    const state = this.options.state();
    const plainHash = await sha256(data);
    const remotePath = state.files[path]?.remotePath ?? path;
    const result = await this.client.upload(remotePath, data, baseVersion);
    state.files[path] = { ...result.file, path, remotePath: result.file.path, plainHash };
    state.lastRevision = Math.max(state.lastRevision, result.revision);
  }

  private async applyRemote(remote: RemoteFile): Promise<void> {
    const remotePath = this.validRemotePath(remote.path);
    const state = this.options.state();
    const path = this.localPathFor(remotePath, remote.id);
    const previousEntry = Object.entries(state.files).find(([, file]) => (file.remotePath ?? file.path) === remotePath);
    const synced = state.files[path] ?? previousEntry?.[1];
    if (previousEntry && previousEntry[0] !== path) delete state.files[previousEntry[0]];
    if (synced?.revision === remote.revision && synced.hash === remote.hash) return;

    const adapter = this.options.app.vault.adapter;
    const localData = await this.readLocal(path);
    const exists = localData !== null;
    const localHash = localData ? await sha256(localData) : null;

    if (remote.deleted) {
      if (localData && localHash !== synced?.plainHash) {
        // Edit wins over delete and recreates the file with the tombstone as its base.
        await this.uploadData(path, localData, remote.version);
      } else {
        if (exists) await this.removeLocal(path);
        state.files[path] = { ...remote, path, remotePath, plainHash: synced?.plainHash ?? "" };
      }
      return;
    }

    const remoteData = await this.client.download(remote.id, remote.hash);
    const remotePlainHash = await sha256(remoteData);
    if (localHash === remotePlainHash) {
      state.files[path] = { ...remote, path, remotePath, plainHash: remotePlainHash };
      return;
    }

    if (!localData || (synced && localHash === synced.plainHash)) {
      await this.writeLocal(path, remoteData);
      state.files[path] = { ...remote, path, remotePath, plainHash: remotePlainHash };
      return;
    }

    const baseData = synced?.hash
      ? await this.client.download(remote.id, synced.hash)
      : new ArrayBuffer(0);

    if (isTextPath(path)) {
      const merged = mergeText(localData, baseData, remoteData);
      const mergedHash = await sha256(merged.data);
      if (mergedHash === remotePlainHash) {
        await this.writeLocal(path, remoteData);
        state.files[path] = { ...remote, path, remotePath, plainHash: remotePlainHash };
      } else {
        await this.writeLocal(path, merged.data);
        await this.uploadData(path, merged.data, remote.version);
      }
      if (merged.conflict) new Notice(`Syncdian: conflict markers added to ${path}`, 8000);
    } else {
      await this.createConflictCopy(path, localData);
      await this.writeLocal(path, remoteData);
      state.files[path] = { ...remote, path, remotePath, plainHash: remotePlainHash };
    }
  }

  private async createConflictCopy(path: string, data: ArrayBuffer): Promise<void> {
    const slash = path.lastIndexOf("/");
    const dot = path.lastIndexOf(".");
    const hasExtension = dot > slash;
    const base = hasExtension ? path.slice(0, dot) : path;
    const extension = hasExtension ? path.slice(dot) : "";
    let candidate = `${base}.conflict-${this.options.data().deviceId.slice(0, 8)}-${Date.now()}${extension}`;
    let counter = 2;
    while (await this.options.app.vault.adapter.exists(candidate)) {
      candidate = `${base}.conflict-${this.options.data().deviceId.slice(0, 8)}-${Date.now()}-${counter}${extension}`;
      counter += 1;
    }
    await this.writeLocal(candidate, data);
    this.pendingPaths.add(candidate);
    new Notice(`Syncdian: local binary version preserved as ${candidate}`, 8000);
  }

  private async readLocal(path: string): Promise<ArrayBuffer | null> {
    try {
      return await this.options.app.vault.adapter.readBinary(path);
    } catch (caught) {
      if (isMissingFileError(caught)) return null;
      throw caught;
    }
  }

  private async writeLocal(path: string, data: ArrayBuffer): Promise<void> {
    await this.ensureParentFolder(path);
    this.applyingRemote += 1;
    try {
      await this.options.app.vault.adapter.writeBinary(path, data);
    } finally {
      this.applyingRemote -= 1;
    }
  }

  private async removeLocal(path: string): Promise<void> {
    this.applyingRemote += 1;
    try {
      await this.options.app.vault.adapter.remove(path);
    } catch (caught) {
      if (!isMissingFileError(caught)) throw caught;
    } finally {
      this.applyingRemote -= 1;
    }
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const parts = path.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!await this.options.app.vault.adapter.exists(current)) {
        await this.options.app.vault.adapter.mkdir(current);
      }
    }
  }

  private async listLocalFiles(): Promise<string[]> {
    const files: string[] = [];
    const visit = async (folder: string): Promise<void> => {
      const listing = await this.options.app.vault.adapter.list(folder);
      for (const file of listing.files) {
        const path = normalizePath(file);
        if (this.included(path)) files.push(path);
      }
      for (const child of listing.folders) {
        const path = normalizePath(child);
        if (this.includedFolder(path)) await visit(path);
      }
    };
    await visit("");
    return files;
  }

  private includedFolder(path: string): boolean {
    if (path === ".trash" || path.startsWith(".trash/")) return false;
    if (path === ".obsidian/plugins/syncdian" || path.startsWith(".obsidian/plugins/syncdian/")) return false;
    if (path === ".obsidian") return true;
    if ([".obsidian/plugins", ".obsidian/themes", ".obsidian/snippets"].includes(path)) return true;
    if (path.startsWith(".obsidian/")) {
      return path.startsWith(".obsidian/plugins/") || path.startsWith(".obsidian/themes/") || path.startsWith(".obsidian/snippets/");
    }
    return true;
  }

  private included(path: string): boolean {
    if (!path || path === ".trash" || path.startsWith(".trash/")) return false;
    if (!path.startsWith(".obsidian/")) return true;
    if (path.startsWith(".obsidian/plugins/syncdian/")) return false;
    const relative = path.slice(".obsidian/".length);
    return CONFIG_FILES.has(relative) || relative.startsWith("plugins/") || relative.startsWith("themes/") || relative.startsWith("snippets/");
  }

  private localPathFor(remotePath: string, id: string): string {
    if (!Platform.isAndroidApp) return remotePath;
    const state = this.options.state();
    const existing = Object.values(state.files).find((file) => (file.remotePath ?? file.path) === remotePath);
    if (existing && androidSafePath(existing.path) === existing.path) return existing.path;

    let candidate = androidSafePath(remotePath);
    const collision = Object.values(state.files).some((file) =>
      file.path === candidate && (file.remotePath ?? file.path) !== remotePath
    );
    if (collision) {
      const slash = candidate.lastIndexOf("/");
      const dot = candidate.lastIndexOf(".");
      const hasExtension = dot > slash;
      const base = hasExtension ? candidate.slice(0, dot) : candidate;
      const extension = hasExtension ? candidate.slice(dot) : "";
      candidate = `${base}.syncdian-${id.slice(0, 8)}${extension}`;
    }
    return candidate;
  }

  private validRemotePath(path: string): string {
    const normalized = normalizePath(path);
    if (
      !normalized || normalized.startsWith("/") || normalized.includes("\\") || normalized.includes("\0") ||
      normalized.split("/").some((part) => part === ".." || part === ".") || !this.included(normalized)
    ) throw new Error("Remote path failed validation");
    return normalized;
  }

  private connectWebSocket(): void {
    if (this.stopped || (this.socket && this.socket.readyState <= WebSocket.OPEN)) return;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    const socket = this.client.openWebSocket(
      (file) => {
        if (file.revision > this.options.state().lastRevision) void this.requestRun(false);
      },
      () => this.options.status(`Syncdian: live · r${this.options.state().lastRevision}`),
      () => {
        if (this.socket === socket) this.socket = undefined;
        if (!this.stopped) this.reconnectTimer = window.setTimeout(() => void this.requestRun(false), 5000);
      },
    );
    this.socket = socket;
  }
}
