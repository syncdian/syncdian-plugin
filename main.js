"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SyncdianPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/client.ts
var import_obsidian = require("obsidian");

// src/crypto.ts
function bytesToBase64(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
}
async function sha256(data) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// src/client.ts
var API_URL = "https://syncdian.vayazka.com";
var SyncError = class extends Error {
  constructor(message, status, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
};
var SyncClient = class {
  constructor(data) {
    this.data = data;
  }
  startLogin() {
    return this.expectJson(this.publicRequest("POST", "/auth/device/start"));
  }
  async pollLogin(deviceCode) {
    const response = await this.publicRequest("POST", "/auth/device/poll", { deviceCode });
    if (response.status === 202) return { status: "pending" };
    return this.expectJson(response);
  }
  async logout() {
    await this.request("POST", "/auth/logout");
  }
  async listVaults() {
    return this.expectJson(await this.request("GET", "/v1/vaults"));
  }
  async createVault(name) {
    const response = await this.expectJson(await this.request("POST", "/v1/vaults", { name }));
    return response.vault;
  }
  async manifest() {
    return this.expectJson(await this.request("GET", "/v1/manifest"));
  }
  async changes(since) {
    return this.expectJson(await this.request("GET", `/v1/changes?since=${since}`));
  }
  async download(id, hash) {
    const response = await this.request("GET", `/v1/file?id=${id}${hash ? `&hash=${hash}` : ""}`);
    if (response.status >= 400) this.throwResponse(response);
    return response.arrayBuffer;
  }
  async upload(path, body, baseVersion) {
    const response = await this.request("PUT", "/v1/file", void 0, body, {
      "X-File-Path": bytesToBase64(new TextEncoder().encode(path)),
      "X-Base-Version": String(baseVersion),
      "Content-Type": "application/octet-stream"
    });
    if (response.status >= 400) this.throwResponse(response);
    return this.expectJson(response);
  }
  async remove(path, baseVersion) {
    const response = await this.request("DELETE", "/v1/file", void 0, void 0, {
      "X-File-Path": bytesToBase64(new TextEncoder().encode(path)),
      "X-Base-Version": String(baseVersion)
    });
    if (response.status >= 400) this.throwResponse(response);
    return this.expectJson(response);
  }
  openWebSocket(onChange, onOpen, onClose) {
    const data = this.data();
    const url = `wss://syncdian.vayazka.com/v1/ws?vaultId=${encodeURIComponent(data.activeVaultId)}`;
    const socket = new WebSocket(url, ["syncdian.v1", `auth.${data.sessionToken}`]);
    socket.onopen = onOpen;
    socket.onclose = onClose;
    socket.onerror = () => socket.close();
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "change" && message.file) onChange(message.file);
      } catch {
      }
    };
    return socket;
  }
  publicRequest(method, path, body) {
    return (0, import_obsidian.requestUrl)({ url: `${API_URL}${path}`, method, body: body ? JSON.stringify(body) : void 0, contentType: "application/json", throw: false });
  }
  request(method, path, jsonBody, body, headers = {}) {
    const data = this.data();
    const separator = path.includes("?") ? "&" : "?";
    const needsVault = path.startsWith("/v1/file") || path.startsWith("/v1/manifest") || path.startsWith("/v1/changes");
    const vaultQuery = needsVault ? `${separator}vaultId=${encodeURIComponent(data.activeVaultId)}` : "";
    return (0, import_obsidian.requestUrl)({
      url: `${API_URL}${path}${vaultQuery}`,
      method,
      body: body ?? (jsonBody ? JSON.stringify(jsonBody) : void 0),
      contentType: headers["Content-Type"] ?? (jsonBody ? "application/json" : void 0),
      headers: {
        Authorization: `Bearer ${data.sessionToken}`,
        "X-Device-Id": data.deviceId,
        ...headers
      },
      throw: false
    });
  }
  async expectJson(response) {
    const resolved = await response;
    if (resolved.status >= 400) this.throwResponse(resolved);
    return resolved.json;
  }
  throwResponse(response) {
    const payload = response.json ?? {};
    throw new SyncError(payload.error ?? `Request failed (${response.status})`, response.status, payload);
  }
};

// src/sync.ts
var import_obsidian2 = require("obsidian");

