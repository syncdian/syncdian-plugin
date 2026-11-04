import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import esbuild from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "syncdian-merge-"));
try {
  const output = join(directory, "merge.mjs");
  await esbuild.build({ entryPoints: ["src/merge.ts"], bundle: true, platform: "node", format: "esm", outfile: output });
  const { mergeText, isTextPath } = await import(output);
  const encode = (text) => new TextEncoder().encode(text).buffer;
  const decode = (data) => new TextDecoder().decode(data);

  const base = encode("title\nfirst\nsecond\nthird\n");
  const local = encode("title\nfirst edited locally\nsecond\nthird\n");
  const remote = encode("title\nfirst\nsecond\nthird edited remotely\n");
  const merged = mergeText(local, base, remote);
  assert.equal(merged.conflict, false);
  assert.equal(decode(merged.data), "title\nfirst edited locally\nsecond\nthird edited remotely\n");

  const conflict = mergeText(encode("local"), encode("base"), encode("remote"));
  assert.equal(conflict.conflict, true);
  assert.ok(decode(conflict.data).includes("<<<<<<< Local"));
  assert.ok(decode(conflict.data).includes(">>>>>>> Remote"));
  assert.equal(isTextPath("note.md"), true);
  assert.equal(isTextPath("image.png"), false);
  console.log("Merge tests passed: non-overlapping edits merge automatically; overlaps preserve both sides with markers.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
