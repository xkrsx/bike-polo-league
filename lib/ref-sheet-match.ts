import {
  classifyPlayerName,
  normalizeName,
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
  name: string | null;
  playerId: string | null;
  playerName: string | null;
  confidence: "high" | "low" | "none";
  suggestions: SheetNameSuggestion[];
  matchedAs: string | null;
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

function rosterNameMatches(rosterName: string, token: string): boolean {
  const name = normalizeName(rosterName);
  const key = normalizeName(token);

  if (!name || !key || key.length < 3) {
    return false;
  }

  if (name === key) {
    return true;
  }

  const parts = name.split(" ").filter(Boolean);

  if (parts.some((part) => part === key || part.startsWith(key))) {
    return true;
  }

  return name.includes(key);
}

function rosterSuggestions(
  names: readonly string[] | undefined,
  players: PlayerCandidate[],
): SheetNameSuggestion[] {
  const found: SheetNameSuggestion[] = [];

  for (const name of names ?? []) {
    for (const player of players) {
      if (!rosterNameMatches(player.name, name) || found.some((item) => item.id === player.id)) {
        continue;
      }

      found.push({ id: player.id, name: player.name });
    }
  }

  return found.slice(0, 8);
}

function annotateName(
  rawName: string,
  players: PlayerCandidate[],
  hinted: readonly string[] = [],
): SheetNameMatch {
  const classified = classifyPlayerName(rawName, players);
  const expanded = rosterSuggestions([rawName, ...hinted], players);
  const fuller = expanded.filter((player) => normalizeName(player.name) !== normalizeName(rawName));

  if (fuller.length > 1) {
    return {
      rawName,
      name: null,
      playerId: null,
      playerName: null,
      confidence: "low",
      suggestions: fuller,
      matchedAs: null,
    };
  }

  if (fuller.length === 1) {
    return {
      rawName,
      name: fuller[0].name,
      playerId: fuller[0].id,
      playerName: fuller[0].name,
      confidence: "high",
      suggestions: [],
      matchedAs: rawName,
    };
  }

  const fromHints = rosterSuggestions(hinted, players).filter(
    (player) => normalizeName(player.name) !== normalizeName(rawName),
  );
  const suggestions =
    classified.suggestions.length > 0
      ? classified.suggestions.map((player) => ({
          id: player.id,
          name: player.name,
        }))
      : fromHints;
  const resolved =
    classified.confidence === "high" && classified.player && suggestions.length === 0
      ? classified.player
      : null;

  return {
    rawName,
    name: resolved?.name ?? null,
    playerId: resolved?.id ?? null,
    playerName: resolved?.name ?? null,
    confidence: resolved ? "high" : classified.confidence,
    suggestions,
    matchedAs: resolved ? rawName : null,
  };
}

function annotatePlayer(line: SheetPlayerLine, players: PlayerCandidate[]): MatchedSheetPlayer {
  return {
    ...annotateName(line.name, players, line.suggestions),
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
    referees: sheet.referees.map((name, index) =>
      annotateName(name, players, sheet.refereeSuggestions?.[index]),
    ),
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
