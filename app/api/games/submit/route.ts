import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { readMatchedRefSheets } from "@/lib/read-ref-sheet";
import { RefSheetImageError, refSheetFileToJpeg } from "@/lib/ref-sheet-image";
import type { MatchedRefGame } from "@/lib/ref-sheet-match";
import { isPlausiblePlayerName } from "@/lib/ref-sheet-ocr";
import { validateRefSheetFile } from "@/lib/ref-sheet-storage";

function presentGames(games: MatchedRefGame[]): MatchedRefGame[] {
  return games
    .map((game) => ({
      ...game,
      notes: game.notes.filter((note) => !/was left off/i.test(note)),
      referees: game.referees.filter((person) => isPlausiblePlayerName(person.rawName)),
      teamA: game.teamA.filter((person) => isPlausiblePlayerName(person.rawName)),
      teamB: game.teamB.filter((person) => isPlausiblePlayerName(person.rawName)),
    }))
    .filter(
      (game) =>
        game.referees.length > 0 ||
        game.teamA.length > 0 ||
        game.teamB.length > 0 ||
        game.scoreTeamA !== null ||
        game.scoreTeamB !== null,
    );
}

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
    const games = presentGames(await readMatchedRefSheets(jpeg, players));

    return Response.json({
      games,
      message:
        games.length === 0
          ? "No filled match cards were found on this sheet."
          : undefined,
    });
  } catch (error) {
    if (error instanceof RefSheetImageError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    console.error(error);

    return Response.json(
      { error: "Could not read this ref sheet. Enter the games by hand." },
      { status: 500 },
    );
  }
}
