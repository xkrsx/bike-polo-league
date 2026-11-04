"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { podiumPointsForPlace } from "@/lib/player-bonuses";
import { MAX_STAT } from "@/lib/match-sheet";
import { getLeaderboard } from "@/lib/scoring";
import {
  FINALS_FIELD_SIZE,
  isPlayoffRoundName,
  resolvePlayoffBracket,
  snakeDraftTeams,
  teamGoalTotal,
  type PlayoffRoundName,
  type PlayoffScoreLine,
  type TeamPlace,
  type TeamRoster,
} from "@/lib/finals";

export interface FinalsActionState {
  error: string | null;
}

class FinalsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinalsInputError";
  }
}

function revalidateFinalsViews(): void {
  revalidatePath("/leaderboard");
  revalidatePath("/admin/finals");
  revalidatePath("/awards");
  revalidatePath("/admin/players");
}

function fail(error: unknown, fallback: string): FinalsActionState {
  if (error instanceof FinalsInputError) {
    return { error: error.message };
  }

  console.error(error);

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    return { error: "The finals changed while this was saving. Refresh and try again." };
  }

  return { error: fallback };
}

function parseGoals(value: FormDataEntryValue): number {
  const text = typeof value === "string" ? value.trim() : "";

  if (text === "") {
    return 0;
  }

  if (!/^\d{1,2}$/.test(text) || Number(text) > MAX_STAT) {
    throw new FinalsInputError(`Goals must be a whole number from 0 to ${MAX_STAT}.`);
  }

  return Number(text);
}

function readGoalMap(formData: FormData): Map<string, number> {
  const goals = new Map<string, number>();

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("goal:")) {
      continue;
    }

    const playerId = key.slice("goal:".length);

    if (!playerId || goals.has(playerId)) {
      throw new FinalsInputError("This playoff game could not be read.");
    }

    goals.set(playerId, parseGoals(value));
  }

  return goals;
}

function linesForPlayers(
  playerIds: readonly string[],
  goals: ReadonlyMap<string, number>,
): PlayoffScoreLine[] {
  if (goals.size !== playerIds.length || playerIds.some((id) => !goals.has(id))) {
    throw new FinalsInputError("Enter goals for every player in this game.");
  }

  return playerIds.map((playerId) => ({
    playerId,
    goals: goals.get(playerId) ?? 0,
  }));
}

