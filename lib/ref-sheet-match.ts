import {
  classifyPlayerName,
  type PlayerCandidate,
} from "@/lib/player-match";
import {
  extractFilledSheets,
  type ParsedRefSheet,
  type SheetPenalties,
  type SheetPlayerLine,
} from "@/lib/ref-sheet-ocr";
import type { SheetRegion, SheetWord } from "@/lib/ref-sheet-layout";

export interface SheetNameSuggestion {
  id: string;
  name: string;
}

export interface SheetNameMatch {
  rawName: string;
  playerId: string | null;
  playerName: string | null;
  confidence: "high" | "low" | "none";
  suggestions: SheetNameSuggestion[];
}

export interface MatchedSheetPlayer extends SheetNameMatch {
  goals: number;
  fouls: number;
  penalties: SheetPenalties;
}

export interface MatchedRefGame {
  region: SheetRegion | "full";
  referees: SheetNameMatch[];
  teamA: MatchedSheetPlayer[];
  teamB: MatchedSheetPlayer[];
  scoreTeamA: number | null;
  scoreTeamB: number | null;
  notes: string[];
}

function annotateName(rawName: string, players: PlayerCandidate[]): SheetNameMatch {
  const classified = classifyPlayerName(rawName, players);

  return {
    rawName,
    playerId: classified.player?.id ?? null,
    playerName: classified.player?.name ?? null,
    confidence: classified.confidence,
    suggestions: classified.suggestions.map((player) => ({
      id: player.id,
      name: player.name,
    })),
  };
}

function annotatePlayer(line: SheetPlayerLine, players: PlayerCandidate[]): MatchedSheetPlayer {
  return {
    ...annotateName(line.name, players),
    goals: line.goals,
    fouls: line.fouls,
    penalties: line.penalties,
  };
}

export function annotateRefSheet(
  region: SheetRegion | "full",
  sheet: ParsedRefSheet,
  players: PlayerCandidate[],
): MatchedRefGame {
  return {
    region,
    referees: sheet.referees.map((name) => annotateName(name, players)),
    teamA: sheet.teamA.map((line) => annotatePlayer(line, players)),
    teamB: sheet.teamB.map((line) => annotatePlayer(line, players)),
    scoreTeamA: sheet.scoreTeamA,
    scoreTeamB: sheet.scoreTeamB,
    notes: sheet.notes,
  };
}

export function matchFilledSheets(
  text: string,
  words: SheetWord[],
  players: PlayerCandidate[],
): MatchedRefGame[] {
  return extractFilledSheets(text, words).map((located) =>
    annotateRefSheet(located.region, located.sheet, players),
  );
}