// node_modules/node-diff3/dist/diff3.mjs
function LCS(buffer1, buffer2) {
  let equivalenceClasses = /* @__PURE__ */ Object.create(null);
  for (let j = 0; j < buffer2.length; j++) {
    const item = buffer2[j];
    if (equivalenceClasses[item]) {
      equivalenceClasses[item].push(j);
    } else {
      equivalenceClasses[item] = [j];
    }
  }
  const NULLRESULT = { buffer1index: -1, buffer2index: -1, chain: null };
  let candidates = [NULLRESULT];
  for (let i = 0; i < buffer1.length; i++) {
    const item = buffer1[i];
    const buffer2indices = equivalenceClasses[item] || [];
    let r = 0;
    let c = candidates[0];
    for (const j of buffer2indices) {
      let s;
      for (s = r; s < candidates.length; s++) {
        if (candidates[s].buffer2index < j && (s === candidates.length - 1 || candidates[s + 1].buffer2index > j)) {
          break;
        }
      }
      if (s < candidates.length) {
        const newCandidate = { buffer1index: i, buffer2index: j, chain: candidates[s] };
        if (r === candidates.length) {
          candidates.push(c);
        } else {
          candidates[r] = c;
        }
        r = s + 1;
        c = newCandidate;
        if (r === candidates.length) {
          break;
        }
      }
    }
    candidates[r] = c;
  }
  return candidates[candidates.length - 1];
}
function diffIndices(buffer1, buffer2) {
  const lcs = LCS(buffer1, buffer2);
  let result = [];
  let tail1 = buffer1.length;
  let tail2 = buffer2.length;
  for (let candidate = lcs; candidate !== null; candidate = candidate.chain) {
    const mismatchLength1 = tail1 - candidate.buffer1index - 1;
    const mismatchLength2 = tail2 - candidate.buffer2index - 1;
    tail1 = candidate.buffer1index;
    tail2 = candidate.buffer2index;
    if (mismatchLength1 || mismatchLength2) {
      result.push({
        buffer1: [tail1 + 1, mismatchLength1],
        buffer1Content: buffer1.slice(tail1 + 1, tail1 + 1 + mismatchLength1),
        buffer2: [tail2 + 1, mismatchLength2],
        buffer2Content: buffer2.slice(tail2 + 1, tail2 + 1 + mismatchLength2)
      });
    }
  }
  result.reverse();
  return result;
}
function diff3MergeRegions(a, o, b) {
  let hunks = [];
  function addHunk(h, ab) {
    hunks.push({
      ab,
      oStart: h.buffer1[0],
      oLength: h.buffer1[1],
      abStart: h.buffer2[0],
      abLength: h.buffer2[1]
    });
  }
  diffIndices(o, a).forEach((item) => addHunk(item, "a"));
  diffIndices(o, b).forEach((item) => addHunk(item, "b"));
  hunks.sort((x, y) => x.oStart - y.oStart);
  let results = [];
  let currOffset = 0;
  function advanceTo(endOffset) {
    if (endOffset > currOffset) {
      results.push({
        stable: true,
        buffer: "o",
        bufferStart: currOffset,
        bufferLength: endOffset - currOffset,
        bufferContent: o.slice(currOffset, endOffset)
      });
      currOffset = endOffset;
    }
  }
  while (hunks.length) {
    let hunk = hunks.shift();
    let regionStart = hunk.oStart;
    let regionEnd = hunk.oStart + hunk.oLength;
    let regionHunks = [hunk];
    advanceTo(regionStart);
    while (hunks.length) {
      const nextHunk = hunks[0];
      const nextHunkStart = nextHunk.oStart;
      if (nextHunkStart > regionEnd)
        break;
      regionEnd = Math.max(regionEnd, nextHunkStart + nextHunk.oLength);
      regionHunks.push(hunks.shift());
    }
    if (regionHunks.length === 1) {
      if (hunk.abLength > 0) {
        const buffer = hunk.ab === "a" ? a : b;
        results.push({
          stable: true,
          buffer: hunk.ab,
          bufferStart: hunk.abStart,
          bufferLength: hunk.abLength,
          bufferContent: buffer.slice(hunk.abStart, hunk.abStart + hunk.abLength)
        });
      }
    } else {
      let bounds = {
        a: [a.length, -1, o.length, -1],
        b: [b.length, -1, o.length, -1]
      };
      while (regionHunks.length) {
        hunk = regionHunks.shift();
        const oStart = hunk.oStart;
        const oEnd = oStart + hunk.oLength;
        const abStart = hunk.abStart;
        const abEnd = abStart + hunk.abLength;
        let b2 = bounds[hunk.ab];
        b2[0] = Math.min(abStart, b2[0]);
        b2[1] = Math.max(abEnd, b2[1]);
        b2[2] = Math.min(oStart, b2[2]);
        b2[3] = Math.max(oEnd, b2[3]);
      }
      const aStart = bounds.a[0] + (regionStart - bounds.a[2]);
      const aEnd = bounds.a[1] + (regionEnd - bounds.a[3]);
      const bStart = bounds.b[0] + (regionStart - bounds.b[2]);
      const bEnd = bounds.b[1] + (regionEnd - bounds.b[3]);
      let result = {
        stable: false,
        aStart,
        aLength: aEnd - aStart,
        aContent: a.slice(aStart, aEnd),
        oStart: regionStart,
        oLength: regionEnd - regionStart,
        oContent: o.slice(regionStart, regionEnd),
        bStart,
        bLength: bEnd - bStart,
        bContent: b.slice(bStart, bEnd)
      };
      results.push(result);
    }
    currOffset = regionEnd;
  }
  advanceTo(o.length);
  return results;
}
function diff3Merge(a, o, b, options) {
  let defaults = {
    excludeFalseConflicts: true,
    stringSeparator: /\s+/
  };
  options = Object.assign(defaults, options);
  if (typeof a === "string")
    a = a.split(options.stringSeparator);
  if (typeof o === "string")
    o = o.split(options.stringSeparator);
  if (typeof b === "string")
    b = b.split(options.stringSeparator);
  let results = [];
  const regions = diff3MergeRegions(a, o, b);
  let okBuffer = [];
  function flushOk() {
    if (okBuffer.length) {
      results.push({ ok: okBuffer });
    }
    okBuffer = [];
  }
  function isFalseConflict(a2, b2) {
    if (a2.length !== b2.length)
      return false;
    for (let i = 0; i < a2.length; i++) {
      if (a2[i] !== b2[i])
        return false;
    }
    return true;
  }
  regions.forEach((region) => {
    if (region.stable) {
      okBuffer.push(...region.bufferContent);
    } else {
      if (options.excludeFalseConflicts && isFalseConflict(region.aContent, region.bContent)) {
        okBuffer.push(...region.aContent);
      } else {
        flushOk();
        results.push({
          conflict: {
            a: region.aContent,
            aIndex: region.aStart,
            o: region.oContent,
            oIndex: region.oStart,
            b: region.bContent,
            bIndex: region.bStart
          }
        });
      }
    }
  });
  flushOk();
  return results;
}
function mergeDiff3(a, o, b, options) {
  const defaults = {
    excludeFalseConflicts: true,
    stringSeparator: /\s+/,
    label: {}
  };
  options = Object.assign(defaults, options);
  const aSection = "<<<<<<<" + (options.label.a ? ` ${options.label.a}` : "");
  const oSection = "|||||||" + (options.label.o ? ` ${options.label.o}` : "");
  const xSection = "=======";
  const bSection = ">>>>>>>" + (options.label.b ? ` ${options.label.b}` : "");
  const regions = diff3Merge(a, o, b, options);
  let conflict = false;
  let result = [];
  regions.forEach((region) => {
    if (region.ok) {
      result = result.concat(region.ok);
    } else if (region.conflict) {
      conflict = true;
      result = result.concat([aSection], region.conflict.a, [oSection], region.conflict.o, [xSection], region.conflict.b, [bSection]);
    }
  });
  return {
    conflict,
    result
  };
}

