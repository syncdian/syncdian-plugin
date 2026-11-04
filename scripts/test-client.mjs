import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import esbuild from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "syncdian-client-"));
try {
  const mock = join(directory, "obsidian.mjs");
  const output = join(directory, "client.mjs");
  await writeFile(mock, "export async function requestUrl(options) { return globalThis.__syncdianRequest(options); }\n");
  await esbuild.build({
    entryPoints: ["src/client.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    plugins: [{
      name: "obsidian-mock",
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: mock }));
      },
    }],
  });
  const { SyncClient } = await import(output);
  const requests = [];
  globalThis.__syncdianRequest = async (options) => {
    requests.push(options);
    return { status: 200, json: { revision: 0, changes: [], files: [], hasMore: false }, headers: {}, arrayBuffer: new ArrayBuffer(0), text: "" };
  };
  const vaultId = "3033062b-a4ec-43de-9349-75ebdbe91d18";
  const client = new SyncClient(() => ({
    sessionToken: "test-session",
    user: null,
    activeVaultId: vaultId,
    deviceId: "test-device-123",
    autoSync: true,
    vaultKeys: {},
    states: {},
  }));

  await client.changes(12);
  const url = new URL(requests[0].url);
  assert.equal(url.pathname, "/v1/changes");
  assert.equal(url.searchParams.get("since"), "12");
  assert.equal(url.searchParams.get("vaultId"), vaultId);

  await client.manifest();
  assert.equal(new URL(requests[1].url).searchParams.get("vaultId"), vaultId);

  await client.download("a".repeat(64), "b".repeat(64));
  const historicalUrl = new URL(requests[2].url);
  assert.equal(historicalUrl.searchParams.get("hash"), "b".repeat(64));
  assert.equal(historicalUrl.searchParams.get("vaultId"), vaultId);

  globalThis.__syncdianRequest = async (options) => {
    requests.push(options);
    if (requests.length === 4) throw new Error("getaddrinfo ENOTFOUND api.syncdian.com");
    return { status: 200, json: { revision: 0, changes: [], files: [], hasMore: false }, headers: {}, arrayBuffer: new ArrayBuffer(0), text: "" };
  };
  await client.manifest();
  assert.ok(requests[4].url.startsWith("https://syncdian.maslulsaefulloh.workers.dev/"));
  console.log("Client URL tests passed: vault IDs, historical hashes, and DNS fallback.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
