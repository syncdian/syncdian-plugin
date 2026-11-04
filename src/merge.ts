import { mergeDiff3 } from "node-diff3";

const TEXT_EXTENSIONS = new Set([
  "md", "txt", "json", "canvas", "css", "js", "ts", "csv", "yaml", "yml", "xml", "html", "svg",
]);

export function isTextPath(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(extension);
}

export function mergeText(local: ArrayBuffer, base: ArrayBuffer, remote: ArrayBuffer): { data: ArrayBuffer; conflict: boolean } {
  const decoder = new TextDecoder();
  const result = mergeDiff3(
    decoder.decode(local),
    decoder.decode(base),
    decoder.decode(remote),
    {
      stringSeparator: "\n",
      excludeFalseConflicts: true,
      label: { a: "Local", o: "Base", b: "Remote" },
    },
  );
  return { data: new TextEncoder().encode(result.result.join("\n")).buffer as ArrayBuffer, conflict: result.conflict };
}
