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

export interface MaterialImportResult {
  material: MaterialPayload | null;
  reader: FileReaderResponse | null;
}

type PathMaterial = File & { path?: string };
const pendingPathImports = new Set<string>();
const PARSING_OVERVIEW = "\u7d20\u6750\u89e3\u6790\u4e2d";
const FALLBACK_OVERVIEW = "\u7d20\u6750\u89e3\u6790\u5931\u8d25\uff0c\u5df2\u4fdd\u7559\u539f\u6587\u4ef6";

function isAuthExpiredError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("登录已失效");
}

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
      indexEmbeddings: true,
    });
  } catch (error) {
    if (isAuthExpiredError(error)) {
      throw error;
    }
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
    if (isAuthExpiredError(error)) {
      throw error;
    }
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
    if (isAuthExpiredError(error)) {
      throw error;
    }
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
      mimeType: file.type || parts.mimeType,
      dataUrl,
      overview: result ? result.summary?.trim() || "" : FALLBACK_OVERVIEW,
      extractedText: result?.text || "",
      remoteFileId: result?.file_id || null,
    });
    if (saved) return saved;
  } catch (error) {
    if (isAuthExpiredError(error)) {
      throw error;
    }
    console.error("[materialImport] file save failed", error);
  }

  await showReadyFallback(name, kind, file.size, file.type || parts.mimeType, name);
  return null;
}

export async function importPathSilentWithReader(
  path: string,
  fileName?: string,
): Promise<MaterialImportResult> {
  const trimmed = path.trim();
  if (!trimmed) return { material: null, reader: null };
  const name = fileName || trimmed.split(/[\\/]/).pop() || "document";
  const result = await parsePath(trimmed, name);
  try {
    const saved = await invoke<MaterialPayload | null>("save_file_to_material_silent", {
      path: trimmed,
      overview: result ? result.summary?.trim() || "" : FALLBACK_OVERVIEW,
      extractedText: result?.text || "",
      remoteFileId: result?.file_id || null,
    });
    return { material: saved, reader: result };
  } catch (error) {
    if (isAuthExpiredError(error)) {
      throw error;
    }
    console.error("[materialImport] silent path import failed", error);
    return { material: null, reader: result };
  }
}

export async function importFileSilentWithReader(file: File): Promise<MaterialImportResult> {
  const path = filePath(file);
  if (path) {
    return importPathSilentWithReader(path, file.name || undefined);
  }

  const name = file.name || "document";
  const result = await parseFile(file, name, file.type);
  const dataUrl = await readFileAsDataUrl(file);
  const parts = dataUrl ? dataUrlParts(dataUrl) : undefined;
  if (!parts || !dataUrl) {
    return { material: null, reader: result };
  }

  try {
    const saved = await invoke<MaterialPayload | null>("save_file_data_url_to_material_silent", {
      name,
      mimeType: file.type || parts.mimeType,
      dataUrl,
      overview: result ? result.summary?.trim() || "" : FALLBACK_OVERVIEW,
      extractedText: result?.text || "",
      remoteFileId: result?.file_id || null,
    });
    return { material: saved, reader: result };
  } catch (error) {
    if (isAuthExpiredError(error)) {
      throw error;
    }
    console.error("[materialImport] silent file import failed", error);
    return { material: null, reader: result };
  }
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

// -----------------------------
// 新导入链路：只本地保存（不请求 fileReader，不打开 file info panel）
// -----------------------------

export async function importPathLocalOnly(path: string): Promise<MaterialPayload | null> {
  const trimmed = path.trim();
  if (!trimmed) return null;
  // 静默保存：后端负责复制到 workspace_dir + 写入 history/resources，并通过 history-appended 让素材区刷新
  return invoke<MaterialPayload | null>("save_file_to_material_silent", { path: trimmed });
}

export async function importFileLocalOnly(file: File): Promise<MaterialPayload | null> {
  const path = filePath(file);
  if (path) {
    return importPathLocalOnly(path);
  }

  const name = file.name || "document";
  const dataUrl = await readFileAsDataUrl(file);
  if (!dataUrl) return null;
  // data_url 里自带 mime；这里仍把 file.type 作为显式 mime_type 传给后端做兜底
  return invoke<MaterialPayload | null>("save_file_data_url_to_material_silent", {
    name,
    mimeType: file.type || "application/octet-stream",
    dataUrl,
  });
}
