import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { readSingleRefSheet } from "@/lib/read-ref-sheet";
import { RefSheetImageError, refSheetFileToJpeg } from "@/lib/ref-sheet-image";
import { validateRefSheetFile } from "@/lib/ref-sheet-storage";

export const maxDuration = 60;

export async function POST(request: Request) {
  await connection();
  const formData = await request.formData();
  const upload = validateRefSheetFile(formData.get("refSheet"));

  if (!upload.ok) {
    return Response.json({ error: upload.error }, { status: upload.status });
  }

  try {
    const jpeg = await refSheetFileToJpeg(upload.file);
    const players = await prisma.player.findMany({
      select: { id: true, name: true, isRookie: true },
      orderBy: { name: "asc" },
    });

    return Response.json(await readSingleRefSheet(jpeg, players));
  } catch (error) {
    if (error instanceof RefSheetImageError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    console.error(error);

    return Response.json(
      { error: "Could not read this ref sheet. Enter the game by hand." },
      { status: 500 },
    );
  }
}
