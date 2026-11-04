import { TeamAssigned } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const WIN_POINTS = 5;
const DRAW_POINTS = 2;
const LOSS_POINTS = 1;
const ROOKIE_BONUS = 1;

export interface PlayerStanding {
  id: string;
  name: string;
  isRookie: boolean;
  points: number;
  bonusPoints: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  goalsConceded: number;
  ownGoals: number;
  cleanSheets: number;
  fouls: number;
  goalDifference: number;
}

interface PlayerRecord {
  id: string;
  name: string;
  isRookie: boolean;
  extraPoints: number;
  podiumPoints: number;
}

interface GamePlayerStat {
  playerId: string;
  teamAssigned: TeamAssigned;
  goals: number;
  ownGoals: number;
  fouls: number;
  isRookie: boolean;
}

interface GameRecord {
  scoreTeamA: number;
  scoreTeamB: number;
  players: GamePlayerStat[];
}

interface TeamResult {
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goalDifference: number;
}

function teamScore(game: GameRecord, team: TeamAssigned): number {
  return team === TeamAssigned.TEAM_A ? game.scoreTeamA : game.scoreTeamB;
}

function opponentScore(game: GameRecord, team: TeamAssigned): number {
  return team === TeamAssigned.TEAM_A ? game.scoreTeamB : game.scoreTeamA;
}

function resultForTeam(game: GameRecord, team: TeamAssigned): TeamResult {
  const scored = teamScore(game, team);
  const conceded = opponentScore(game, team);
  const goalDifference = scored - conceded;

  if (scored > conceded) {
    return { points: WIN_POINTS, wins: 1, draws: 0, losses: 0, goalDifference };
  }

  if (scored === conceded) {
    return { points: DRAW_POINTS, wins: 0, draws: 1, losses: 0, goalDifference };
  }

  return { points: LOSS_POINTS, wins: 0, draws: 0, losses: 1, goalDifference };
}

function rookieTeamBonus(players: GamePlayerStat[]): number {
  const rookieScored = players.some(
    (player) => player.isRookie && player.goals >= 1,
  );

  return rookieScored ? ROOKIE_BONUS : 0;
}

function emptyStanding(player: PlayerRecord): PlayerStanding {
  return {
    id: player.id,
    name: player.name,
    isRookie: player.isRookie,
    points: 0,
    bonusPoints: player.extraPoints + player.podiumPoints,
    gamesPlayed: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals: 0,
    goalsConceded: 0,
    ownGoals: 0,
    cleanSheets: 0,
    fouls: 0,
    goalDifference: 0,
  };
}

export function calculateStandings(
  players: PlayerRecord[],
  games: GameRecord[],
  playoffGoals: ReadonlyMap<string, number> = new Map(),
): PlayerStanding[] {
  const standings = new Map<string, PlayerStanding>(
    players.map((player) => [player.id, emptyStanding(player)]),
  );

  for (const game of games) {
    const bonusByTeam = new Map<TeamAssigned, number>([
      [
        TeamAssigned.TEAM_A,
        rookieTeamBonus(
          game.players.filter(
            (player) => player.teamAssigned === TeamAssigned.TEAM_A,
          ),
        ),
      ],
      [
        TeamAssigned.TEAM_B,
        rookieTeamBonus(
          game.players.filter(
            (player) => player.teamAssigned === TeamAssigned.TEAM_B,
          ),
        ),
      ],
    ]);

    for (const appearance of game.players) {
      const standing = standings.get(appearance.playerId);

      if (!standing) {
        continue;
      }

      const result = resultForTeam(game, appearance.teamAssigned);
      const conceded = opponentScore(game, appearance.teamAssigned);
      const individualBonus =
        appearance.isRookie && appearance.goals >= 1 ? ROOKIE_BONUS : 0;

      standing.points +=
        result.points +
        (bonusByTeam.get(appearance.teamAssigned) ?? 0) +
        individualBonus;
      standing.gamesPlayed += 1;
      standing.wins += result.wins;
      standing.draws += result.draws;
      standing.losses += result.losses;
      standing.goals += appearance.goals;
      standing.goalsConceded += conceded;
      standing.ownGoals += appearance.ownGoals;
      standing.cleanSheets += conceded === 0 ? 1 : 0;
      standing.fouls += appearance.fouls;
      standing.goalDifference += result.goalDifference;
    }
  }

  // Playoff goals count toward goals scored. They do not add wins,
  // games played, fouls, clean sheets, or goal difference.
  for (const [playerId, goals] of playoffGoals) {
    const standing = standings.get(playerId);

    if (!standing || goals <= 0) {
      continue;
    }

    standing.goals += goals;
  }

  for (const standing of standings.values()) {
    standing.points += standing.bonusPoints;
  }

  return [...standings.values()].sort((left, right) => {
    if (right.points !== left.points) {
      return right.points - left.points;
    }

    if (right.goalDifference !== left.goalDifference) {
      return right.goalDifference - left.goalDifference;
    }

    if (right.goals !== left.goals) {
      return right.goals - left.goals;
    }

    return left.name.localeCompare(right.name);
  });
}

export async function getLeaderboard(): Promise<PlayerStanding[]> {
  const [players, games, playoffGoalRows] = await Promise.all([
    prisma.player.findMany({
      select: {
        id: true,
        name: true,
        isRookie: true,
        extraPoints: true,
        podiumPoints: true,
      },
    }),
    prisma.game.findMany({
      where: { status: "APPROVED" },
      select: {
        scoreTeamA: true,
        scoreTeamB: true,
        players: {
          select: {
            playerId: true,
            teamAssigned: true,
            goals: true,
            ownGoals: true,
            fouls: true,
            player: { select: { isRookie: true } },
          },
        },
      },
    }),
    prisma.playoffLine.groupBy({
      by: ["playerId"],
      _sum: { goals: true },
    }),
  ]);

  const playoffGoals = new Map(
    playoffGoalRows.map((row) => [row.playerId, row._sum.goals ?? 0]),
  );

  return calculateStandings(
    players,
    games.map((game) => ({
      scoreTeamA: game.scoreTeamA,
      scoreTeamB: game.scoreTeamB,
      players: game.players.map((appearance) => ({
        playerId: appearance.playerId,
        teamAssigned: appearance.teamAssigned,
        goals: appearance.goals,
        ownGoals: appearance.ownGoals,
        fouls: appearance.fouls ?? 0,
        isRookie: appearance.player.isRookie,
      })),
    })),
    playoffGoals,
  );
}
