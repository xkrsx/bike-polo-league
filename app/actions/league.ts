"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export interface LeagueActionState {
  error: string | null;
  message: string | null;
}

const initialFailure = "Could not reset the league. Try again.";

function revalidateLeague(): void {
  revalidatePath("/leaderboard");
  revalidatePath("/games");
  revalidatePath("/games/new");
  revalidatePath("/awards");
  revalidatePath("/admin/finals");
  revalidatePath("/admin/league");
  revalidatePath("/admin/players");
  revalidatePath("/games/[id]/edit", "page");
}

function confirmed(formData: FormData, phrase: string): boolean {
  return String(formData.get("confirm") ?? "").trim() === phrase;
}

export async function resetPlayoffs(
  _previous: LeagueActionState,
  formData: FormData,
): Promise<LeagueActionState> {
  if (!confirmed(formData, "RESET PLAYOFFS")) {
    return { error: 'Type "RESET PLAYOFFS" to clear the bracket.', message: null };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.finals.deleteMany();
      await tx.player.updateMany({ data: { podiumPoints: 0 } });
    });
  } catch (error) {
    console.error(error);
    return { error: initialFailure, message: null };
  }

  revalidateLeague();

  return {
    error: null,
    message: "Playoffs are cleared. The leaderboard is the regular league again.",
  };
}

export async function resetGames(
  _previous: LeagueActionState,
  formData: FormData,
): Promise<LeagueActionState> {
  if (!confirmed(formData, "RESET GAMES")) {
    return { error: 'Type "RESET GAMES" to clear every match.', message: null };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.gamePlayer.deleteMany();
      await tx.game.deleteMany();
    });
  } catch (error) {
    console.error(error);
    return { error: initialFailure, message: null };
  }

  revalidateLeague();

  return {
    error: null,
    message: "Every game is cleared. Players are still in the league.",
  };
}

export async function resetLeague(
  _previous: LeagueActionState,
  formData: FormData,
): Promise<LeagueActionState> {
  if (!confirmed(formData, "RESET LEAGUE")) {
    return { error: 'Type "RESET LEAGUE" to wipe matches and players.', message: null };
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.finals.deleteMany();
        await tx.gamePlayer.deleteMany();
        await tx.game.deleteMany();
        await tx.player.deleteMany();
      },
      { timeout: 15000 },
    );
  } catch (error) {
    console.error(error);
    return { error: initialFailure, message: null };
  }

  revalidateLeague();

  return {
    error: null,
    message: "The league is empty. Games and players are both cleared.",
  };
}
