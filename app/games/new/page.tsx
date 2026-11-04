import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatMatchDateInput } from "@/lib/match-sheet";
import { GameWizard } from "./game-wizard";

export const metadata: Metadata = {
  title: "Submit games",
  description: "Submit bike polo results from a ref sheet photo or one match entered by hand",
};

export default function NewGamePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium tracking-wide text-zinc-500">
            BPV winter league 2026/2027
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Submit games
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Upload a ref sheet photo, or continue without a photo and enter one
            match by hand. Every game stays pending until it is approved.
          </p>
        </div>
        <Link
          href="/leaderboard"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
        >
          Leaderboard
        </Link>
      </header>
      <Suspense fallback={<MatchEntryFallback />}>
        <MatchEntryLoader />
      </Suspense>
    </main>
  );
}

async function MatchEntryLoader() {
  await connection();
  const players = await prisma.player.findMany({
    select: { id: true, name: true, isRookie: true },
    orderBy: { name: "asc" },
  });

  return (
    <GameWizard players={players} defaultDate={formatMatchDateInput(new Date())} />
  );
}

function MatchEntryFallback() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-28 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-900" />
      <div className="h-40 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-80 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
        <div className="h-80 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
      </div>
    </div>
  );
}
