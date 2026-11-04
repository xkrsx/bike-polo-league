import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { PlayerBonusList } from "./player-bonus-form";

export const metadata: Metadata = {
  title: "Players",
  description: "Edit players, rookie status, costume bonuses, and podium points",
};

export default function PlayerAdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium tracking-wide text-zinc-500">
            BPV winter league 2026/2027
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Players
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Edit a name, rookie status, and bonuses. Costume is +5. A custom
            bonus adds its own label and value. Podium places are worth 15, 10,
            or 5. Players in a game cannot be deleted; merge them into another
            player to move those games.
          </p>
        </div>
        <Link
          href="/leaderboard"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
        >
          Leaderboard
        </Link>
      </header>
      <Suspense fallback={<PlayerAdminFallback />}>
        <PlayerAdminLoader />
      </Suspense>
    </main>
  );
}

async function PlayerAdminLoader() {
  await connection();
  const players = await prisma.player.findMany({
    select: {
      id: true,
      name: true,
      isRookie: true,
      extraPoints: true,
      podiumPoints: true,
      costumeBonus: true,
      customBonusLabel: true,
      customBonusValue: true,
      _count: {
        select: {
          gameStats: true,
          refereedGames: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <PlayerBonusList
      players={players.map((player) => ({
        id: player.id,
        name: player.name,
        isRookie: player.isRookie,
        extraPoints: player.extraPoints,
        podiumPoints: player.podiumPoints,
        costumeBonus: player.costumeBonus,
        customBonusLabel: player.customBonusLabel,
        customBonusValue: player.customBonusValue,
        gamesPlayed: player._count.gameStats,
        gamesRefereed: player._count.refereedGames,
      }))}
    />
  );
}

function PlayerAdminFallback() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-14 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-14 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-14 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}