const finalsWriteInclude = {
  teams: {
    include: {
      members: {
        select: { playerId: true },
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

type FinalsWriteRecord = Prisma.FinalsGetPayload<{ include: typeof finalsWriteInclude }>;

function rostersOf(finals: FinalsWriteRecord): TeamRoster[] {
  return finals.teams.map((team) => ({
    number: team.number,
    playerIds: team.members.map((member) => member.playerId),
  }));
}

function idsForTeam(teams: readonly TeamRoster[], number: number): string[] {
  const team = teams.find((item) => item.number === number);

  if (!team || team.playerIds.length !== 3) {
    throw new FinalsInputError("This finals team is missing players.");
  }

  return [...team.playerIds];
}

async function syncPodium(
  tx: Prisma.TransactionClient,
  teams: readonly TeamRoster[],
  places: readonly TeamPlace[] | null,
): Promise<void> {
  const pointsByTeam = new Map<number, number>();

  for (const place of places ?? []) {
    pointsByTeam.set(place.teamNumber, podiumPointsForPlace(place.place));
  }

  for (const team of teams) {
    const points = pointsByTeam.get(team.number) ?? 0;

    for (const playerId of team.playerIds) {
      await tx.player.update({
        where: { id: playerId },
        data: { podiumPoints: points },
      });
    }
  }
}

export async function generateFinals(
  _previous: FinalsActionState,
  formData: FormData,
): Promise<FinalsActionState> {
  void formData;

  try {
    const standings = await getLeaderboard();

    if (standings.length < FINALS_FIELD_SIZE) {
      return {
        error: `Finals need the top ${FINALS_FIELD_SIZE} players. The leaderboard has ${standings.length}.`,
      };
    }

    const picks = snakeDraftTeams(standings);
    const ids = picks.flatMap((team) => team.map((pick) => pick.player.id));

    if (new Set(ids).size !== FINALS_FIELD_SIZE) {
      throw new FinalsInputError("The top 12 include a duplicate player.");
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.finals.findMany({
        include: {
          matches: {
            include: { lines: { select: { playerId: true } } },
          },
        },
      });

      if (existing.some((finals) => finals.matches.some((match) => match.lines.length > 0))) {
        throw new FinalsInputError(
          "Rosters are locked because a playoff result has been saved.",
        );
      }

      const found = await tx.player.count({ where: { id: { in: ids } } });

      if (found !== FINALS_FIELD_SIZE) {
        throw new FinalsInputError(
          "A ranked player is no longer on the roster. Generate the finals again.",
        );
      }

      if (existing.length > 0) {
        await tx.finals.deleteMany();
      }

      await tx.player.updateMany({
        where: { id: { in: ids } },
        data: { podiumPoints: 0 },
      });

      await tx.finals.create({
        data: {
          locked: true,
          teams: {
            create: picks.map((team, index) => ({
              number: index + 1,
              members: {
                create: team.map((pick) => ({
                  playerId: pick.player.id,
                  seedRank: pick.rank,
                })),
              },
            })),
          },
          matches: {
            create: [
              { round: "SEMIFINAL_1", homeNumber: 1, awayNumber: 4 },
              { round: "SEMIFINAL_2", homeNumber: 2, awayNumber: 3 },
              { round: "THIRD_PLACE" },
              { round: "GRAND_FINAL" },
            ],
          },
        },
      });
    });
  } catch (error) {
    return fail(error, "Could not generate the finals. Try again.");
  }

  revalidateFinalsViews();

  return { error: null };
}

export async function savePlayoffMatch(
  _previous: FinalsActionState,
  formData: FormData,
): Promise<FinalsActionState> {
  const roundValue = String(formData.get("round") ?? "");

  if (!isPlayoffRoundName(roundValue)) {
    return { error: "Choose a playoff game to save." };
  }

  const round: PlayoffRoundName = roundValue;

  try {
    const submitted = readGoalMap(formData);

    await prisma.$transaction(
      async (tx) => {
        const finals = await tx.finals.findFirst({
          orderBy: { createdAt: "desc" },
          include: finalsWriteInclude,
        });

        if (!finals) {
          throw new FinalsInputError("Generate the finals before entering a result.");
        }

        const match = finals.matches.find((item) => item.round === round);

        if (!match || match.homeNumber === null || match.awayNumber === null) {
          throw new FinalsInputError("Play both semi-finals before this game.");
        }

        const teams = rostersOf(finals);
        const homeIds = idsForTeam(teams, match.homeNumber);
        const awayIds = idsForTeam(teams, match.awayNumber);
        const expected = [...homeIds, ...awayIds];

        if (new Set(expected).size !== expected.length) {
          throw new FinalsInputError("A player is listed on both teams.");
        }

        const lines = linesForPlayers(expected, submitted);
        const homeGoals = teamGoalTotal(lines, homeIds);
        const awayGoals = teamGoalTotal(lines, awayIds);

        if (homeGoals === awayGoals) {
          throw new FinalsInputError("Playoff games need a winner.");
        }

        await tx.playoffLine.deleteMany({ where: { matchId: match.id } });
        await tx.playoffLine.createMany({
          data: lines.map((line) => ({
            matchId: match.id,
            playerId: line.playerId,
            goals: line.goals,
          })),
        });

        const states = finals.matches.map((item) => ({
          round: item.round,
          homeNumber: item.homeNumber,
          awayNumber: item.awayNumber,
          lines:
            item.id === match.id
              ? lines
              : item.lines.map((line) => ({
                  playerId: line.playerId,
                  goals: line.goals,
                })),
        }));
        const resolution = resolvePlayoffBracket(states, teams);

        for (const update of resolution.updates) {
          const target = finals.matches.find((item) => item.round === update.round);

          if (!target) {
            throw new FinalsInputError("The playoff bracket is missing a game.");
          }

          await tx.playoffMatch.update({
            where: { id: target.id },
            data: {
              homeNumber: update.homeNumber,
              awayNumber: update.awayNumber,
            },
          });

          if (update.clearLines) {
            await tx.playoffLine.deleteMany({ where: { matchId: target.id } });
          }
        }

        await syncPodium(tx, teams, resolution.places);
      },
      { timeout: 15000 },
    );
  } catch (error) {
    return fail(error, "Could not save this playoff game. Try again.");
  }

  revalidateFinalsViews();

  return { error: null };
}
