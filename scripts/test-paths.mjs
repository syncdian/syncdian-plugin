import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import esbuild from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "syncdian-paths-"));
try {
  const output = join(directory, "paths.mjs");
  await esbuild.build({ entryPoints: ["src/paths.ts"], bundle: true, platform: "node", format: "esm", outfile: output });
  const { androidSafePath, isMissingFileError } = await import(output);
  assert.equal(androidSafePath("1o1 Saeful >< Rey.md"), "1o1 Saeful %3E%3C Rey.md");
  assert.equal(androidSafePath("folder:name/note?.md"), "folder%3Aname/note%3F.md");
  assert.equal(androidSafePath("folder /note. "), "folder%20/note.%20");
  assert.equal(androidSafePath("normal/note.md"), "normal/note.md");
  assert.equal(isMissingFileError(new Error("FILE_NOTEXIST")), true);
  assert.equal(isMissingFileError(new Error("ENOENT: no such file")), true);
  assert.equal(isMissingFileError(new Error("permission denied")), false);
  console.log("Path tests passed: Android aliases and missing-file race handling.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
