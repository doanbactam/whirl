import type JSZip from "jszip";

export async function loadZip(file: File): Promise<JSZip> {
  const { default: JSZip } = await import("jszip");
  return await JSZip.loadAsync(await file.arrayBuffer());
}

export async function zipText(
  zip: JSZip,
  path: string,
): Promise<string | null> {
  const entry = zip.file(path);
  return entry ? await entry.async("text") : null;
}

export function resolvePackagePath(sourcePath: string, target: string): string {
  const normalizedTarget = target.replace(/\\/g, "/");
  if (normalizedTarget.startsWith("/")) {
    return normalizePath(normalizedTarget.slice(1));
  }

  const baseDir = sourcePath.includes("/")
    ? sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1)
    : "";
  return normalizePath(`${baseDir}${normalizedTarget}`);
}

function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

