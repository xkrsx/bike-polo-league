import { connection } from "next/server";
import { readFile } from "node:fs/promises";
import { isStoredRefSheetName, refSheetFileLocations } from "@/lib/ref-sheet-storage";

const CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ file: string }> },
) {
  await connection();
  const { file } = await context.params;

  if (!isStoredRefSheetName(file)) {
    return new Response("Not found", { status: 404 });
  }

  const extension = file.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPE[extension];

  if (!contentType) {
    return new Response("Not found", { status: 404 });
  }

  for (const filePath of refSheetFileLocations(file)) {
    try {
      const bytes = await readFile(filePath);

      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      continue;
    }
  }

  return new Response("Not found", { status: 404 });
}
