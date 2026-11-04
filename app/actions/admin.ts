"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { MAX_PLAYER_NAME_LENGTH } from "@/lib/match-sheet";
import {
  MAX_BONUS_LABEL_LENGTH,
  MAX_CUSTOM_BONUS_VALUE,
  MIN_CUSTOM_BONUS_VALUE,
  isPodiumPoints,
  playerDeleteBlockReason,
  sumExtraPoints,
} from "@/lib/player-bonuses";
import { cleanDisplayName, normalizeName } from "@/lib/player-match";

export interface PlayerActionState {
  error: string | null;
  saved: boolean;
}

export interface DeletePlayerState {
  error: string | null;
}

export interface MergePlayerState {
  error: string | null;
  merged: boolean;
}

class PlayerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayerInputError";
  }
}

function revalidatePlayerViews(): void {
  revalidatePath("/leaderboard");
  revalidatePath("/admin/players");
  revalidatePath("/admin/finals");
  revalidatePath("/awards");
  revalidatePath("/games");
  revalidatePath("/games/new");
  revalidatePath("/games/[id]/edit", "page");
}

function parseName(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") {
    throw new PlayerInputError("Enter a player name.");
  }

  const name = cleanDisplayName(value);

  if (!name || name.length > MAX_PLAYER_NAME_LENGTH || !normalizeName(name)) {
    throw new PlayerInputError("Use a player name of 1–80 letters or numbers.");
  }

  return name;
}

function parseCustomLabel(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") {
    throw new PlayerInputError("Enter a label for the custom bonus.");
  }

  const label = cleanDisplayName(value);

  if (!label) {
    throw new PlayerInputError("Enter a label for the custom bonus.");
  }

  if (label.length > MAX_BONUS_LABEL_LENGTH) {
    throw new PlayerInputError("Use a custom bonus label of 80 characters or fewer.");
  }

  return label;
}

function parseCustomValue(value: FormDataEntryValue | null): number {
  const text = String(value ?? "").trim();

  if (!/^-?\d{1,3}$/.test(text)) {
    throw new PlayerInputError("Custom bonus value must be a whole number from -999 to 999.");
  }

  const points = Number(text);

  if (points < MIN_CUSTOM_BONUS_VALUE || points > MAX_CUSTOM_BONUS_VALUE) {
    throw new PlayerInputError("Custom bonus value must be a whole number from -999 to 999.");
  }

  return points;
}

function parsePodiumPoints(value: FormDataEntryValue | null): number {
  const text = String(value ?? "").trim();

  if (!/^\d{1,2}$/.test(text) || !isPodiumPoints(Number(text))) {
    throw new PlayerInputError("Choose a podium place.");
  }

  return Number(text);
}

export async function updatePlayer(
  _previous: PlayerActionState,
  formData: FormData,
): Promise<PlayerActionState> {
  const id = String(formData.get("id") ?? "").trim();

  if (!id) {
    return { error: "Choose a player to update.", saved: false };
  }

  let name: string;
  let podiumPoints: number;
  let costumeBonus: boolean;
  let customBonusLabel: string;
  let customBonusValue: number;

  try {
    name = parseName(formData.get("name"));
    podiumPoints = parsePodiumPoints(formData.get("podiumPoints"));
    costumeBonus = formData.get("costumeBonus") === "on";
    const customBonusEnabled = formData.get("customBonus") === "on";
    customBonusLabel = customBonusEnabled
      ? parseCustomLabel(formData.get("customBonusLabel"))
      : "";
    customBonusValue = customBonusEnabled
      ? parseCustomValue(formData.get("customBonusValue"))
      : 0;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not read this player.",
      saved: false,
    };
  }

  const isRookie = formData.get("isRookie") === "on";
  const extraPoints = sumExtraPoints(costumeBonus, customBonusValue);
  const normalizedName = normalizeName(name);

  try {
    const roster = await prisma.player.findMany({
      select: { id: true, name: true },
    });
    const clash = roster.find(
      (player) => player.id !== id && normalizeName(player.name) === normalizedName,
    );

    if (clash) {
      return {
        error: `Another player is already named ${clash.name}.`,
        saved: false,
      };
    }

    await prisma.player.update({
      where: { id },
      data: {
        name,
        isRookie,
        extraPoints,
        podiumPoints,
        costumeBonus,
        customBonusLabel,
        customBonusValue,
      },
    });
  } catch (error) {
    console.error(error);

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return { error: "This player was already removed.", saved: false };
    }

    return { error: "Could not save this player. Try again.", saved: false };
  }

  revalidatePlayerViews();

  return { error: null, saved: true };
}

export async function deletePlayer(
  _previous: DeletePlayerState,
  formData: FormData,
): Promise<DeletePlayerState> {
  const id = String(formData.get("id") ?? "").trim();

  if (!id) {
    return { error: "Choose a player to delete." };
  }

  try {
    const player = await prisma.player.findUnique({
      where: { id },
      select: {
        name: true,
        _count: {
          select: {
            gameStats: true,
            refereedGames: true,
            finalsRoster: true,
            playoffLines: true,
          },
        },
      },
    });

    if (!player) {
      return { error: "This player was already removed." };
    }

    const blocked = playerDeleteBlockReason(
      player.name,
      player._count.gameStats,
      player._count.refereedGames,
    );

    if (blocked) {
      return { error: blocked };
    }

    if (player._count.finalsRoster > 0 || player._count.playoffLines > 0) {
      return { error: `${player.name} is in the finals and cannot be deleted.` };
    }

    await prisma.player.delete({ where: { id } });
  } catch (error) {
    console.error(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2003" || error.code === "P2014") {
        return {
          error: "This player is still attached to a game and cannot be deleted.",
        };
      }

      if (error.code === "P2025") {
        return { error: "This player was already removed." };
      }
    }

    return { error: "Could not delete this player. Try again." };
  }

  revalidatePlayerViews();

  return { error: null };
}

