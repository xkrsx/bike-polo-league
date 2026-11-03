import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { TeamAssigned, type Prisma } from "@prisma/client";
import { LineupColumns, type LineupPlayer } from "@/app/games/lineup-columns";
import { prisma } from "@/lib/prisma";
import { teamA, teamB } from "@/lib/team-colors";

export const metadata: Metadata = {
  title: "Games",
  description: "Winter Bike Polo games",
};

const gameDateFormat = new Intl.DateTimeFormat("en", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default function GamesPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">
            Winter Bike Polo
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Games
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Every recorded game. Open one to correct the date, referee, or
            player stats.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/leaderboard"
            className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Leaderboard
          </Link>
          <Link
            href="/games/new"
            className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Enter game
          </Link>
        </div>
      </header>
      <Suspense fallback={<GamesFallback />}>
        <GamesList />
      </Suspense>
    </main>
  );
}

const gameListSelect = {
  id: true,
  date: true,
  scoreTeamA: true,
  scoreTeamB: true,
  players: {
    select: {
      goals: true,
      ownGoals: true,
      teamAssigned: true,
      player: { select: { id: true, name: true, isRookie: true } },
    },
  },
} satisfies Prisma.GameSelect;

type ListedGame = Prisma.GameGetPayload<{ select: typeof gameListSelect }>;

function sidePlayers(game: ListedGame, team: TeamAssigned): LineupPlayer[] {
  return game.players
    .filter((appearance) => appearance.teamAssigned === team)
    .sort((left, right) =>
      left.player.name.localeCompare(right.player.name, undefined, {
        sensitivity: "base",
      }),
    )
    .map((appearance) => ({
      id: appearance.player.id,
      name: appearance.player.name,
      goals: appearance.goals,
      ownGoals: appearance.ownGoals,
      isRookie: appearance.player.isRookie,
    }));
}

async function GamesList() {
  await connection();
  const games = await prisma.game.findMany({
    select: gameListSelect,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  if (games.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center text-zinc-500 dark:border-zinc-700">
        No games yet.{" "}
        <Link href="/games/new" className="font-medium text-zinc-950 dark:text-zinc-50">
          Enter the first one
        </Link>
        .
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {games.map((game) => {
        const dateLabel = gameDateFormat.format(game.date);
        const scoreLabel = `${game.scoreTeamA} to ${game.scoreTeamB}`;

        return (
          <li
            key={game.id}
            className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-5"
          >
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <p className="text-sm text-zinc-500">{dateLabel}</p>
              <p
                aria-label={`Red ${game.scoreTeamA}, blue ${game.scoreTeamB}`}
                className="text-2xl font-semibold tabular-nums"
              >
                <span className={teamA.text}>{game.scoreTeamA}</span>
                <span className="px-2 text-zinc-400">:</span>
                <span className={teamB.text}>{game.scoreTeamB}</span>
              </p>
              <div className="justify-self-end">
                <Link
                  href={`/games/${game.id}/edit`}
                  aria-label={`Edit game on ${dateLabel}, ${scoreLabel}`}
                  className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-zinc-300 px-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    className="size-4"
                    fill="none"
                  >
                    <path
                      d="M9.5 3.5 12.5 6.5M2.5 13.5l2.2-.4c.2 0 .4-.1.5-.3L12.4 5.6a1.4 1.4 0 0 0-2-2L3.2 10.8c-.2.1-.3.3-.3.5l-.4 2.2Z"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Edit
                </Link>
              </div>
            </div>
            <div className="mt-4">
              <LineupColumns
                left={sidePlayers(game, TeamAssigned.TEAM_A)}
                right={sidePlayers(game, TeamAssigned.TEAM_B)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function GamesFallback() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-36 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-36 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-36 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}
