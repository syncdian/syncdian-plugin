import { cp, mkdir, readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const output = `release/${manifest.id}`;
await mkdir(output, { recursive: true });
await Promise.all([
  cp("main.js", `${output}/main.js`),
  cp("manifest.json", `${output}/manifest.json`),
]);
console.log(`Packaged ${output}`);