// src/merge.ts
var TEXT_EXTENSIONS = /* @__PURE__ */ new Set([
  "md",
  "txt",
  "json",
  "canvas",
  "css",
  "js",
  "ts",
  "csv",
  "yaml",
  "yml",
  "xml",
  "html",
  "svg"
]);
function isTextPath(path) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(extension);
}
function mergeText(local, base, remote) {
  const decoder = new TextDecoder();
  const result = mergeDiff3(
    decoder.decode(local),
    decoder.decode(base),
    decoder.decode(remote),
    {
      stringSeparator: "\n",
      excludeFalseConflicts: true,
      label: { a: "Local", o: "Base", b: "Remote" }
    }
  );
  return { data: new TextEncoder().encode(result.result.join("\n")).buffer, conflict: result.conflict };
}

// src/sync.ts
var CONFIG_FILES = /* @__PURE__ */ new Set([
  "app.json",
  "appearance.json",
  "core-plugins.json",
  "community-plugins.json",
  "hotkeys.json",
  "templates.json",
  "daily-notes.json",
  "graph.json",
  "canvas.json",
  "bookmarks.json",
  "backlink.json",
  "command-palette.json",
  "editor.json"
]);
var SyncEngine = class {
  constructor(options) {
    this.options = options;
    this.running = false;
    this.runQueued = false;
    this.scanRequested = true;
    this.stopped = false;
    this.applyingRemote = 0;
    this.activeConfiguration = "";
    this.pendingPaths = /* @__PURE__ */ new Set();
    this.pendingDeletes = /* @__PURE__ */ new Set();
    this.client = new SyncClient(options.data);
  }
  async start() {
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
    }, 15e3);
  }
  stop() {
    this.stopped = true;
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this.scanTimer) window.clearInterval(this.scanTimer);
    this.scanTimer = void 0;
    this.socket?.close();
    this.socket = void 0;
  }
  settingsChanged() {
    this.socket?.close();
    this.socket = void 0;
    this.activeConfiguration = "";
    this.scanRequested = true;
    if (this.ready()) void this.requestRun(true);
    else this.options.status(this.options.data().sessionToken ? "Syncdian: set up sync" : "Syncdian: login required");
  }
  syncNow() {
    if (this.ready()) void this.requestRun(true);
  }
  localChanged(path) {
    if (this.applyingRemote || !this.included(path)) return;
    this.pendingDeletes.delete(path);
    this.pendingPaths.add(path);
    this.schedule();
  }
  localDeleted(path) {
    if (this.applyingRemote || !this.included(path)) return;
    this.pendingPaths.delete(path);
    this.pendingDeletes.add(path);
    this.schedule();
  }
  localRenamed(path, oldPath) {
    if (this.applyingRemote || !this.included(path)) return;
    if (this.included(oldPath)) this.pendingDeletes.add(oldPath);
    this.pendingPaths.delete(oldPath);
    this.pendingPaths.add(path);
    this.schedule();
  }
  ready() {
    const data = this.options.data();
    return Boolean(data.sessionToken && data.activeVaultId);
  }
  schedule() {
    if (this.stopped || !this.options.data().autoSync) return;
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => void this.requestRun(false), 750);
  }
  async requestRun(scan) {
    if (this.stopped || !this.ready()) return;
    this.scanRequested || (this.scanRequested = scan);
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
      new import_obsidian2.Notice(`Syncdian: ${message}`, 8e3);
      console.error("Syncdian sync failed", caught);
    } finally {
      this.running = false;
    }
  }
  async cycle() {
    const data = this.options.data();
    const configuration = `${data.activeVaultId}|${data.sessionToken.slice(0, 12)}`;
    if (this.activeConfiguration !== configuration) {
      this.pendingPaths.clear();
      this.pendingDeletes.clear();
      this.scanRequested = true;
      this.activeConfiguration = configuration;
    }
    this.options.status("Syncdian: syncing\u2026");
    if (!this.options.state().initialized) await this.initializeRemote();
    else await this.catchUp();
    if (this.scanRequested) await this.scanLocal();
    await this.pushPending();
    await this.catchUp();
    await this.options.persist();
    this.connectWebSocket();
    this.options.status(`Syncdian: live \xB7 r${this.options.state().lastRevision}`);
    this.options.onSyncComplete?.();
  }
  async initializeRemote() {
    const manifest = await this.client.manifest();
    for (const file of manifest.files) await this.applyRemote(file);
    const state = this.options.state();
    state.initialized = true;
    state.lastRevision = manifest.revision;
    this.scanRequested = true;
    await this.options.persist();
  }
  async catchUp() {
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
  async scanLocal() {
    const state = this.options.state();
    const actualPaths = new Set(await this.listLocalFiles());
    for (const path of actualPaths) {
      const data = await this.options.app.vault.adapter.readBinary(path);
      const plainHash = await sha256(data);
      const synced = state.files[path];
      if (!synced || synced.deleted || synced.plainHash !== plainHash) this.pendingPaths.add(path);
    }
    for (const [path, synced] of Object.entries(state.files)) {
      if (!synced.deleted && !actualPaths.has(path)) this.pendingDeletes.add(path);
    }
    this.scanRequested = false;
  }
  async pushPending() {
    for (const path of Array.from(this.pendingDeletes).sort()) {
      const state = this.options.state();
      const synced = state.files[path];
      try {
        const result = await this.client.remove(path, synced?.version ?? 0);
        state.files[path] = { ...result.file, path, plainHash: synced?.plainHash ?? "" };
        state.lastRevision = Math.max(state.lastRevision, result.revision);
        this.pendingDeletes.delete(path);
        await this.options.persist();
      } catch (caught) {
        if (caught instanceof SyncError && caught.status === 409 && caught.payload.current) {
          await this.applyRemote(caught.payload.current);
          this.pendingDeletes.delete(path);
          this.scanRequested = true;
          await this.options.persist();
          continue;
        }
        throw caught;
      }
    }
    for (const path of Array.from(this.pendingPaths).sort()) {
      if (!await this.options.app.vault.adapter.exists(path)) {
        this.pendingPaths.delete(path);
        this.pendingDeletes.add(path);
        continue;
      }
      const state = this.options.state();
      const data = await this.options.app.vault.adapter.readBinary(path);
      const plainHash = await sha256(data);
      const synced = state.files[path];
      if (synced && !synced.deleted && synced.plainHash === plainHash) {
        this.pendingPaths.delete(path);
        continue;
      }
      try {
        await this.uploadData(path, data, synced?.version ?? 0);
        this.pendingPaths.delete(path);
        const latest = await this.options.app.vault.adapter.readBinary(path);
        if (await sha256(latest) !== plainHash) this.pendingPaths.add(path);
        await this.options.persist();
      } catch (caught) {
        if (caught instanceof SyncError && caught.status === 409 && caught.payload.current) {
          await this.applyRemote(caught.payload.current);
          this.pendingPaths.delete(path);
          this.scanRequested = true;
          await this.options.persist();
          continue;
        }
        throw caught;
      }
    }
  }
  async uploadData(path, data, baseVersion) {
    const state = this.options.state();
    const plainHash = await sha256(data);
    const result = await this.client.upload(path, data, baseVersion);
    state.files[path] = { ...result.file, plainHash };
    state.lastRevision = Math.max(state.lastRevision, result.revision);
  }
  async applyRemote(remote) {
    const path = this.validRemotePath(remote.path);
    const state = this.options.state();
    const synced = state.files[path];
    if (synced?.revision === remote.revision && synced.hash === remote.hash) return;
    const adapter = this.options.app.vault.adapter;
    const exists = await adapter.exists(path);
    const localData = exists ? await adapter.readBinary(path) : null;
    const localHash = localData ? await sha256(localData) : null;
    if (remote.deleted) {
      if (localData && localHash !== synced?.plainHash) {
        await this.uploadData(path, localData, remote.version);
      } else {
        if (exists) await this.removeLocal(path);
        state.files[path] = { ...remote, path, plainHash: synced?.plainHash ?? "" };
      }
      return;
    }
    const remoteData = await this.client.download(remote.id, remote.hash);
    const remotePlainHash = await sha256(remoteData);
    if (localHash === remotePlainHash) {
      state.files[path] = { ...remote, path, plainHash: remotePlainHash };
      return;
    }
    if (!localData || synced && localHash === synced.plainHash) {
      await this.writeLocal(path, remoteData);
      state.files[path] = { ...remote, path, plainHash: remotePlainHash };
      return;
    }
    const baseData = synced?.hash ? await this.client.download(remote.id, synced.hash) : new ArrayBuffer(0);
    if (isTextPath(path)) {
      const merged = mergeText(localData, baseData, remoteData);
      const mergedHash = await sha256(merged.data);
      if (mergedHash === remotePlainHash) {
        await this.writeLocal(path, remoteData);
        state.files[path] = { ...remote, path, plainHash: remotePlainHash };
      } else {
        await this.writeLocal(path, merged.data);
        await this.uploadData(path, merged.data, remote.version);
      }
      if (merged.conflict) new import_obsidian2.Notice(`Syncdian: conflict markers added to ${path}`, 8e3);
    } else {
      await this.createConflictCopy(path, localData);
      await this.writeLocal(path, remoteData);
      state.files[path] = { ...remote, path, plainHash: remotePlainHash };
    }
  }
  async createConflictCopy(path, data) {
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
    new import_obsidian2.Notice(`Syncdian: local binary version preserved as ${candidate}`, 8e3);
  }
  async writeLocal(path, data) {
    await this.ensureParentFolder(path);
    this.applyingRemote += 1;
    try {
      await this.options.app.vault.adapter.writeBinary(path, data);
    } finally {
      this.applyingRemote -= 1;
    }
  }
  async removeLocal(path) {
    this.applyingRemote += 1;
    try {
      await this.options.app.vault.adapter.remove(path);
    } finally {
      this.applyingRemote -= 1;
    }
  }
  async ensureParentFolder(path) {
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
  async listLocalFiles() {
    const files = [];
    const visit = async (folder) => {
      const listing = await this.options.app.vault.adapter.list(folder);
      for (const file of listing.files) {
        const path = (0, import_obsidian2.normalizePath)(file);
        if (this.included(path)) files.push(path);
      }
      for (const child of listing.folders) {
        const path = (0, import_obsidian2.normalizePath)(child);
        if (this.includedFolder(path)) await visit(path);
      }
    };
    await visit("");
    return files;
  }
  includedFolder(path) {
    if (path === ".trash" || path.startsWith(".trash/")) return false;
    if (path === ".obsidian/plugins/syncdian" || path.startsWith(".obsidian/plugins/syncdian/")) return false;
    if (path === ".obsidian") return true;
    if ([".obsidian/plugins", ".obsidian/themes", ".obsidian/snippets"].includes(path)) return true;
    if (path.startsWith(".obsidian/")) {
      return path.startsWith(".obsidian/plugins/") || path.startsWith(".obsidian/themes/") || path.startsWith(".obsidian/snippets/");
    }
    return true;
  }
  included(path) {
    if (!path || path === ".trash" || path.startsWith(".trash/")) return false;
    if (!path.startsWith(".obsidian/")) return true;
    if (path.startsWith(".obsidian/plugins/syncdian/")) return false;
    const relative = path.slice(".obsidian/".length);
    return CONFIG_FILES.has(relative) || relative.startsWith("plugins/") || relative.startsWith("themes/") || relative.startsWith("snippets/");
  }
  validRemotePath(path) {
    const normalized = (0, import_obsidian2.normalizePath)(path);
    if (!normalized || normalized.startsWith("/") || normalized.includes("\\") || normalized.includes("\0") || normalized.split("/").some((part) => part === ".." || part === ".") || !this.included(normalized)) throw new Error("Remote path failed validation");
    return normalized;
  }
  connectWebSocket() {
    if (this.stopped || this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    const socket = this.client.openWebSocket(
      (file) => {
        if (file.revision > this.options.state().lastRevision) void this.requestRun(false);
      },
      () => this.options.status(`Syncdian: live \xB7 r${this.options.state().lastRevision}`),
      () => {
        if (this.socket === socket) this.socket = void 0;
        if (!this.stopped) this.reconnectTimer = window.setTimeout(() => void this.requestRun(false), 5e3);
      }
    );
    this.socket = socket;
  }
};

// src/types.ts
var EMPTY_DATA = {
  sessionToken: "",
  user: null,
  activeVaultId: "",
  deviceId: "",
  autoSync: true,
  vaultKeys: {},
  states: {}
};

// src/main.ts
var SyncdianPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.cloudVaults = [];
    this.plan = null;
    this.challenge = null;
    this.loginInProgress = false;
  }
  async onload() {
    var _a;
    const saved = await this.loadData();
    this.data = {
      ...EMPTY_DATA,
      ...saved,
      vaultKeys: saved?.vaultKeys ?? {},
      states: saved?.states ?? {},
      user: saved?.user ?? null
    };
    (_a = this.data).deviceId || (_a.deviceId = crypto.randomUUID());
    this.client = new SyncClient(() => this.data);
    this.statusBar = this.addStatusBarItem();
    this.statusBar.setText(this.data.sessionToken ? "Syncdian: set up sync" : "Syncdian: login required");
    this.statusBar.style.cursor = "pointer";
    this.statusBar.setAttribute("title", "Click to continue Syncdian setup or sync now");
    this.statusBar.addEventListener("click", () => void this.handleStatusClick());
    this.engine = new SyncEngine({
      app: this.app,
      data: () => this.data,
      state: () => this.activeState(),
      persist: () => this.persist(),
      status: (text) => this.statusBar.setText(text),
      onSyncComplete: () => void this.refreshUsage()
    });
    this.settingsTab = new SyncdianSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);
    this.addCommand({ id: "sync-now", name: "Sync now", callback: () => this.engine.syncNow() });
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof import_obsidian3.TFile) this.engine.localChanged(file.path);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof import_obsidian3.TFile) this.engine.localChanged(file.path);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof import_obsidian3.TFile) this.engine.localDeleted(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof import_obsidian3.TFile) this.engine.localRenamed(file.path, oldPath);
    }));
    await this.persist();
    this.app.workspace.onLayoutReady(() => void this.engine.start());
    if (this.data.sessionToken) void this.refreshVaults();
  }
  onunload() {
    this.engine?.stop();
  }
  async persist() {
    await this.saveData(this.data);
  }
  syncNow() {
    this.engine.syncNow();
  }
  activeState() {
    var _a;
    const id = this.data.activeVaultId || "default";
    (_a = this.data.states)[id] || (_a[id] = { initialized: false, lastRevision: 0, files: {} });
    return this.data.states[id];
  }
  refreshDisplay() {
    this.settingsTab?.display();
  }
  async login() {
    if (this.loginInProgress) return;
    this.loginInProgress = true;
    try {
      this.challenge = await this.client.startLogin();
      this.refreshDisplay();
      const challenge = this.challenge;
      window.open(challenge.verificationUriComplete ?? challenge.verificationUri, "_blank");
      const interval = Math.max(challenge.interval, 5);
      const deadline = Date.now() + challenge.expiresIn * 1e3;
      while (Date.now() < deadline && this.challenge === challenge) {
        await new Promise((resolve) => setTimeout(resolve, interval * 1e3));
        const result = await this.client.pollLogin(challenge.deviceCode);
        if (result.status === "complete" && result.sessionToken && result.user) {
          this.data.sessionToken = result.sessionToken;
          this.data.user = result.user;
          this.data.activeVaultId = "";
          this.statusBar.setText("Syncdian: set up sync");
          this.challenge = null;
          await this.persist();
          await this.refreshVaults();
          this.refreshDisplay();
          new import_obsidian3.Notice(`Syncdian: logged in as ${result.user.login}`);
          return;
        }
        if (result.status === "denied") throw new Error("GitHub login was denied or expired");
      }
      throw new Error("GitHub login expired");
    } catch (caught) {
      new import_obsidian3.Notice(`Syncdian: ${caught instanceof Error ? caught.message : "Login failed"}`, 8e3);
    } finally {
      this.loginInProgress = false;
      this.challenge = null;
      this.refreshDisplay();
    }
  }
  async refreshVaults() {
    if (!this.data.sessionToken) return;
    try {
      const result = await this.client.listVaults();
      this.cloudVaults = result.vaults;
      this.plan = result.plan;
      this.data.user = result.user;
      if (result.vaults.length === 0) {
        await this.createVault();
        return;
      }
      if (result.plan.maxVaults === 1) {
        const changed = this.data.activeVaultId !== result.vaults[0].id;
        this.data.activeVaultId = result.vaults[0].id;
        await this.persist();
        if (changed) this.restartEngine();
      } else if (!result.vaults.some((vault) => vault.id === this.data.activeVaultId)) {
        this.data.activeVaultId = "";
        this.statusBar.setText("Syncdian: choose vault");
        await this.persist();
      }
      this.refreshDisplay();
    } catch (caught) {
      console.error("Syncdian could not initialize vaults", caught);
      new import_obsidian3.Notice(`Syncdian: ${caught instanceof Error ? caught.message : "Could not initialize vault"}`, 8e3);
    }
  }
  async refreshUsage() {
    if (!this.data.sessionToken) return;
    try {
      const result = await this.client.listVaults();
      this.cloudVaults = result.vaults;
      this.plan = result.plan;
      this.refreshDisplay();
    } catch {
    }
  }
  async createVault() {
    if (!this.data.sessionToken) return;
    try {
      const vault = await this.client.createVault(this.app.vault.getName());
      this.data.activeVaultId = vault.id;
      this.data.states[vault.id] = { initialized: false, lastRevision: 0, files: {} };
      await this.persist();
      await this.refreshUsage();
      this.restartEngine();
      this.refreshDisplay();
    } catch (caught) {
      new import_obsidian3.Notice(`Syncdian: ${caught instanceof Error ? caught.message : "Could not create vault"}`, 8e3);
    }
  }
  async selectVault(vaultId) {
    if (!vaultId) return;
    this.data.activeVaultId = vaultId;
    await this.persist();
    this.restartEngine();
    this.refreshDisplay();
  }
  async logout() {
    this.engine.stop();
    try {
      await this.client.logout();
    } catch {
    }
    this.data.sessionToken = "";
    this.data.user = null;
    this.data.activeVaultId = "";
    this.data.vaultKeys = {};
    this.cloudVaults = [];
    this.plan = null;
    await this.persist();
    this.statusBar.setText("Syncdian: login required");
    this.refreshDisplay();
  }
  async handleStatusClick() {
    if (!this.data.sessionToken) {
      await this.login();
      return;
    }
    if (!this.data.activeVaultId) {
      const setting = this.app.setting;
      setting.open();
      setting.openTabById(this.manifest.id);
      return;
    }
    this.engine.syncNow();
  }
  restartEngine() {
    this.engine.stop();
    void this.engine.start();
  }
};
var SyncdianSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.selectedVaultId = "";
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Syncdian" });
    containerEl.createEl("p", { text: "Secure vault, settings, themes, and plugin synchronization across your devices." });
    if (!this.plugin.data.sessionToken) {
      new import_obsidian3.Setting(containerEl).setName("GitHub account").setDesc("Login once and synchronization starts automatically.").addButton((button) => button.setButtonText("Login with GitHub").setCta().onClick(() => void this.plugin.login()));
      if (this.plugin.challenge) {
        new import_obsidian3.Setting(containerEl).setName("GitHub verification").setDesc(`Enter code ${this.plugin.challenge.userCode} in the browser.`).addButton((button) => button.setButtonText("Open GitHub").onClick(() => {
          if (this.plugin.challenge) window.open(this.plugin.challenge.verificationUriComplete ?? this.plugin.challenge.verificationUri, "_blank");
        }));
      }
      return;
    }
    new import_obsidian3.Setting(containerEl).setName("GitHub account").setDesc(`Logged in as @${this.plugin.data.user?.login ?? "unknown"}`).addButton((button) => button.setButtonText("Logout").onClick(() => void this.plugin.logout()));
    const active = this.plugin.cloudVaults.find((vault) => vault.id === this.plugin.data.activeVaultId);
    if (active) {
      containerEl.createEl("p", { text: `Syncing \u201C${active.name}\u201D.` });
      new import_obsidian3.Setting(containerEl).setName("Sync now").addButton((button) => button.setButtonText("Sync now").setCta().onClick(() => this.plugin.syncNow()));
    }
    const plan = this.plugin.plan;
    if (plan && plan.maxVaults > 1) {
      this.selectedVaultId || (this.selectedVaultId = this.plugin.data.activeVaultId || this.plugin.cloudVaults[0]?.id || "");
      new import_obsidian3.Setting(containerEl).setName("Vault").setDesc("Choose which synced vault to use on this device.").addDropdown((dropdown) => {
        for (const vault of this.plugin.cloudVaults) dropdown.addOption(vault.id, vault.name);
        dropdown.setValue(this.selectedVaultId).onChange((value) => {
          this.selectedVaultId = value;
        });
      }).addButton((button) => button.setButtonText("Use vault").onClick(() => void this.plugin.selectVault(this.selectedVaultId)));
      if (this.plugin.cloudVaults.length < plan.maxVaults) {
        new import_obsidian3.Setting(containerEl).setName("New vault").setDesc(`${this.plugin.cloudVaults.length} of ${plan.maxVaults} vaults used.`).addButton((button) => button.setButtonText("Create new vault").onClick(() => void this.plugin.createVault()));
      }
    }
    if (plan) {
      const percentage = Math.min(100, Math.round(plan.usedBytes / plan.storageQuotaBytes * 100));
      const setting = new import_obsidian3.Setting(containerEl).setName("Storage").setDesc(`${formatBytes(plan.usedBytes)} of ${formatBytes(plan.storageQuotaBytes)} used (${percentage}%).`);
      const progress = setting.controlEl.createEl("progress");
      progress.max = plan.storageQuotaBytes;
      progress.value = plan.usedBytes;
      progress.style.width = "100%";
      new import_obsidian3.Setting(containerEl).setName("Need more storage?").setDesc("Email us with your account and current usage.").addButton((button) => button.setButtonText("Need more storage").onClick(() => {
        const subject = encodeURIComponent("Syncdian storage upgrade");
        const body = encodeURIComponent(`Hi Vayazka,

I need more Syncdian storage.
GitHub: @${this.plugin.data.user?.login ?? "unknown"}
Usage: ${formatBytes(plan.usedBytes)} of ${formatBytes(plan.storageQuotaBytes)}
`);
        window.open(`mailto:helo@vayazka.com?subject=${subject}&body=${body}`, "_blank");
      }));
    }
    new import_obsidian3.Setting(containerEl).setName("Automatic sync").addToggle((toggle) => toggle.setValue(this.plugin.data.autoSync).onChange((value) => {
      this.plugin.data.autoSync = value;
      void this.plugin.persist();
    }));
  }
};
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
