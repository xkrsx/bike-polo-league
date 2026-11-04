export const PLAYERS_PER_TEAM = 3;
export const MAX_PLAYER_NAME_LENGTH = 80;
export const MAX_STAT = 99;

export const MAX_GAMES_PER_SHEET = 4;

export interface MatchLine {
  name: string;
  goals: number;
  ownGoals: number;
  fouls: number;
  isRookie?: boolean;
  /** Wizard selection. "new" keeps the typed name. An id links that player. */
  playerId?: string | null;
}

/**
 * Point-in-time result of one game.
 * Post-game entry submits a sheet once. Live scoring can submit the same
 * sheet at the whistle, and later add events, without changing the totals.
 */
export interface MatchSheet {
  date: Date;
  refereeName: string;
  assistantName: string;
  refereeId?: string | null;
  assistantId?: string | null;
  teamA: MatchLine[];
  teamB: MatchLine[];
}

export function splitOfficialNames(value: string): string[] {
  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  return trimmed
    .split(/\s*(?:,|\/|&|\n|;|\band\b)\s*/i)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0);
}

export function formatMatchDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function formatStoredMatchDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function parseMatchDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

export interface MatchScore {
  scoreTeamA: number;
  scoreTeamB: number;
}

function sum(lines: MatchLine[], field: "goals" | "ownGoals"): number {
  return lines.reduce((total, line) => total + line[field], 0);
}

export function tallyMatchScore(
  teamA: MatchLine[],
  teamB: MatchLine[],
): MatchScore {
  return {
    scoreTeamA: sum(teamA, "goals") + sum(teamB, "ownGoals"),
    scoreTeamB: sum(teamB, "goals") + sum(teamA, "ownGoals"),
  };
}
