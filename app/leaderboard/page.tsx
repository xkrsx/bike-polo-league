import type { Metadata } from "next";
import Link from "next/link";
import { getLeaderboard } from "@/lib/scoring";
import { LeaderboardTable } from "./leaderboard-table";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "BPV winter league 2026/2027 standings",
};

export default async function LeaderboardPage() {
  const standings = await getLeaderboard();

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium tracking-wide text-zinc-500">
            BPV winter league 2026/2027
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Leaderboard
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Win 5, draw 2, loss 1. A team with a scoring rookie gets 1 extra
            point, and that rookie gets 1 more. Extra and podium bonuses are
            added on top. Ties break on goal difference, then goals scored.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/games"
            className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Games
          </Link>
          <Link
            href="/admin/players"
            className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Players
          </Link>
          <Link
            href="/games/new"
            className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Enter game
          </Link>
        </div>
      </header>
      <LeaderboardTable standings={standings} />
    </main>
  );
}
