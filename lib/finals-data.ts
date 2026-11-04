import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getLeaderboard } from "@/lib/scoring";
import {
  FINALS_FIELD_SIZE,
  PLAYOFF_MATCH_META,
  PLAYOFF_ROUNDS,
  isPlayoffRoundName,
  resolvePlayoffBracket,
  snakeDraftTeams,
  teamGoalTotal,
  type BracketMatchState,
  type ClosedPlayoffMatchView,
  type FinalsAdminView,
  type FinalsSideView,
  type FinalsTeamView,
  type PlayoffMatchView,
  type PlayoffRoundName,
  type PlayoffScoreLine,
  type RosterPlayer,
  type TeamRoster,
} from "@/lib/finals";

const finalsInclude = {
  teams: {
    orderBy: { number: "asc" as const },
    include: {
      members: {
        orderBy: { seedRank: "asc" as const },
        include: {
          player: {
            select: { id: true, name: true, isRookie: true },
          },
        },
      },
    },
  },
  matches: {
    include: {
      lines: {
        select: { playerId: true, goals: true },
      },
    },
  },
} satisfies Prisma.FinalsInclude;

type FinalsRecord = Prisma.FinalsGetPayload<{ include: typeof finalsInclude }>;

function asRound(round: string): PlayoffRoundName {
  if (!isPlayoffRoundName(round)) {
    throw new Error(`Unknown playoff round ${round}.`);
  }

  return round;
}

function teamRosters(finals: FinalsRecord): TeamRoster[] {
  return finals.teams.map((team) => ({
    number: team.number,
    playerIds: team.members.map((member) => member.playerId),
  }));
}

function bracketMatches(finals: FinalsRecord): BracketMatchState[] {
  return finals.matches.map((match) => ({
    round: asRound(match.round),
    homeNumber: match.homeNumber,
    awayNumber: match.awayNumber,
    lines: match.lines.map((line) => ({
      playerId: line.playerId,
      goals: line.goals,
    })),
  }));
}

export function finalsRecordIsComplete(finals: FinalsRecord): boolean {
  return resolvePlayoffBracket(bracketMatches(finals), teamRosters(finals)).places !== null;
}

function resultLabel(round: PlayoffRoundName, won: boolean): string {
  if (round === "GRAND_FINAL") {
    return won ? "1st place" : "2nd place";
  }

  if (round === "THIRD_PLACE") {
    return won ? "3rd place" : "4th place";
  }

  return won ? "Grand Final" : "3rd place";
}

function rosterPlayers(finals: FinalsRecord, number: number): RosterPlayer[] {
  const team = finals.teams.find((item) => item.number === number);

  if (!team) {
    throw new Error(`Finals team ${number} is missing.`);
  }

  return team.members.map((member) => ({
    id: member.player.id,
    name: member.player.name,
    rank: member.seedRank,
    isRookie: member.player.isRookie,
  }));
}

function closedMatch(round: PlayoffRoundName, waiting: string): ClosedPlayoffMatchView {
  const meta = PLAYOFF_MATCH_META[round];

  return {
    open: false,
    round,
    step: meta.step,
    title: meta.title,
    waiting,
  };
}

function openMatch(
  round: PlayoffRoundName,
  homeNumber: number,
  awayNumber: number,
  lines: PlayoffScoreLine[],
  finals: FinalsRecord,
): PlayoffMatchView {
  const meta = PLAYOFF_MATCH_META[round];
  const saved = lines.length > 0;
  const homeRoster = rosterPlayers(finals, homeNumber);
  const awayRoster = rosterPlayers(finals, awayNumber);
  const homeGoals = teamGoalTotal(lines, homeRoster.map((player) => player.id));
  const awayGoals = teamGoalTotal(lines, awayRoster.map((player) => player.id));

  const side = (
    number: number,
    roster: RosterPlayer[],
    goals: number,
    opponentGoals: number,
  ): FinalsSideView => ({
    number,
    goals,
    result: saved && goals !== opponentGoals ? resultLabel(round, goals > opponentGoals) : null,
    players: roster.map((player) => ({
      ...player,
      goals: lines.find((line) => line.playerId === player.id)?.goals ?? 0,
    })),
  });

  const home = side(homeNumber, homeRoster, homeGoals, awayGoals);
  const away = side(awayNumber, awayRoster, awayGoals, homeGoals);

  return {
    open: true,
    round,
    step: meta.step,
    title: meta.title,
    saved,
    home,
    away,
    inputKey: `${round}:${[...home.players, ...away.players]
      .map((player) => `${player.id}:${player.goals}`)
      .join(",")}`,
  };
}

function matchView(finals: FinalsRecord, round: PlayoffRoundName): PlayoffMatchView {
  const match = finals.matches.find((item) => item.round === round);
  const meta = PLAYOFF_MATCH_META[round];

  if (!match || match.homeNumber === null || match.awayNumber === null) {
    return closedMatch(round, meta.waiting);
  }

  return openMatch(
    round,
    match.homeNumber,
    match.awayNumber,
    match.lines,
    finals,
  );
}

function proposedTeams(
  standings: Awaited<ReturnType<typeof getLeaderboard>>,
): FinalsTeamView[] {
  if (standings.length < FINALS_FIELD_SIZE) {
    return [];
  }

  return snakeDraftTeams(standings).map((team, index) => ({
    number: index + 1,
    players: team.map((pick) => ({
      id: pick.player.id,
      name: pick.player.name,
      rank: pick.rank,
      isRookie: pick.player.isRookie,
    })),
  }));
}

function storedTeams(finals: FinalsRecord): FinalsTeamView[] {
  return finals.teams.map((team) => ({
    number: team.number,
    players: team.members.map((member) => ({
      id: member.player.id,
      name: member.player.name,
      rank: member.seedRank,
      isRookie: member.player.isRookie,
    })),
  }));
}

async function loadLatestFinals(): Promise<FinalsRecord | null> {
  return prisma.finals.findFirst({
    orderBy: { createdAt: "desc" },
    include: finalsInclude,
  });
}

export async function areFinalsComplete(): Promise<boolean> {
  const finals = await loadLatestFinals();

  return finals ? finalsRecordIsComplete(finals) : false;
}

export async function getFinalsAdminView(): Promise<FinalsAdminView> {
  const [standings, finals] = await Promise.all([
    getLeaderboard(),
    loadLatestFinals(),
  ]);

  if (!finals) {
    return {
      playerCount: standings.length,
      generated: false,
      resultsLocked: false,
      complete: false,
      teams: proposedTeams(standings),
      matches: [],
    };
  }

  return {
    playerCount: standings.length,
    generated: true,
    resultsLocked: finals.matches.some((match) => match.lines.length > 0),
    complete: finalsRecordIsComplete(finals),
    teams: storedTeams(finals),
    matches: PLAYOFF_ROUNDS.map((round) => matchView(finals, round)),
  };
}
