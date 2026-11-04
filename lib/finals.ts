export const FINALS_FIELD_SIZE = 12;
export const FINALS_TEAM_COUNT = 4;

export const SNAKE_DRAFT_RANKS = [
  [1, 8, 9],
  [2, 7, 10],
  [3, 6, 11],
  [4, 5, 12],
] as const;

export const FINALS_TEAM_DOT: Record<number, string> = {
  1: "bg-red-500",
  2: "bg-blue-500",
  3: "bg-emerald-500",
  4: "bg-amber-500",
};

export const PLAYOFF_ROUNDS = [
  "SEMIFINAL_1",
  "SEMIFINAL_2",
  "THIRD_PLACE",
  "GRAND_FINAL",
] as const;

export type PlayoffRoundName = (typeof PLAYOFF_ROUNDS)[number];

export function isPlayoffRoundName(value: string): value is PlayoffRoundName {
  return (PLAYOFF_ROUNDS as readonly string[]).includes(value);
}

export const PLAYOFF_MATCH_META: Record<
  PlayoffRoundName,
  { step: number; title: string; waiting: string }
> = {
  SEMIFINAL_1: {
    step: 1,
    title: "Semi-final",
    waiting: "This semi-final has no teams.",
  },
  SEMIFINAL_2: {
    step: 2,
    title: "Semi-final",
    waiting: "This semi-final has no teams.",
  },
  THIRD_PLACE: {
    step: 3,
    title: "3rd place",
    waiting: "Opens after both semi-finals have a winner.",
  },
  GRAND_FINAL: {
    step: 4,
    title: "Grand Final",
    waiting: "Opens after both semi-finals have a winner.",
  },
};

export interface DraftPick<T> {
  rank: number;
  player: T;
}

export function snakeDraftTeams<T>(ranked: readonly T[]): DraftPick<T>[][] {
  if (ranked.length < FINALS_FIELD_SIZE) {
    throw new Error(`Finals need ${FINALS_FIELD_SIZE} ranked players.`);
  }

  return SNAKE_DRAFT_RANKS.map((ranks) =>
    ranks.map((rank) => {
      const player = ranked[rank - 1];

      if (player === undefined) {
        throw new Error(`Missing player for rank ${rank}.`);
      }

      return { rank, player };
    }),
  );
}

export interface PlayoffScoreLine {
  playerId: string;
  goals: number;
}

export interface BracketMatchState {
  round: PlayoffRoundName;
  homeNumber: number | null;
  awayNumber: number | null;
  lines: PlayoffScoreLine[];
}

export interface TeamRoster {
  number: number;
  playerIds: readonly string[];
}

export interface KnockoutUpdate {
  round: "THIRD_PLACE" | "GRAND_FINAL";
  homeNumber: number | null;
  awayNumber: number | null;
  clearLines: boolean;
}

export interface TeamPlace {
  teamNumber: number;
  place: 1 | 2 | 3 | 4;
}

export interface BracketResolution {
  updates: KnockoutUpdate[];
  places: TeamPlace[] | null;
}

export function teamGoalTotal(
  lines: readonly PlayoffScoreLine[],
  playerIds: readonly string[],
): number {
  const ids = new Set(playerIds);

  return lines.reduce(
    (total, line) => (ids.has(line.playerId) ? total + line.goals : total),
    0,
  );
}

interface SideResult {
  winner: number;
  loser: number;
}

function sideResult(
  match: BracketMatchState,
  rosters: ReadonlyMap<number, readonly string[]>,
): SideResult | null {
  if (
    match.homeNumber === null ||
    match.awayNumber === null ||
    match.lines.length === 0
  ) {
    return null;
  }

  const homeIds = rosters.get(match.homeNumber);
  const awayIds = rosters.get(match.awayNumber);

  if (!homeIds || !awayIds) {
    return null;
  }

  const homeGoals = teamGoalTotal(match.lines, homeIds);
  const awayGoals = teamGoalTotal(match.lines, awayIds);

  if (homeGoals === awayGoals) {
    return null;
  }

  if (homeGoals > awayGoals) {
    return { winner: match.homeNumber, loser: match.awayNumber };
  }

  return { winner: match.awayNumber, loser: match.homeNumber };
}

