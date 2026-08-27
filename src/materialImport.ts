import { invoke } from "@tauri-apps/api/core";
import { apiClient, type FileReaderResponse } from "./api/authClient";

export interface MaterialPayload {
  kind: "file" | "text" | "image";
  status?: "parsing" | "ready";
  name: string;
  size_bytes?: number | null;
  mime_type?: string | null;
  display_size: string;
  overview?: string;
  type_placeholder: string;
  preview: string;
  file_id?: string | null;
}

type PathMaterial = File & { path?: string };
const pendingPathImports = new Set<string>();
const PARSING_OVERVIEW = "\u7d20\u6750\u89e3\u6790\u4e2d";
const FALLBACK_OVERVIEW = "\u7d20\u6750\u89e3\u6790\u5931\u8d25\uff0c\u5df2\u4fdd\u7559\u539f\u6587\u4ef6";

export function clipboardFileFromEvent(event: ClipboardEvent): File | undefined {
  const directFile = event.clipboardData?.files[0];
  if (directFile) return directFile;
  const item = Array.from(event.clipboardData?.items ?? []).find(
    (candidate) => candidate.kind === "file",
  );
  return item?.getAsFile() ?? undefined;
}

function filePath(file: File): string | undefined {
  const path = (file as PathMaterial).path?.trim();
  return path || undefined;
}

function readFileAsDataUrl(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : undefined);
    });
    reader.addEventListener("error", () => resolve(undefined));
    reader.readAsDataURL(file);
  });
}

function dataUrlParts(dataUrl: string): { mimeType: string; base64: string } | undefined {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s);
  if (!match) return undefined;
  return {
    mimeType: match[1] || "application/octet-stream",
    base64: match[2],
  };
}

function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0 || value >= 10) return `${Math.round(value)} ${units[unit]}`;
  return `${value.toFixed(1)} ${units[unit]}`;
}

function kindForFile(fileName: string, mimeType?: string | null): "file" | "image" {
  if (
    mimeType?.startsWith("image/") ||
    /\.(avif|bmp|gif|heic|jpe?g|png|svg|webp)$/i.test(fileName)
  ) {
    return "image";
  }
  return "file";
}

async function showParsingState(
  name: string,
  kind: "file" | "image",
  sizeBytes: number | null,
  mimeType: string | null | undefined,
  preview: string,
): Promise<void> {
  await invoke("show_file_info", {
    payload: {
      status: "parsing",
      kind,
      name,
      size_bytes: sizeBytes,
      mime_type: mimeType || null,
      display_size: sizeBytes == null ? "" : formatFileSize(sizeBytes),
      overview: PARSING_OVERVIEW,
      type_placeholder: "",
      preview,
    },
  });
}

async function showReadyFallback(
  name: string,
  kind: "file" | "image",
  sizeBytes: number | null,
  mimeType: string | null | undefined,
  preview: string,
): Promise<void> {
  await invoke("show_file_info", {
    payload: {
      status: "ready",
      kind,
      name,
      size_bytes: sizeBytes,
      mime_type: mimeType || null,
      display_size: sizeBytes == null ? "" : formatFileSize(sizeBytes),
      overview: FALLBACK_OVERVIEW,
      type_placeholder: "",
      preview,
      file_id: null,
    },
  });
}

export async function parseFile(
  file: Blob,
  fileName: string,
  mimeType?: string | null,
): Promise<FileReaderResponse | null> {
  try {
    return await apiClient.fileReader(file, fileName, mimeType, {
      aiSummary: true,
    });
  } catch (error) {
    console.error("[materialImport] file_reader failed", error);
    return null;
  }
}

export async function parsePath(path: string, fileName?: string): Promise<FileReaderResponse | null> {
  try {
    const dataUrl = await invoke<string | null>("read_file_data_url", { value: path });
    if (!dataUrl) return null;
    const parts = dataUrlParts(dataUrl);
    if (!parts) return null;
    const bytes = Uint8Array.from(atob(parts.base64), (char) => char.charCodeAt(0));
    return await parseFile(
      new Blob([bytes], { type: parts.mimeType }),
      fileName || path.split(/[\\/]/).pop() || "document",
      parts.mimeType,
    );
  } catch (error) {
    console.error("[materialImport] failed to read path for file_reader", error);
    return null;
  }
}

export async function importPath(path: string): Promise<MaterialPayload | null> {
  if (pendingPathImports.has(path)) return null;
  pendingPathImports.add(path);
  const name = path.split(/[\\/]/).pop() || "document";
  const kind = kindForFile(name);

  try {
    await showParsingState(name, kind, null, null, path);
    const result = await parsePath(path, name);
    const saved = await invoke<MaterialPayload | null>("save_file_to_material", {
      path,
      overview: result ? result.summary?.trim() || "" : FALLBACK_OVERVIEW,
      extracted_text: result?.text || "",
      remote_file_id: result?.file_id || null,
    });
    if (saved) return saved;
    await showReadyFallback(name, kind, null, null, path);
    return null;
  } catch (error) {
    console.error("[materialImport] path import failed", error);
    await showReadyFallback(name, kind, null, null, path).catch((fallbackError) =>
      console.error("[materialImport] failed to show path fallback", fallbackError),
    );
    return null;
  } finally {
    pendingPathImports.delete(path);
  }
}

export async function importFile(file: File): Promise<MaterialPayload | null> {
  const path = filePath(file);
  if (path) {
    return importPath(path);
  }

  const name = file.name || "document";
  const kind = kindForFile(name, file.type);
  await showParsingState(name, kind, file.size, file.type, name);
  const result = await parseFile(file, name, file.type);
  const dataUrl = await readFileAsDataUrl(file);
  const parts = dataUrl ? dataUrlParts(dataUrl) : undefined;

  if (!parts) {
    await showReadyFallback(name, kind, file.size, file.type, name);
    return null;
  }

  try {
    const saved = await invoke<MaterialPayload | null>("save_file_data_url_to_material", {
      name,
      mime_type: file.type || parts.mimeType,
      data_url: dataUrl,
      overview: result ? result.summary?.trim() || "" : FALLBACK_OVERVIEW,
      extracted_text: result?.text || "",
      remote_file_id: result?.file_id || null,
    });
    if (saved) return saved;
  } catch (error) {
    console.error("[materialImport] file save failed", error);
  }

  await showReadyFallback(name, kind, file.size, file.type || parts.mimeType, name);
  return null;
}

export async function importClipboardPayload(
  payload: MaterialPayload | null | undefined,
): Promise<MaterialPayload | null> {
  if (!payload) return null;
  if (payload.kind !== "image" && payload.kind !== "file") return payload;
  const path = payload.preview?.trim();
  if (!path) return payload;
  return importPath(path);
}
