import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { TeamAssigned, type Prisma } from "@prisma/client";
import { moderateGame } from "@/app/actions/game";
import { LineupColumns, type LineupPlayer } from "@/app/games/lineup-columns";
import {
  GAME_APPROVED,
  GAME_REJECTED,
  gameStatusLabel,
} from "@/lib/game-status";
import { prisma } from "@/lib/prisma";
import { teamA, teamB } from "@/lib/team-colors";

export const metadata: Metadata = {
  title: "Games",
  description: "BPV winter league 2026/2027 games",
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
          <p className="text-sm font-medium tracking-wide text-zinc-500">
            BPV winter league 2026/2027
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Games
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Every recorded game. Pending and rejected games stay off the
            leaderboard until you approve them.
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
            href="/admin/league"
            className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Reset
          </Link>
          <Link
            href="/games/new"
            className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Submit games
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
  status: true,
  submittedBy: true,
  refSheetImageUrl: true,
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
          Submit the first sheet
        </Link>
        .
      </p>
    );
  }

  const pendingCount = games.filter((game) => game.status === "PENDING").length;

  return (
    <div className="flex flex-col gap-3">
      {pendingCount > 0 ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {pendingCount === 1 ? "1 game is" : `${pendingCount} games are`} waiting for approval.
          Approved games are the ones on the leaderboard.
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
      {games.map((game) => {
        const dateLabel = gameDateFormat.format(game.date);
        const scoreLabel = `${game.scoreTeamA} to ${game.scoreTeamB}`;
        const statusClass =
          game.status === GAME_APPROVED
            ? "bg-emerald-100 text-emerald-950 dark:bg-emerald-400/15 dark:text-emerald-100"
            : game.status === GAME_REJECTED
              ? "bg-rose-100 text-rose-950 dark:bg-rose-400/15 dark:text-rose-100"
              : "bg-amber-100 text-amber-950 dark:bg-amber-400/15 dark:text-amber-100";

        return (
          <li
            key={game.id}
            className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-5"
          >
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <Link
                href={`/games/${game.id}`}
                className="text-sm text-zinc-500 underline-offset-4 hover:underline"
              >
                {dateLabel}
              </Link>
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
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass}`}>
                {gameStatusLabel(game.status)}
              </span>
              {game.submittedBy ? (
                <span className="text-sm text-zinc-500">Submitted by {game.submittedBy}</span>
              ) : null}
              {game.refSheetImageUrl ? (
                <a
                  href={game.refSheetImageUrl}
                  className="text-sm font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-50"
                >
                  Ref sheet
                </a>
              ) : null}
              {game.status !== GAME_APPROVED ? (
                <form action={moderateGame}>
                  <input type="hidden" name="id" value={game.id} />
                  <input type="hidden" name="status" value={GAME_APPROVED} />
                  <button
                    type="submit"
                    className="inline-flex h-8 items-center rounded-full bg-zinc-950 px-3 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
                  >
                    Approve
                  </button>
                </form>
              ) : null}
              {game.status !== GAME_REJECTED ? (
                <form action={moderateGame}>
                  <input type="hidden" name="id" value={game.id} />
                  <input type="hidden" name="status" value={GAME_REJECTED} />
                  <button
                    type="submit"
                    className="inline-flex h-8 items-center rounded-full border border-zinc-300 px-3 text-xs font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
                  >
                    Reject
                  </button>
                </form>
              ) : null}
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
    </div>
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
