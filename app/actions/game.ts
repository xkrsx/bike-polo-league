"use server";

import { Prisma, TeamAssigned } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  MAX_PLAYER_NAME_LENGTH,
  MAX_STAT,
  PLAYERS_PER_TEAM,
  parseMatchDate,
  tallyMatchScore,
  type MatchLine,
  type MatchSheet,
} from "@/lib/match-sheet";
import {
  cleanDisplayName,
  normalizeName,
  resolvePlayerName,
  type PlayerCandidate,
} from "@/lib/player-match";

export interface GameActionState {
  error: string | null;
}

type ResolvedPerson =
  | { origin: "existing"; id: string; name: string }
  | { origin: "new"; key: string; name: string };

interface LineupSlot {
  person: ResolvedPerson;
  team: TeamAssigned;
  goals: number;
  ownGoals: number;
  fouls: number;
  isRookie: boolean;
}

class MatchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatchInputError";
  }
}

function readStrings(formData: FormData, key: string): string[] {
  return formData.getAll(key).map((value) => {
    if (typeof value !== "string") {
      throw new MatchInputError("Match sheet could not be read.");
    }

    return value;
  });
}

function parseStat(value: string, label: string): number {
  const trimmed = value.trim();

  if (trimmed === "") {
    return 0;
  }

  if (!/^\d{1,2}$/.test(trimmed) || Number(trimmed) > MAX_STAT) {
    throw new MatchInputError(`${label} must be a whole number from 0 to 99.`);
  }

  return Number(trimmed);
}

function parseTeam(
  formData: FormData,
  team: "A" | "B",
): MatchLine[] {
  const prefix = team === "A" ? "teamA" : "teamB";
  const label = team === "A" ? "red side" : "blue side";
  const names = readStrings(formData, `${prefix}Name`);
  const goals = readStrings(formData, `${prefix}Goals`);
  const ownGoals = readStrings(formData, `${prefix}OwnGoals`);
  const fouls = readStrings(formData, `${prefix}Fouls`);
  const rookieRows = new Set(
    readStrings(formData, `${prefix}Rookie`).flatMap((value) => {
      if (!/^\d+$/.test(value)) {
        return [];
      }

      const index = Number(value);
      return index < names.length ? [index] : [];
    }),
  );

  if (
    names.length !== goals.length ||
    names.length !== ownGoals.length ||
    names.length !== fouls.length
  ) {
    throw new MatchInputError("Match sheet rows were incomplete.");
  }

  if (names.length !== PLAYERS_PER_TEAM) {
    throw new MatchInputError(
      `The ${label} must have exactly ${PLAYERS_PER_TEAM} players.`,
    );
  }

  const lines: MatchLine[] = [];

  names.forEach((rawName, index) => {
    const name = cleanDisplayName(rawName);
    const rowGoals = parseStat(goals[index] ?? "", `${label} goals`);
    const rowOwnGoals = parseStat(ownGoals[index] ?? "", `${label} own goals`);
    const rowFouls = parseStat(fouls[index] ?? "", `${label} fouls`);

    if (!name) {
      throw new MatchInputError(`Enter a name for every player on the ${label}.`);
    }

    if (name.length > MAX_PLAYER_NAME_LENGTH || !normalizeName(name)) {
      throw new MatchInputError(
        "Use a player name of 1–80 letters or numbers.",
      );
    }

    lines.push({
      name,
      goals: rowGoals,
      ownGoals: rowOwnGoals,
      fouls: rowFouls,
      isRookie: rookieRows.has(index),
    });
  });

  return lines;
}

function parseMatchForm(formData: FormData): MatchSheet {
  const date = parseMatchDate(String(formData.get("date") ?? ""));
  const refereeName = cleanDisplayName(String(formData.get("referee") ?? ""));

  if (!date) {
    throw new MatchInputError("Enter a valid match date.");
  }

  if (
    refereeName &&
    (refereeName.length > MAX_PLAYER_NAME_LENGTH || !normalizeName(refereeName))
  ) {
    throw new MatchInputError("Use a referee name of 1–80 letters or numbers.");
  }

  return {
    date,
    refereeName,
    teamA: parseTeam(formData, "A"),
    teamB: parseTeam(formData, "B"),
  };
}

