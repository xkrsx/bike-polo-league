"use server";

import { Prisma, TeamAssigned } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { findDuplicateGame } from "@/lib/duplicate-match";
import { GAME_PENDING, isGameStatus } from "@/lib/game-status";
import { removeStoredRefSheet, saveRefSheetImage } from "@/lib/ref-sheet-storage";
import {
  MAX_GAMES_PER_SHEET,
  MAX_PLAYER_NAME_LENGTH,
  MAX_STAT,
  PLAYERS_PER_TEAM,
  parseMatchDate,
  splitOfficialNames,
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
  prefix: string,
  label: string,
): MatchLine[] {
  const names = readStrings(formData, `${prefix}Name`);
  const goals = readStrings(formData, `${prefix}Goals`);
  const ownGoals = readStrings(formData, `${prefix}OwnGoals`);
  const fouls = readStrings(formData, `${prefix}Fouls`);
  const playerIds = readStrings(formData, `${prefix}PlayerId`);
  const explicitIds = playerIds.length > 0;
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
    names.length !== fouls.length ||
    (explicitIds && playerIds.length !== names.length)
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
    const playerId = explicitIds ? (playerIds[index] ?? "").trim() : undefined;
    const linked = Boolean(playerId && playerId !== "new");
    const rowGoals = parseStat(goals[index] ?? "", `${label} goals`);
    const rowOwnGoals = parseStat(ownGoals[index] ?? "", `${label} own goals`);
    const rowFouls = parseStat(fouls[index] ?? "", `${label} fouls`);

    if (!name && !linked) {
      throw new MatchInputError(`Enter a name for every player on the ${label}.`);
    }

    if (name && (name.length > MAX_PLAYER_NAME_LENGTH || !normalizeName(name))) {
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
      playerId,
    });
  });

  return lines;
}

function parseMatchForm(formData: FormData): MatchSheet {
  const date = parseMatchDate(String(formData.get("date") ?? ""));
  const officialNames = splitOfficialNames(
    String(formData.get("referees") ?? formData.get("referee") ?? ""),
  );

  if (!date) {
    throw new MatchInputError("Enter a valid match date.");
  }

  if (officialNames.length > 2) {
    throw new MatchInputError("Enter the ref and one assistant.");
  }

  for (const name of officialNames) {
    if (name.length > MAX_PLAYER_NAME_LENGTH || !normalizeName(name)) {
      throw new MatchInputError("Use a referee name of 1–80 letters or numbers.");
    }
  }

  return {
    date,
    refereeName: officialNames[0] ?? "",
    assistantName: officialNames[1] ?? "",
    teamA: parseTeam(formData, "teamA", "red side"),
    teamB: parseTeam(formData, "teamB", "blue side"),
  };
}

function parseSubmission(formData: FormData): Submission {
  const submitterId = String(formData.get("submitterId") ?? "").trim();
  const guestName = cleanDisplayName(String(formData.get("submitterName") ?? ""));
  const addPlayer = formData.get("addSubmitter") === "on";
  const rookie = formData.get("submitterRookie") === "on";

  if (submitterId && submitterId !== "guest") {
    return { submitterId, guestName: "", addPlayer: false, rookie: false };
  }

  if (
    !guestName ||
    guestName.length > MAX_PLAYER_NAME_LENGTH ||
    !normalizeName(guestName)
  ) {
    throw new MatchInputError(
      "Choose who is submitting this game, or enter a guest name.",
    );
  }

  return {
    submitterId: null,
    guestName,
    addPlayer,
    rookie,
  };
}

async function resolveSubmitter(
  tx: Prisma.TransactionClient,
  submission: Submission,
): Promise<string> {
  if (submission.submitterId) {
    const player = await tx.player.findUnique({
      where: { id: submission.submitterId },
      select: { name: true },
    });

    if (!player) {
      throw new MatchInputError("Choose a player who is still in the league.");
    }

    return player.name;
  }

  const name = submission.guestName;

  if (!submission.addPlayer) {
    return name;
  }

  const roster = await tx.player.findMany({
    select: { id: true, name: true },
  });
  const resolution = resolvePlayerName(name, roster);

  if (resolution.kind === "ambiguous") {
    throw new MatchInputError(
      `"${name}" matches ${formatNameList(resolution.players.map((player) => player.name))}. Choose one of those names.`,
    );
  }

  if (resolution.kind === "exact" || resolution.kind === "similar") {
    return resolution.player.name;
  }

  await tx.player.create({
    data: {
      name,
      isRookie: submission.rookie,
    },
  });

  return name;
}

