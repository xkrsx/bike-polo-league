import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { TeamAssigned } from "@prisma/client";
import { updateGame } from "@/app/actions/game";
import { prisma } from "@/lib/prisma";
import { formatStoredMatchDate } from "@/lib/match-sheet";
import {
  MatchEntryForm,
  type MatchEntryLine,
} from "../../new/match-entry-form";

export const metadata: Metadata = {
  title: "Edit game",
  description: "Update a bike polo result",
};

export default function EditGamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">
            Winter Bike Polo
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Edit game
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Update the sheet for this game. The score adds the other team&apos;s
            own goals automatically, and a close name links to a player already
            in the league.
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
            href="/leaderboard"
            className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Leaderboard
          </Link>
        </div>
      </header>
      <Suspense fallback={<EditGameFallback />}>
        <EditGameLoader params={params} />
      </Suspense>
    </main>
  );
}

interface StoredAppearance {
  teamAssigned: TeamAssigned;
  goals: number;
  ownGoals: number;
  fouls: number | null;
  player: { name: string };
}

function linesFor(players: StoredAppearance[], team: TeamAssigned): MatchEntryLine[] {
  return players
    .filter((appearance) => appearance.teamAssigned === team)
    .sort((left, right) =>
      left.player.name.localeCompare(right.player.name, undefined, {
        sensitivity: "base",
      }),
    )
    .slice(0, 3)
    .map((appearance) => ({
      name: appearance.player.name,
      goals: appearance.goals,
      ownGoals: appearance.ownGoals,
      fouls: appearance.fouls ?? 0,
    }));
}

async function EditGameLoader({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  const [game, players] = await Promise.all([
    prisma.game.findUnique({
      where: { id },
      select: {
        id: true,
        date: true,
        referee: { select: { name: true } },
        players: {
          select: {
            teamAssigned: true,
            goals: true,
            ownGoals: true,
            fouls: true,
            player: { select: { name: true } },
          },
        },
      },
    }),
    prisma.player.findMany({
      select: { id: true, name: true, isRookie: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!game) {
    notFound();
  }

  return (
    <MatchEntryForm
      key={game.id}
      players={players}
      defaultDate={formatStoredMatchDate(game.date)}
      initial={{
        referee: game.referee?.name ?? "",
        teamA: linesFor(game.players, TeamAssigned.TEAM_A),
        teamB: linesFor(game.players, TeamAssigned.TEAM_B),
      }}
      action={updateGame.bind(null, game.id)}
      submitLabel="Save Changes"
      pendingLabel="Saving…"
      idleMessage="Saving updates the leaderboard and the games list."
      cancelHref="/games"
    />
  );
}

function EditGameFallback() {
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