function formatNameList(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function resolvePerson(
  rawName: string,
  roster: PlayerCandidate[],
  pendingIds: Set<string>,
): ResolvedPerson {
  const name = cleanDisplayName(rawName);
  const resolution = resolvePlayerName(name, roster);

  if (resolution.kind === "ambiguous") {
    throw new MatchInputError(
      `"${name}" matches ${formatNameList(resolution.players.map((player) => player.name))}. Choose one of those names.`,
    );
  }

  if (resolution.kind === "exact" || resolution.kind === "similar") {
    if (pendingIds.has(resolution.player.id)) {
      return {
        origin: "new",
        key: resolution.player.id,
        name: resolution.player.name,
      };
    }

    return {
      origin: "existing",
      id: resolution.player.id,
      name: resolution.player.name,
    };
  }

  const key = `new:${normalizeName(name)}`;
  pendingIds.add(key);
  roster.push({ id: key, name });

  return { origin: "new", key, name };
}

function personIdentity(person: ResolvedPerson): string {
  return person.origin === "existing" ? `id:${person.id}` : person.key;
}

function assertDistinct(
  referee: ResolvedPerson | null,
  teamA: LineupSlot[],
  teamB: LineupSlot[],
): void {
  const seen = new Map<string, { name: string; slot: "referee" | "A" | "B" }>();

  const claim = (
    person: ResolvedPerson,
    slot: "referee" | "A" | "B",
  ): void => {
    const identity = personIdentity(person);
    const previous = seen.get(identity);

    if (!previous) {
      seen.set(identity, { name: person.name, slot });
      return;
    }

    if (previous.slot === "referee" || slot === "referee") {
      throw new MatchInputError(
        `${person.name} is the referee and cannot also play.`,
      );
    }

    if (previous.slot !== slot) {
      throw new MatchInputError(`${person.name} is listed on both teams.`);
    }

    const teamLabel = slot === "A" ? "red side" : "blue side";
    throw new MatchInputError(`${person.name} is listed twice on the ${teamLabel}.`);
  };

  if (referee) {
    claim(referee, "referee");
  }

  for (const line of teamA) {
    claim(line.person, "A");
  }

  for (const line of teamB) {
    claim(line.person, "B");
  }
}

async function personId(
  tx: Prisma.TransactionClient,
  person: ResolvedPerson,
  createdIds: Map<string, string>,
  rookieKeys: ReadonlySet<string>,
): Promise<string> {
  if (person.origin === "existing") {
    return person.id;
  }

  const existing = createdIds.get(person.key);

  if (existing) {
    return existing;
  }

  const created = await tx.player.create({
    data: {
      name: person.name,
      isRookie: rookieKeys.has(person.key),
    },
  });
  createdIds.set(person.key, created.id);

  return created.id;
}

interface StoredLine {
  playerId: string;
  teamAssigned: TeamAssigned;
  goals: number;
  ownGoals: number;
  fouls: number;
}

interface StoredMatch {
  date: Date;
  refereeId: string | null;
  scoreTeamA: number;
  scoreTeamB: number;
  players: StoredLine[];
}

async function buildStoredMatch(
  tx: Prisma.TransactionClient,
  sheet: MatchSheet,
): Promise<StoredMatch> {
  const existing = await tx.player.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  const roster: PlayerCandidate[] = existing.map((player) => ({
    id: player.id,
    name: player.name,
  }));
  const pendingIds = new Set<string>();
  const referee = sheet.refereeName
    ? resolvePerson(sheet.refereeName, roster, pendingIds)
    : null;

  const toSlot = (line: MatchLine, team: TeamAssigned): LineupSlot => ({
    person: resolvePerson(line.name, roster, pendingIds),
    team,
    goals: line.goals,
    ownGoals: line.ownGoals,
    fouls: line.fouls,
    isRookie: line.isRookie === true,
  });

  const teamA = sheet.teamA.map((line) => toSlot(line, TeamAssigned.TEAM_A));
  const teamB = sheet.teamB.map((line) => toSlot(line, TeamAssigned.TEAM_B));
  assertDistinct(referee, teamA, teamB);

  const rookieKeys = new Set<string>();

  for (const line of [...teamA, ...teamB]) {
    if (line.person.origin === "new" && line.isRookie) {
      rookieKeys.add(line.person.key);
    }
  }

  const createdIds = new Map<string, string>();
  const refereeId = referee
    ? await personId(tx, referee, createdIds, rookieKeys)
    : null;
  const lineup = [...teamA, ...teamB];
  const players: StoredLine[] = [];

  for (const line of lineup) {
    players.push({
      playerId: await personId(tx, line.person, createdIds, rookieKeys),
      teamAssigned: line.team,
      goals: line.goals,
      ownGoals: line.ownGoals,
      fouls: line.fouls,
    });
  }

  const { scoreTeamA, scoreTeamB } = tallyMatchScore(sheet.teamA, sheet.teamB);

  return {
    date: sheet.date,
    refereeId,
    scoreTeamA,
    scoreTeamB,
    players,
  };
}

async function saveMatch(tx: Prisma.TransactionClient, sheet: MatchSheet): Promise<void> {
  const match = await buildStoredMatch(tx, sheet);

  await tx.game.create({
    data: {
      date: match.date,
      scoreTeamA: match.scoreTeamA,
      scoreTeamB: match.scoreTeamB,
      refereeId: match.refereeId,
      players: { create: match.players },
    },
  });
}

async function replaceMatch(
  tx: Prisma.TransactionClient,
  gameId: string,
  sheet: MatchSheet,
): Promise<void> {
  const existing = await tx.game.findUnique({
    where: { id: gameId },
    select: { id: true, date: true },
  });

  if (!existing) {
    throw new MatchInputError("This match no longer exists.");
  }

  const match = await buildStoredMatch(tx, sheet);
  const date = sameUtcDay(existing.date, match.date) ? existing.date : match.date;

  await tx.game.update({
    where: { id: gameId },
    data: {
      date,
      refereeId: match.refereeId,
      scoreTeamA: match.scoreTeamA,
      scoreTeamB: match.scoreTeamB,
    },
  });
  await tx.gamePlayer.deleteMany({ where: { gameId } });
  await tx.gamePlayer.createMany({
    data: match.players.map((player) => ({
      gameId,
      playerId: player.playerId,
      teamAssigned: player.teamAssigned,
      goals: player.goals,
      ownGoals: player.ownGoals,
      fouls: player.fouls,
    })),
  });
}

function sameUtcDay(left: Date, right: Date): boolean {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

function revalidateMatchViews(gameId?: string): void {
  revalidatePath("/leaderboard");
  revalidatePath("/games");
  revalidatePath("/awards");
  revalidatePath("/admin/finals");

  if (gameId) {
    revalidatePath(`/games/${gameId}/edit`);
  }
}

function readMatchSheet(formData: FormData): MatchSheet | GameActionState {
  try {
    return parseMatchForm(formData);
  } catch (error) {
    if (error instanceof MatchInputError) {
      return { error: error.message };
    }

    throw error;
  }
}

function isMatchSheet(value: MatchSheet | GameActionState): value is MatchSheet {
  return !("error" in value);
}

export async function createGame(
  _previous: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  const sheet = readMatchSheet(formData);

  if (!isMatchSheet(sheet)) {
    return sheet;
  }

  try {
    await prisma.$transaction((tx) => saveMatch(tx, sheet));
  } catch (error) {
    if (error instanceof MatchInputError) {
      return { error: error.message };
    }

    console.error(error);
    return { error: "Could not save this match. Try again." };
  }

  revalidateMatchViews();
  redirect("/leaderboard");
}

export async function updateGame(
  gameId: string,
  _previous: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  if (!gameId.trim()) {
    return { error: "Choose a match to update." };
  }

  const sheet = readMatchSheet(formData);

  if (!isMatchSheet(sheet)) {
    return sheet;
  }

  try {
    await prisma.$transaction((tx) => replaceMatch(tx, gameId, sheet));
  } catch (error) {
    if (error instanceof MatchInputError) {
      return { error: error.message };
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return { error: "This match no longer exists." };
    }

    console.error(error);
    return { error: "Could not update this match. Try again." };
  }

  revalidateMatchViews(gameId);
  redirect("/games");
}