async function moveFinalsIdentity(
  tx: Prisma.TransactionClient,
  sourceId: string,
  targetId: string,
  sourceName: string,
  targetName: string,
): Promise<void> {
  const seats = await tx.finalsRoster.findMany({
    where: { playerId: sourceId },
    select: { teamId: true, team: { select: { finalsId: true } } },
  });

  for (const seat of seats) {
    const targetSeat = await tx.finalsRoster.findFirst({
      where: {
        playerId: targetId,
        team: { finalsId: seat.team.finalsId },
      },
      select: { teamId: true },
    });

    if (targetSeat && targetSeat.teamId !== seat.teamId) {
      throw new PlayerInputError(
        `${sourceName} and ${targetName} are on different finals teams. Resolve the finals before merging them.`,
      );
    }

    if (targetSeat) {
      await tx.finalsRoster.delete({
        where: { teamId_playerId: { teamId: seat.teamId, playerId: sourceId } },
      });
    } else {
      await tx.finalsRoster.update({
        where: { teamId_playerId: { teamId: seat.teamId, playerId: sourceId } },
        data: { playerId: targetId },
      });
    }
  }

  const lines = await tx.playoffLine.findMany({
    where: { playerId: sourceId },
    select: { matchId: true, goals: true },
  });

  for (const line of lines) {
    const existing = await tx.playoffLine.findUnique({
      where: {
        matchId_playerId: { matchId: line.matchId, playerId: targetId },
      },
      select: { goals: true },
    });

    if (!existing) {
      await tx.playoffLine.update({
        where: {
          matchId_playerId: { matchId: line.matchId, playerId: sourceId },
        },
        data: { playerId: targetId },
      });
      continue;
    }

    await tx.playoffLine.update({
      where: {
        matchId_playerId: { matchId: line.matchId, playerId: targetId },
      },
      data: { goals: existing.goals + line.goals },
    });
    await tx.playoffLine.delete({
      where: {
        matchId_playerId: { matchId: line.matchId, playerId: sourceId },
      },
    });
  }
}

export async function mergePlayer(
  _previous: MergePlayerState,
  formData: FormData,
): Promise<MergePlayerState> {
  const sourceId = String(formData.get("sourceId") ?? "").trim();
  const targetId = String(formData.get("targetId") ?? "").trim();

  if (!sourceId || !targetId) {
    return { error: "Choose the player who should keep the games.", merged: false };
  }

  if (sourceId === targetId) {
    return { error: "Choose a different player to merge into.", merged: false };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const [source, target] = await Promise.all([
        tx.player.findUnique({
          where: { id: sourceId },
          select: { id: true, name: true },
        }),
        tx.player.findUnique({
          where: { id: targetId },
          select: { id: true, name: true },
        }),
      ]);

      if (!source || !target) {
        throw new PlayerInputError("Choose two players who are still on the roster.");
      }

      const [sourceLines, targetLines] = await Promise.all([
        tx.gamePlayer.findMany({ where: { playerId: sourceId } }),
        tx.gamePlayer.findMany({ where: { playerId: targetId } }),
      ]);
      const targetByGame = new Map(targetLines.map((line) => [line.gameId, line]));

      for (const line of sourceLines) {
        const existing = targetByGame.get(line.gameId);

        if (!existing) {
          await tx.gamePlayer.update({
            where: {
              gameId_playerId: { gameId: line.gameId, playerId: sourceId },
            },
            data: { playerId: targetId },
          });
          continue;
        }

        if (existing.teamAssigned !== line.teamAssigned) {
          throw new PlayerInputError(
            `${source.name} and ${target.name} are on opposite sides of the same game. Fix that lineup before merging.`,
          );
        }

        await tx.gamePlayer.update({
          where: {
            gameId_playerId: { gameId: line.gameId, playerId: targetId },
          },
          data: {
            goals: existing.goals + line.goals,
            ownGoals: existing.ownGoals + line.ownGoals,
            fouls: (existing.fouls ?? 0) + (line.fouls ?? 0),
          },
        });
        await tx.gamePlayer.delete({
          where: {
            gameId_playerId: { gameId: line.gameId, playerId: sourceId },
          },
        });
      }

      const refereedGames = await tx.game.findMany({
        where: { refereeId: sourceId },
        select: { id: true },
      });

      for (const game of refereedGames) {
        const targetPlays = await tx.gamePlayer.findUnique({
          where: {
            gameId_playerId: { gameId: game.id, playerId: targetId },
          },
          select: { playerId: true },
        });

        if (targetPlays) {
          throw new PlayerInputError(
            `${target.name} plays in a game that ${source.name} refereed. Fix that game before merging.`,
          );
        }

        await tx.game.update({
          where: { id: game.id },
          data: { refereeId: targetId },
        });
      }

      await moveFinalsIdentity(tx, sourceId, targetId, source.name, target.name);
      await tx.player.delete({ where: { id: sourceId } });
    });
  } catch (error) {
    if (error instanceof PlayerInputError) {
      return { error: error.message, merged: false };
    }

    console.error(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return {
          error: "Those players share a game that cannot be combined. Fix the lineup first.",
          merged: false,
        };
      }

      if (error.code === "P2025") {
        return { error: "One of these players was already removed.", merged: false };
      }
    }

    return { error: "Could not merge these players. Try again.", merged: false };
  }

  revalidatePlayerViews();

  return { error: null, merged: true };
}
