import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { PlayerBonusList } from "./player-bonus-form";

export const metadata: Metadata = {
  title: "Player bonuses",
  description: "Set extra points, podium points, and rookie status",
};

export default function PlayerAdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">
            Winter Bike Polo
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Player bonuses
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Extra points and podium points are added to each player&apos;s
            total, along with points from games and individual rookie bonuses.
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
    },
    orderBy: { name: "asc" },
  });

  return <PlayerBonusList players={players} />;
}

function PlayerAdminFallback() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-28 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-28 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-28 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}
