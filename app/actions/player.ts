"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export interface PlayerActionState {
  error: string | null;
  saved: boolean;
}

function parsePoints(value: FormDataEntryValue | null, label: string): number {
  const text = String(value ?? "").trim();

  if (!/^-?\d{1,4}$/.test(text)) {
    throw new Error(`${label} must be a whole number.`);
  }

  const points = Number(text);

  if (points < -999 || points > 999) {
    throw new Error(`${label} must be between -999 and 999.`);
  }

  return points;
}

export async function updatePlayer(
  _previous: PlayerActionState,
  formData: FormData,
): Promise<PlayerActionState> {
  const id = String(formData.get("id") ?? "").trim();

  if (!id) {
    return { error: "Choose a player to update.", saved: false };
  }

  let extraPoints: number;
  let podiumPoints: number;

  try {
    extraPoints = parsePoints(formData.get("extraPoints"), "Extra points");
    podiumPoints = parsePoints(formData.get("podiumPoints"), "Podium points");
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not read the bonuses.",
      saved: false,
    };
  }

  const isRookie = formData.get("isRookie") === "on";

  try {
    await prisma.player.update({
      where: { id },
      data: { extraPoints, podiumPoints, isRookie },
    });
  } catch (error) {
    console.error(error);
    return { error: "Could not save this player. Try again.", saved: false };
  }

  revalidatePath("/leaderboard");
  revalidatePath("/admin/players");

  return { error: null, saved: true };
}
