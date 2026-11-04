import type { Prisma, TeamAssigned } from "@prisma/client";

export interface DuplicatePlayer {
  playerId: string;
  team: TeamAssigned;
  goals: number;
}

export interface DuplicateCandidate {
  scoreTeamA: number;
  scoreTeamB: number;
  refereeId: string | null;
  assistantId: string | null;
  players: DuplicatePlayer[];
}

function sorted(values: string[]): string[] {
  return [...values].sort();
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sideIds(match: DuplicateCandidate, team: TeamAssigned): string[] {
  return sorted(
    match.players.filter((player) => player.team === team).map((player) => player.playerId),
  );
}

function scorerKey(match: DuplicateCandidate): string[] {
  return sorted(
    match.players
      .filter((player) => player.goals > 0)
      .map((player) => `${player.playerId}:${player.goals}`),
  );
}

function refereeIds(match: DuplicateCandidate): string[] {
  return sorted([match.refereeId, match.assistantId].filter((id): id is string => Boolean(id)));
}

/**
 * A saved game is the same match when both sides have the same players, the
 * scorers have the same goal totals, and the final score matches.
 * Referees must match too, unless the saved game has no referees.
 */
export function isDuplicateMatch(
  candidate: DuplicateCandidate,
  existing: DuplicateCandidate,
): boolean {
  if (
    candidate.scoreTeamA !== existing.scoreTeamA ||
    candidate.scoreTeamB !== existing.scoreTeamB
  ) {
    return false;
  }

  if (
    !sameList(sideIds(candidate, "TEAM_A"), sideIds(existing, "TEAM_A")) ||
    !sameList(sideIds(candidate, "TEAM_B"), sideIds(existing, "TEAM_B")) ||
    !sameList(scorerKey(candidate), scorerKey(existing))
  ) {
    return false;
  }

  const savedReferees = refereeIds(existing);

  if (savedReferees.length === 0) {
    return true;
  }

  return sameList(savedReferees, refereeIds(candidate));
}

export async function findDuplicateGame(
  db: Prisma.TransactionClient,
  candidate: DuplicateCandidate,
  excludeGameId?: string,
): Promise<{ id: string } | null> {
  const games = await db.game.findMany({
    where: {
      scoreTeamA: candidate.scoreTeamA,
      scoreTeamB: candidate.scoreTeamB,
      ...(excludeGameId ? { id: { not: excludeGameId } } : {}),
    },
    select: {
      id: true,
      refereeId: true,
      assistantId: true,
      players: {
        select: {
          playerId: true,
          teamAssigned: true,
          goals: true,
        },
      },
    },
  });

  for (const game of games) {
    const existing: DuplicateCandidate = {
      scoreTeamA: candidate.scoreTeamA,
      scoreTeamB: candidate.scoreTeamB,
      refereeId: game.refereeId,
      assistantId: game.assistantId,
      players: game.players.map((player) => ({
        playerId: player.playerId,
        team: player.teamAssigned,
        goals: player.goals,
      })),
    };

    if (isDuplicateMatch(candidate, existing)) {
      return { id: game.id };
    }
  }

  return null;
}
