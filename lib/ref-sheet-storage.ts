import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_REF_SHEET_BYTES = 8 * 1024 * 1024;

const ACCEPTED_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const TYPE_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/heic-sequence": "image/heic",
  "image/heif-sequence": "image/heif",
};

const EXTENSION_TYPES: Record<string, string> = {
  heic: "image/heic",
  heif: "image/heif",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const FILE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp|gif)$/i;

const PHOTO_ERROR = "Upload a HEIC, PNG, JPG, WEBP, or GIF photo of the ref sheet.";

export function imageTypeForUpload(file: { type: string; name: string }): string | null {
  const raw = file.type.toLowerCase().split(";")[0]?.trim() ?? "";
  const aliased = TYPE_ALIASES[raw] ?? raw;

  if (ACCEPTED_TYPES.has(aliased)) {
    return aliased;
  }

  if (raw === "" || raw === "application/octet-stream") {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    return EXTENSION_TYPES[extension] ?? null;
  }

  return null;
}

export function refSheetDirectory(): string {
  return path.join(process.cwd(), "public", "uploads", "ref-sheets");
}

export function legacyRefSheetDirectory(): string {
  return path.join(process.cwd(), "data", "ref-sheets");
}

export function refSheetPublicUrl(filename: string): string {
  return `/uploads/ref-sheets/${filename}`;
}

export function isStoredRefSheetName(filename: string): boolean {
  return FILE_NAME.test(filename);
}

export function refSheetFileLocations(filename: string): string[] {
  if (!isStoredRefSheetName(filename)) {
    return [];
  }

  return [
    path.join(refSheetDirectory(), filename),
    path.join(legacyRefSheetDirectory(), filename),
  ];
}

export function validateRefSheetFile(
  file: FormDataEntryValue | null,
): { ok: true; file: File } | { ok: false; error: string; status: number } {
  if (!(file instanceof File) || file.size <= 0) {
    return { ok: false, error: "Choose a ref sheet photo.", status: 400 };
  }

  if (!imageTypeForUpload(file)) {
    return { ok: false, error: PHOTO_ERROR, status: 400 };
  }

  if (file.size > MAX_REF_SHEET_BYTES) {
    return { ok: false, error: "Ref sheet photos must be 8 MB or smaller.", status: 413 };
  }

  return { ok: true, file };
}

export async function saveRefSheetImage(file: File): Promise<string> {
  const { refSheetFileToJpeg } = await import("@/lib/ref-sheet-image");
  const jpeg = await refSheetFileToJpeg(file);
  const filename = `${randomUUID()}.jpg`;
  const directory = refSheetDirectory();
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), jpeg);

  return refSheetPublicUrl(filename);
}

export function storedRefSheetFile(url: string): string | null {
  const pathname = url.split("?")[0] ?? "";
  const filename = decodeURIComponent(pathname.split("/").pop() ?? "");

  if (!isStoredRefSheetName(filename)) {
    return null;
  }

  if (pathname.includes("/uploads/ref-sheets/")) {
    return path.join(refSheetDirectory(), filename);
  }

  if (pathname.includes("/api/ref-sheets/files/")) {
    return path.join(legacyRefSheetDirectory(), filename);
  }

  return null;
}

export async function removeStoredRefSheet(url: string | null): Promise<void> {
  if (!url) {
    return;
  }

  const filePath = storedRefSheetFile(url);

  if (!filePath) {
    return;
  }

  await unlink(filePath).catch(() => undefined);
}
