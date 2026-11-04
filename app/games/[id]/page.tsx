import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { TeamAssigned, type Prisma } from "@prisma/client";
import { LineupColumns, type LineupPlayer } from "@/app/games/lineup-columns";
import { GAME_APPROVED, GAME_REJECTED, gameStatusLabel } from "@/lib/game-status";
import { prisma } from "@/lib/prisma";
import { teamA, teamB } from "@/lib/team-colors";

export const metadata: Metadata = {
  title: "Game",
  description: "A recorded bike polo game",
};

const gameDateFormat = new Intl.DateTimeFormat("en", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const outlineLink =
  "inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900";

const gameSelect = {
  id: true,
  date: true,
  status: true,
  submittedBy: true,
  refSheetImageUrl: true,
  scoreTeamA: true,
  scoreTeamB: true,
  referee: { select: { name: true } },
  assistant: { select: { name: true } },
  players: {
    select: {
      goals: true,
      ownGoals: true,
      fouls: true,
      teamAssigned: true,
      player: { select: { id: true, name: true, isRookie: true } },
    },
  },
} satisfies Prisma.GameSelect;

type GameRecord = Prisma.GameGetPayload<{ select: typeof gameSelect }>;

function sidePlayers(game: GameRecord, team: TeamAssigned): LineupPlayer[] {
  return game.players
    .filter((appearance) => appearance.teamAssigned === team)
    .sort((left, right) =>
      left.player.name.localeCompare(right.player.name, undefined, { sensitivity: "base" }),
    )
    .map((appearance) => ({
      id: appearance.player.id,
      name: appearance.player.name,
      goals: appearance.goals,
      ownGoals: appearance.ownGoals,
      isRookie: appearance.player.isRookie,
    }));
}

export default function GamePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <Suspense fallback={<GameFallback />}>
        <GameLoader params={params} />
      </Suspense>
    </main>
  );
}

async function GameLoader({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const game = await prisma.game.findUnique({
    where: { id },
    select: gameSelect,
  });

  if (!game) {
    notFound();
  }

  const dateLabel = gameDateFormat.format(game.date);
  const statusClass =
    game.status === GAME_APPROVED
      ? "bg-emerald-100 text-emerald-950 dark:bg-emerald-400/15 dark:text-emerald-100"
      : game.status === GAME_REJECTED
        ? "bg-rose-100 text-rose-950 dark:bg-rose-400/15 dark:text-rose-100"
        : "bg-amber-100 text-amber-950 dark:bg-amber-400/15 dark:text-amber-100";

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium tracking-wide text-zinc-500">
            BPV winter league 2026/2027
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {dateLabel}
          </h1>
          <p
            aria-label={`Red ${game.scoreTeamA}, blue ${game.scoreTeamB}`}
            className="text-4xl font-semibold tabular-nums"
          >
            <span className={teamA.text}>{game.scoreTeamA}</span>
            <span className="px-2 text-zinc-400">:</span>
            <span className={teamB.text}>{game.scoreTeamB}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href="/games" className={outlineLink}>
            Games
          </Link>
          <Link href={`/games/${game.id}/edit`} className={outlineLink}>
            Edit
          </Link>
        </div>
      </header>
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass}`}>
            {gameStatusLabel(game.status)}
          </span>
          {game.submittedBy ? (
            <span className="text-sm text-zinc-500">Submitted by {game.submittedBy}</span>
          ) : null}
          <span className="text-sm text-zinc-500">
            Ref {game.referee?.name ?? "—"}. Assistant {game.assistant?.name ?? "—"}.
          </span>
        </div>
        <div className="mt-4">
          <LineupColumns
            left={sidePlayers(game, TeamAssigned.TEAM_A)}
            right={sidePlayers(game, TeamAssigned.TEAM_B)}
          />
        </div>
        {game.refSheetImageUrl ? (
          <figure className="mt-6">
            <a href={game.refSheetImageUrl}>
              {/* Stored ref sheets are local upload URLs, not remote optimizer sources. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={game.refSheetImageUrl}
                alt={`Ref sheet photo for the game on ${dateLabel}`}
                className="max-h-[36rem] w-full rounded-lg object-contain"
              />
            </a>
            <figcaption className="mt-3">
              <a
                href={game.refSheetImageUrl}
                className="text-sm font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-50"
              >
                Open ref sheet photo
              </a>
            </figcaption>
          </figure>
        ) : null}
      </section>
    </>
  );
}

function GameFallback() {
  return (
    <>
      <div className="h-28 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-900" />
      <div className="h-80 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
    </>
  );
}