function closedUpdate(
  round: "THIRD_PLACE" | "GRAND_FINAL",
  match: BracketMatchState,
): KnockoutUpdate {
  return {
    round,
    homeNumber: null,
    awayNumber: null,
    clearLines: match.lines.length > 0,
  };
}

function openUpdate(
  round: "THIRD_PLACE" | "GRAND_FINAL",
  match: BracketMatchState,
  homeNumber: number,
  awayNumber: number,
): KnockoutUpdate {
  const changed = match.homeNumber !== homeNumber || match.awayNumber !== awayNumber;

  return {
    round,
    homeNumber,
    awayNumber,
    clearLines: changed && match.lines.length > 0,
  };
}

export function resolvePlayoffBracket(
  matches: readonly BracketMatchState[],
  teams: readonly TeamRoster[],
): BracketResolution {
  const byRound = new Map(matches.map((match) => [match.round, match]));
  const rosters = new Map(teams.map((team) => [team.number, team.playerIds]));
  const semiOne = byRound.get("SEMIFINAL_1");
  const semiTwo = byRound.get("SEMIFINAL_2");
  const third = byRound.get("THIRD_PLACE");
  const final = byRound.get("GRAND_FINAL");

  if (!semiOne || !semiTwo || !third || !final) {
    throw new Error("The playoff bracket is missing a match.");
  }

  const first = sideResult(semiOne, rosters);
  const second = sideResult(semiTwo, rosters);

  if (!first || !second) {
    return {
      updates: [closedUpdate("THIRD_PLACE", third), closedUpdate("GRAND_FINAL", final)],
      places: null,
    };
  }

  const thirdUpdate = openUpdate("THIRD_PLACE", third, first.loser, second.loser);
  const finalUpdate = openUpdate("GRAND_FINAL", final, first.winner, second.winner);
  const thirdReady = !thirdUpdate.clearLines && third.lines.length > 0;
  const finalReady = !finalUpdate.clearLines && final.lines.length > 0;

  if (!thirdReady || !finalReady) {
    return { updates: [thirdUpdate, finalUpdate], places: null };
  }

  const thirdResult = sideResult(
    { ...third, homeNumber: first.loser, awayNumber: second.loser },
    rosters,
  );
  const finalResult = sideResult(
    { ...final, homeNumber: first.winner, awayNumber: second.winner },
    rosters,
  );

  if (!thirdResult || !finalResult) {
    return { updates: [thirdUpdate, finalUpdate], places: null };
  }

  return {
    updates: [thirdUpdate, finalUpdate],
    places: [
      { teamNumber: finalResult.winner, place: 1 },
      { teamNumber: finalResult.loser, place: 2 },
      { teamNumber: thirdResult.winner, place: 3 },
      { teamNumber: thirdResult.loser, place: 4 },
    ],
  };
}

export interface RosterPlayer {
  id: string;
  name: string;
  rank: number;
  isRookie: boolean;
}

export interface FinalsTeamView {
  number: number;
  players: RosterPlayer[];
}

export interface FinalsPlayerSlot extends RosterPlayer {
  goals: number;
}

export interface FinalsSideView {
  number: number;
  goals: number;
  result: string | null;
  players: FinalsPlayerSlot[];
}

export interface OpenPlayoffMatchView {
  open: true;
  round: PlayoffRoundName;
  step: number;
  title: string;
  saved: boolean;
  home: FinalsSideView;
  away: FinalsSideView;
  inputKey: string;
}

export interface ClosedPlayoffMatchView {
  open: false;
  round: PlayoffRoundName;
  step: number;
  title: string;
  waiting: string;
}

export type PlayoffMatchView = OpenPlayoffMatchView | ClosedPlayoffMatchView;

export interface FinalsAdminView {
  playerCount: number;
  generated: boolean;
  resultsLocked: boolean;
  complete: boolean;
  teams: FinalsTeamView[];
  matches: PlayoffMatchView[];
}