async function readUploadedSheet(
  formData: FormData,
  required: boolean,
): Promise<string | null> {
  const file = formData.get("refSheet");

  if (!(file instanceof File) || file.size === 0) {
    if (required) {
      throw new MatchInputError("Upload a photo of the ref sheet.");
    }

    return null;
  }

  try {
    return await saveRefSheetImage(file);
  } catch (error) {
    throw new MatchInputError(
      error instanceof Error ? error.message : "Upload a photo of the ref sheet.",
    );
  }
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

function resolveExactOrNew(
  rawName: string,
  roster: PlayerCandidate[],
  pendingIds: Set<string>,
): ResolvedPerson {
  const name = cleanDisplayName(rawName);
  const normalized = normalizeName(name);
  const exact = roster.find((player) => normalizeName(player.name) === normalized);

  if (exact) {
    if (exact.id.startsWith("new:") || pendingIds.has(exact.id)) {
      const key = exact.id.startsWith("new:") ? exact.id : `new:${normalized}`;

      return { origin: "new", key, name: exact.name };
    }

    return { origin: "existing", id: exact.id, name: exact.name };
  }

  const key = `new:${normalized}`;
  pendingIds.add(key);
  roster.push({ id: key, name });

  return { origin: "new", key, name };
}

function resolveLinkedPerson(
  rawName: string,
  playerId: string | null | undefined,
  roster: PlayerCandidate[],
  pendingIds: Set<string>,
): ResolvedPerson {
  const linkedId = playerId?.trim() ?? "";

  if (linkedId && linkedId !== "new") {
    const player = roster.find((candidate) => candidate.id === linkedId);

    if (!player || player.id.startsWith("new:")) {
      throw new MatchInputError("Choose a player who is still in the league.");
    }

    if (pendingIds.has(player.id)) {
      return { origin: "new", key: player.id, name: player.name };
    }

    return { origin: "existing", id: player.id, name: player.name };
  }

  if (linkedId === "new") {
    return resolveExactOrNew(rawName, roster, pendingIds);
  }

  return resolvePerson(rawName, roster, pendingIds);
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

function officialPerson(
  name: string,
  playerId: string | null | undefined,
  roster: PlayerCandidate[],
  pendingIds: Set<string>,
): ResolvedPerson | null {
  const linkedId = playerId?.trim() ?? "";

  if (!cleanDisplayName(name) && (!linkedId || linkedId === "new")) {
    return null;
  }

  return resolveLinkedPerson(name, playerId, roster, pendingIds);
}

function personIdentity(person: ResolvedPerson): string {
  return person.origin === "existing" ? `id:${person.id}` : person.key;
}

function assertDistinct(
  officials: ResolvedPerson[],
  teamA: LineupSlot[],
  teamB: LineupSlot[],
): void {
  const seen = new Map<string, { name: string; slot: "official" | "A" | "B" }>();

  const claim = (
    person: ResolvedPerson,
    slot: "official" | "A" | "B",
  ): void => {
    const identity = personIdentity(person);
    const previous = seen.get(identity);

    if (!previous) {
      seen.set(identity, { name: person.name, slot });
      return;
    }

    if (previous.slot === "official" && slot === "official") {
      throw new MatchInputError(`${person.name} is listed twice as a referee.`);
    }

    if (previous.slot === "official" || slot === "official") {
      throw new MatchInputError(
        `${person.name} is a referee and cannot also play.`,
      );
    }

    if (previous.slot !== slot) {
      throw new MatchInputError(`${person.name} is listed on both teams.`);
    }

    const teamLabel = slot === "A" ? "red side" : "blue side";
    throw new MatchInputError(`${person.name} is listed twice on the ${teamLabel}.`);
  };

  for (const official of officials) {
    claim(official, "official");
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
  assistantId: string | null;
  scoreTeamA: number;
  scoreTeamB: number;
  players: StoredLine[];
}

interface NewMatchMeta {
  status: string;
  submittedBy: string;
  refSheetImageUrl: string | null;
}

interface Submission {
  submitterId: string | null;
  guestName: string;
  addPlayer: boolean;
  rookie: boolean;
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
  const referee = officialPerson(sheet.refereeName, sheet.refereeId, roster, pendingIds);
  const assistant = officialPerson(
    sheet.assistantName,
    sheet.assistantId,
    roster,
    pendingIds,
  );
  const officials = [referee, assistant].flatMap((person) => (person ? [person] : []));

  const toSlot = (line: MatchLine, team: TeamAssigned): LineupSlot => ({
    person: resolveLinkedPerson(line.name, line.playerId, roster, pendingIds),
    team,
    goals: line.goals,
    ownGoals: line.ownGoals,
    fouls: line.fouls,
    isRookie: line.isRookie === true,
  });

  const teamA = sheet.teamA.map((line) => toSlot(line, TeamAssigned.TEAM_A));
  const teamB = sheet.teamB.map((line) => toSlot(line, TeamAssigned.TEAM_B));
  assertDistinct(officials, teamA, teamB);

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
  const assistantId = assistant
    ? await personId(tx, assistant, createdIds, rookieKeys)
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
    assistantId,
    scoreTeamA,
    scoreTeamB,
    players,
  };
}

async function rejectDuplicate(
  tx: Prisma.TransactionClient,
  match: StoredMatch,
  excludeGameId?: string,
): Promise<void> {
  const duplicate = await findDuplicateGame(
    tx,
    {
      scoreTeamA: match.scoreTeamA,
      scoreTeamB: match.scoreTeamB,
      refereeId: match.refereeId,
      assistantId: match.assistantId,
      players: match.players.map((player) => ({
        playerId: player.playerId,
        team: player.teamAssigned,
        goals: player.goals,
      })),
    },
    excludeGameId,
  );

  if (duplicate) {
    throw new MatchInputError(
      "This match is already saved with the same players, scorers, and score.",
    );
  }
}

async function saveMatch(
  tx: Prisma.TransactionClient,
  sheet: MatchSheet,
  meta: NewMatchMeta,
): Promise<void> {
  const match = await buildStoredMatch(tx, sheet);
  await rejectDuplicate(tx, match);

  await tx.game.create({
    data: {
      date: match.date,
      scoreTeamA: match.scoreTeamA,
      scoreTeamB: match.scoreTeamB,
      status: meta.status,
      submittedBy: meta.submittedBy,
      refSheetImageUrl: meta.refSheetImageUrl,
      refereeId: match.refereeId,
      assistantId: match.assistantId,
      players: { create: match.players },
    },
  });
}

async function replaceMatch(
  tx: Prisma.TransactionClient,
  gameId: string,
  sheet: MatchSheet,
  refSheetImageUrl: string | null,
): Promise<void> {
  const existing = await tx.game.findUnique({
    where: { id: gameId },
    select: { id: true, date: true },
  });

  if (!existing) {
    throw new MatchInputError("This match no longer exists.");
  }

  const match = await buildStoredMatch(tx, sheet);
  await rejectDuplicate(tx, match, gameId);
  const date = sameUtcDay(existing.date, match.date) ? existing.date : match.date;

  await tx.game.update({
    where: { id: gameId },
    data: {
      date,
      refereeId: match.refereeId,
      assistantId: match.assistantId,
      scoreTeamA: match.scoreTeamA,
      scoreTeamB: match.scoreTeamB,
      ...(refSheetImageUrl ? { refSheetImageUrl } : {}),
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
  revalidatePath("/games/new");
  revalidatePath("/awards");
  revalidatePath("/admin/finals");
  revalidatePath("/admin/league");
  revalidatePath("/admin/players");

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

function parseNamedOfficial(
  formData: FormData,
  nameKey: string,
  idKey: string,
  label: string,
): { name: string; playerId: string | null } {
  const playerId = String(formData.get(idKey) ?? "").trim();
  const name = cleanDisplayName(String(formData.get(nameKey) ?? ""));

  if (playerId && playerId !== "new") {
    return { name, playerId };
  }

  if (!name) {
    return { name: "", playerId: null };
  }

  if (name.length > MAX_PLAYER_NAME_LENGTH || !normalizeName(name)) {
    throw new MatchInputError(`Use a ${label} name of 1–80 letters or numbers.`);
  }

  return { name, playerId: "new" };
}

function parseSubmittedSheet(formData: FormData, index: number, date: Date): MatchSheet {
  const prefix = `game${index}`;
  const referee = parseNamedOfficial(
    formData,
    `${prefix}Referee`,
    `${prefix}RefereeId`,
    "referee",
  );
  const assistant = parseNamedOfficial(
    formData,
    `${prefix}Assistant`,
    `${prefix}AssistantId`,
    "assistant",
  );

  return {
    date,
    refereeName: referee.name,
    assistantName: assistant.name,
    refereeId: referee.playerId,
    assistantId: assistant.playerId,
    teamA: parseTeam(formData, `${prefix}TeamA`, "red side"),
    teamB: parseTeam(formData, `${prefix}TeamB`, "blue side"),
  };
}

function parseSubmittedGames(formData: FormData): MatchSheet[] {
  const date = parseMatchDate(String(formData.get("date") ?? ""));
  const count = Number(String(formData.get("gameCount") ?? ""));

  if (!date) {
    throw new MatchInputError("Enter a valid match date.");
  }

  if (!Number.isInteger(count) || count < 1 || count > MAX_GAMES_PER_SHEET) {
    throw new MatchInputError(
      `Submit between 1 and ${MAX_GAMES_PER_SHEET} matches from the sheet.`,
    );
  }

  const sheets: MatchSheet[] = [];

  for (let index = 0; index < count; index += 1) {
    try {
      sheets.push(parseSubmittedSheet(formData, index, date));
    } catch (error) {
      if (error instanceof MatchInputError) {
        throw new MatchInputError(`Match ${index + 1}: ${error.message}`);
      }

      throw error;
    }
  }

  return sheets;
}

export async function submitGames(
  _previous: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  let sheets: MatchSheet[];

  try {
    sheets = parseSubmittedGames(formData);
  } catch (error) {
    if (error instanceof MatchInputError) {
      return { error: error.message };
    }

    throw error;
  }

  let submission: Submission;

  try {
    submission = parseSubmission(formData);
  } catch (error) {
    if (error instanceof MatchInputError) {
      return { error: error.message };
    }

    throw error;
  }

  const upload = formData.get("refSheet");
  const hasPhoto = upload instanceof File && upload.size > 0;

  if (!hasPhoto && sheets.length !== 1) {
    return { error: "Without a ref sheet photo, submit one match at a time." };
  }

  let imageUrl: string | null = null;

  try {
    imageUrl = await readUploadedSheet(formData, false);
    await prisma.$transaction(
      async (tx) => {
        const submittedBy = await resolveSubmitter(tx, submission);

        for (const [index, sheet] of sheets.entries()) {
          try {
            await saveMatch(tx, sheet, {
              status: GAME_PENDING,
              submittedBy,
              refSheetImageUrl: imageUrl,
            });
          } catch (error) {
            if (error instanceof MatchInputError) {
              throw new MatchInputError(`Match ${index + 1}: ${error.message}`);
            }

            throw error;
          }
        }
      },
      { timeout: 15000 },
    );
  } catch (error) {
    await removeStoredRefSheet(imageUrl);

    if (error instanceof MatchInputError) {
      return { error: error.message };
    }

    console.error(error);
    return { error: "Could not save these matches. Try again." };
  }

  revalidateMatchViews();
  redirect("/games");
}

export async function createGame(
  _previous: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  const sheet = readMatchSheet(formData);

  if (!isMatchSheet(sheet)) {
    return sheet;
  }

  let submission: Submission;

  try {
    submission = parseSubmission(formData);
  } catch (error) {
    if (error instanceof MatchInputError) {
      return { error: error.message };
    }

    throw error;
  }

  let imageUrl: string | null = null;

  try {
    imageUrl = await readUploadedSheet(formData, true);
    await prisma.$transaction(async (tx) => {
      const submittedBy = await resolveSubmitter(tx, submission);
      await saveMatch(tx, sheet, {
        status: GAME_PENDING,
        submittedBy,
        refSheetImageUrl: imageUrl,
      });
    });
  } catch (error) {
    await removeStoredRefSheet(imageUrl);

    if (error instanceof MatchInputError) {
      return { error: error.message };
    }

    console.error(error);
    return { error: "Could not save this match. Try again." };
  }

  revalidateMatchViews();
  redirect("/games");
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

  let imageUrl: string | null = null;

  try {
    imageUrl = await readUploadedSheet(formData, false);
    await prisma.$transaction((tx) => replaceMatch(tx, gameId, sheet, imageUrl));
  } catch (error) {
    await removeStoredRefSheet(imageUrl);

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

export async function moderateGame(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "");

  if (!id || !isGameStatus(status)) {
    return;
  }

  try {
    await prisma.game.update({
      where: { id },
      data: { status },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return;
    }

    throw error;
  }

  revalidateMatchViews(id);
}
