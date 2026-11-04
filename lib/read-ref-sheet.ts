import { MAX_GAMES_PER_SHEET } from "@/lib/match-sheet";
import type { PlayerCandidate } from "@/lib/player-match";
import { annotateRefSheet, matchFilledSheets, type MatchedRefGame } from "@/lib/ref-sheet-match";
import { collapseLocatedSheets, parseRefSheetOcr, type ParsedRefSheet } from "@/lib/ref-sheet-ocr";
import { recognizeRefSheet, recognizeRefSheetPage } from "@/lib/recognize-ref-sheet";
import { readRefSheetWithVision, visionConfigured } from "@/lib/ref-sheet-vision";

export async function readMatchedRefSheets(
  jpeg: Buffer,
  players: PlayerCandidate[],
): Promise<MatchedRefGame[]> {
  if (visionConfigured()) {
    const located = await readRefSheetWithVision(
      jpeg,
      players.map((player) => player.name),
    );

    return located
      .slice(0, MAX_GAMES_PER_SHEET)
      .map((item) => annotateRefSheet(item.region, item.sheet, players));
  }

  const page = await recognizeRefSheetPage(jpeg);

  return matchFilledSheets(page.text, page.words, players).slice(0, MAX_GAMES_PER_SHEET);
}

export async function readSingleRefSheet(
  jpeg: Buffer,
  players: PlayerCandidate[] = [],
): Promise<ParsedRefSheet> {
  if (visionConfigured()) {
    return collapseLocatedSheets(
      await readRefSheetWithVision(
        jpeg,
        players.map((player) => player.name),
      ),
    );
  }

  return parseRefSheetOcr(await recognizeRefSheet(jpeg));
}
