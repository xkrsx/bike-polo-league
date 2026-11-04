export const AWARD_COPY = [
  {
    id: "quing",
    title: "Quing of Winterschmelz",
    criterion: "Overall winner based on final points",
    method: "Highest final points. Ties break on goal difference, then goals.",
  },
  {
    id: "shooting-star",
    title: "Shooting star",
    criterion: "Most goals",
    method: "Goals from league games and the playoffs.",
  },
  {
    id: "polar-owl",
    title: "Polar owl",
    criterion: "Most attendance",
    method: "Most league games played.",
  },
  {
    id: "hardest-snowflake",
    title: "The hardest snowflake",
    criterion: "Most dedicated ref / assistant",
    method: "Most league games as referee or assistant.",
  },
  {
    id: "blizzard",
    title: "Blizzard",
    criterion: "Most fouls",
    method: "Fouls in league games.",
  },
  {
    id: "glacier",
    title: "Glacier",
    criterion: "Most clean sheets / least goals against",
    method: "Most clean sheets, then fewest goals against.",
  },
  {
    id: "icebreaker",
    title: "Icebreaker",
    criterion: "MVP",
    method: "Most points earned in games, before extra and podium bonuses.",
  },
  {
    id: "first-snow",
    title: "The First Snow",
    criterion: "Best rookie",
    method: "Highest final points among rookies.",
  },
] as const;

export type SeasonAwardId = (typeof AWARD_COPY)[number]["id"];

export interface AwardPlayer {
  id: string;
  name: string;
  isRookie: boolean;
  points: number;
  matchPoints: number;
  gamesPlayed: number;
  goals: number;
  goalsConceded: number;
  cleanSheets: number;
  fouls: number;
  goalDifference: number;
  gamesRefereed: number;
}

export interface AwardWinner {
  id: string;
  name: string;
  stat: string;
}

export interface SeasonAward {
  id: SeasonAwardId;
  title: string;
  criterion: string;
  method: string;
  winners: AwardWinner[];
  empty: string | null;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function byName(left: AwardPlayer, right: AwardPlayer): number {
  return left.name.localeCompare(right.name);
}

function compareFinalStanding(left: AwardPlayer, right: AwardPlayer): number {
  if (right.points !== left.points) {
    return right.points - left.points;
  }

  if (right.goalDifference !== left.goalDifference) {
    return right.goalDifference - left.goalDifference;
  }

  if (right.goals !== left.goals) {
    return right.goals - left.goals;
  }

  return byName(left, right);
}

function tiedOnStanding(players: readonly AwardPlayer[]): AwardPlayer[] {
  const best = [...players].sort(compareFinalStanding)[0];

  if (!best) {
    return [];
  }

  return players.filter(
    (player) =>
      player.points === best.points &&
      player.goalDifference === best.goalDifference &&
      player.goals === best.goals,
  );
}

function maxPositive(
  players: readonly AwardPlayer[],
  value: (player: AwardPlayer) => number,
): AwardPlayer[] {
  if (players.length === 0) {
    return [];
  }

  const best = Math.max(...players.map(value));

  if (best <= 0) {
    return [];
  }

  return players.filter((player) => value(player) === best);
}

function glacierPlayers(players: readonly AwardPlayer[]): AwardPlayer[] {
  const active = players.filter((player) => player.gamesPlayed > 0);

  if (active.length === 0) {
    return [];
  }

  const mostSheets = Math.max(...active.map((player) => player.cleanSheets));
  const leaders = active.filter((player) => player.cleanSheets === mostSheets);
  const leastAgainst = Math.min(...leaders.map((player) => player.goalsConceded));

  return leaders.filter((player) => player.goalsConceded === leastAgainst);
}

function named(
  players: readonly AwardPlayer[],
  stat: (player: AwardPlayer) => string,
  empty: string,
): { winners: AwardWinner[]; empty: string | null } {
  if (players.length === 0) {
    return { winners: [], empty };
  }

  return {
    winners: [...players].sort(byName).map((player) => ({
      id: player.id,
      name: player.name,
      stat: stat(player),
    })),
    empty: null,
  };
}

function winnersFor(
  id: SeasonAwardId,
  players: readonly AwardPlayer[],
): { winners: AwardWinner[]; empty: string | null } {
  switch (id) {
    case "quing":
      return named(
        tiedOnStanding(players),
        (player) => countLabel(player.points, "point", "points"),
        "No players on the leaderboard.",
      );
    case "shooting-star":
      return named(
        maxPositive(players, (player) => player.goals),
        (player) => countLabel(player.goals, "goal", "goals"),
        "No goals scored.",
      );
    case "polar-owl":
      return named(
        maxPositive(players, (player) => player.gamesPlayed),
        (player) => countLabel(player.gamesPlayed, "game", "games"),
        "No games played.",
      );
    case "hardest-snowflake":
      return named(
        maxPositive(players, (player) => player.gamesRefereed),
        (player) => countLabel(player.gamesRefereed, "game", "games"),
        "No games as ref or assistant.",
      );
    case "blizzard":
      return named(
        maxPositive(players, (player) => player.fouls),
        (player) => countLabel(player.fouls, "foul", "fouls"),
        "No fouls recorded.",
      );
    case "glacier":
      return named(
        glacierPlayers(players),
        (player) =>
          `${countLabel(player.cleanSheets, "clean sheet", "clean sheets")}, ${player.goalsConceded} against`,
        "No games played.",
      );
    case "icebreaker":
      return named(
        maxPositive(players, (player) => player.matchPoints),
        (player) =>
          countLabel(player.matchPoints, "point from games", "points from games"),
        "No points earned in games.",
      );
    case "first-snow":
      return named(
        tiedOnStanding(players.filter((player) => player.isRookie)),
        (player) => countLabel(player.points, "point", "points"),
        "No rookies this season.",
      );
  }
}

export function seasonAwards(players: readonly AwardPlayer[]): SeasonAward[] {
  return AWARD_COPY.map((copy) => ({
    ...copy,
    ...winnersFor(copy.id, players),
  }));
}

export function waitingAwards(): SeasonAward[] {
  return AWARD_COPY.map((copy) => ({
    ...copy,
    winners: [],
    empty: "Waiting for the finals.",
  }));
}
