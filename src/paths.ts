export function isMissingFileError(caught: unknown): boolean {
  const message = caught instanceof Error ? caught.message : String(caught);
  return /FILE_NOTEXIST|ENOENT|no such file|file (?:does not exist|not exist)/i.test(message);
}

export function androidSafePath(path: string): string {
  return path.split("/").map((segment) => segment
    .replace(/[<>:"\\|?*\x00-\x1F]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
    )
    .replace(/[. ]$/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
    )
  ).join("/");
}
