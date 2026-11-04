import { requestUrl, type RequestUrlResponse } from "obsidian";
import { bytesToBase64 } from "./crypto";
import type { CloudVault, DeviceChallenge, PluginData, RemoteFile, StoragePlan, UserProfile } from "./types";

const API_URLS = ["https://api.syncdian.com", "https://syncdian.maslulsaefulloh.workers.dev"];

export class SyncError extends Error {
  constructor(message: string, public readonly status: number, public readonly payload: any) {
    super(message);
  }
}

export class SyncClient {
  private activeApiUrl = API_URLS[0];

  constructor(private readonly data: () => PluginData) {}

  startLogin(): Promise<DeviceChallenge> {
    return this.expectJson(this.publicRequest("POST", "/auth/device/start"));
  }

  async pollLogin(deviceCode: string): Promise<{ status: string; sessionToken?: string; user?: UserProfile }> {
    const response = await this.publicRequest("POST", "/auth/device/poll", { deviceCode });
    if (response.status === 202) return { status: "pending" };
    return this.expectJson(response);
  }

  async logout(): Promise<void> {
    await this.request("POST", "/auth/logout");
  }

  async listVaults(): Promise<{ user: UserProfile; plan: StoragePlan; vaults: CloudVault[] }> {
    return this.expectJson(await this.request("GET", "/v1/vaults"));
  }

  async createVault(name: string): Promise<CloudVault> {
    const response = await this.expectJson(await this.request("POST", "/v1/vaults", { name }));
    return response.vault;
  }

  async manifest(): Promise<{ revision: number; files: RemoteFile[] }> {
    return this.expectJson(await this.request("GET", "/v1/manifest"));
  }

  async changes(since: number): Promise<{ revision: number; changes: RemoteFile[]; hasMore: boolean }> {
    return this.expectJson(await this.request("GET", `/v1/changes?since=${since}`));
  }

  async download(id: string, hash?: string): Promise<ArrayBuffer> {
    const response = await this.request("GET", `/v1/file?id=${id}${hash ? `&hash=${hash}` : ""}`);
    if (response.status >= 400) this.throwResponse(response);
    return response.arrayBuffer;
  }

  async upload(path: string, body: ArrayBuffer, baseVersion: number): Promise<{ file: RemoteFile; revision: number }> {
    const response = await this.request("PUT", "/v1/file", undefined, body, {
      "X-File-Path": bytesToBase64(new TextEncoder().encode(path)),
      "X-Base-Version": String(baseVersion),
      "Content-Type": "application/octet-stream",
    });
    if (response.status >= 400) this.throwResponse(response);
    return this.expectJson(response);
  }

  async remove(path: string, baseVersion: number): Promise<{ file: RemoteFile; revision: number }> {
    const response = await this.request("DELETE", "/v1/file", undefined, undefined, {
      "X-File-Path": bytesToBase64(new TextEncoder().encode(path)),
      "X-Base-Version": String(baseVersion),
    });
    if (response.status >= 400) this.throwResponse(response);
    return this.expectJson(response);
  }

  openWebSocket(onChange: (file: RemoteFile) => void, onOpen: () => void, onClose: () => void): WebSocket {
    const data = this.data();
    const url = `${this.activeApiUrl.replace(/^https:/, "wss:")}/v1/ws?vaultId=${encodeURIComponent(data.activeVaultId)}`;
    const socket = new WebSocket(url, ["syncdian.v1", `auth.${data.sessionToken}`]);
    socket.onopen = onOpen;
    socket.onclose = onClose;
    socket.onerror = () => socket.close();
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "change" && message.file) onChange(message.file);
      } catch { /* change log remains authoritative */ }
    };
    return socket;
  }

  private async publicRequest(method: "POST", path: string, body?: unknown): Promise<RequestUrlResponse> {
    let lastError: unknown;
    for (const baseUrl of this.apiCandidates()) {
      try {
        const response = await requestUrl({ url: `${baseUrl}${path}`, method, body: body ? JSON.stringify(body) : undefined, contentType: "application/json", throw: false });
        this.activeApiUrl = baseUrl;
        return response;
      } catch (caught) {
        lastError = caught;
      }
    }
    throw lastError;
  }

  private async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    jsonBody?: unknown,
    body?: ArrayBuffer,
    headers: Record<string, string> = {},
  ): Promise<RequestUrlResponse> {
    const data = this.data();
    const separator = path.includes("?") ? "&" : "?";
    const needsVault = path.startsWith("/v1/file") || path.startsWith("/v1/manifest") || path.startsWith("/v1/changes");
    const vaultQuery = needsVault ? `${separator}vaultId=${encodeURIComponent(data.activeVaultId)}` : "";
    let lastError: unknown;
    for (const baseUrl of this.apiCandidates()) {
      try {
        const response = await requestUrl({
          url: `${baseUrl}${path}${vaultQuery}`,
          method,
          body: body ?? (jsonBody ? JSON.stringify(jsonBody) : undefined),
          contentType: headers["Content-Type"] ?? (jsonBody ? "application/json" : undefined),
          headers: {
            Authorization: `Bearer ${data.sessionToken}`,
            "X-Device-Id": data.deviceId,
            ...headers,
          },
          throw: false,
        });
        this.activeApiUrl = baseUrl;
        return response;
      } catch (caught) {
        lastError = caught;
      }
    }
    throw lastError;
  }

  private apiCandidates(): string[] {
    return [this.activeApiUrl, ...API_URLS.filter((url) => url !== this.activeApiUrl)];
  }

  private async expectJson(response: RequestUrlResponse | Promise<RequestUrlResponse>): Promise<any> {
    const resolved = await response;
    if (resolved.status >= 400) this.throwResponse(resolved);
    return resolved.json;
  }

  private throwResponse(response: RequestUrlResponse): never {
    const payload = response.json ?? {};
    throw new SyncError(payload.error ?? `Request failed (${response.status})`, response.status, payload);
  }
}
