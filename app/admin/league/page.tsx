import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { LeagueResetPanel } from "./league-reset";

export const metadata: Metadata = {
  title: "League reset",
  description: "Clear playoffs, games, or the whole winter league",
};

const outlineLink =
  "inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900";

export default function LeagueAdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium tracking-wide text-zinc-500">
            BPV winter league 2026/2027
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            League reset
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Maintenance for the season. Each action asks you to type a
            confirmation before anything is deleted.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href="/games" className={outlineLink}>
            Games
          </Link>
          <Link href="/admin/players" className={outlineLink}>
            Players
          </Link>
          <Link href="/admin/finals" className={outlineLink}>
            Finals
          </Link>
        </div>
      </header>
      <Suspense fallback={<LeagueResetFallback />}>
        <LeagueResetLoader />
      </Suspense>
    </main>
  );
}

async function LeagueResetLoader() {
  await connection();
  const [playerCount, gameCount, finalsCount] = await Promise.all([
    prisma.player.count(),
    prisma.game.count(),
    prisma.finals.count(),
  ]);

  return (
    <LeagueResetPanel
      playerCount={playerCount}
      gameCount={gameCount}
      finalsCount={finalsCount}
    />
  );
}

function LeagueResetFallback() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-40 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-40 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-40 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}
