import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { seasonAwards, waitingAwards, type AwardPlayer, type SeasonAward } from "@/lib/awards";
import { areFinalsComplete } from "@/lib/finals-data";
import { prisma } from "@/lib/prisma";
import { getLeaderboard } from "@/lib/scoring";

export const metadata: Metadata = {
  title: "Awards",
  description: "End-of-season awards for the BPV winter league",
};

const outlineLink =
  "inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900";

export default function AwardsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium tracking-wide text-zinc-500">
            BPV winter league 2026/2027
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Awards
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            End-of-season titles from the final leaderboard, including playoff
            goals and podium points.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href="/leaderboard" className={outlineLink}>
            Leaderboard
          </Link>
          <Link href="/admin/finals" className={outlineLink}>
            Finals
          </Link>
        </div>
      </header>
      <Suspense fallback={<AwardsFallback />}>
        <AwardsLoader />
      </Suspense>
    </main>
  );
}

async function AwardsLoader() {
  await connection();
  const [standings, refereeRows, complete] = await Promise.all([
    getLeaderboard(),
    prisma.game.groupBy({
      by: ["refereeId"],
      where: { refereeId: { not: null } },
      _count: { _all: true },
    }),
    areFinalsComplete(),
  ]);
  const referees = new Map<string, number>();

  for (const row of refereeRows) {
    if (row.refereeId) {
      referees.set(row.refereeId, row._count._all);
    }
  }

  const players: AwardPlayer[] = standings.map((player) => ({
    id: player.id,
    name: player.name,
    isRookie: player.isRookie,
    points: player.points,
    matchPoints: player.points - player.bonusPoints,
    gamesPlayed: player.gamesPlayed,
    goals: player.goals,
    goalsConceded: player.goalsConceded,
    cleanSheets: player.cleanSheets,
    fouls: player.fouls,
    goalDifference: player.goalDifference,
    gamesRefereed: referees.get(player.id) ?? 0,
  }));
  const awards = complete ? seasonAwards(players) : waitingAwards();

  return (
    <div className="flex flex-col gap-4">
      {complete ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The Grand Final and the 3rd place match are finished.
        </p>
      ) : (
        <p className="rounded-2xl border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          These titles are calculated after the Grand Final and the 3rd place
          match.{" "}
          <Link href="/admin/finals" className="font-medium text-zinc-950 dark:text-zinc-50">
            Enter the finals
          </Link>
          .
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {awards.map((award) => (
          <AwardCard key={award.id} award={award} />
        ))}
      </div>
    </div>
  );
}

function AwardCard({ award }: { award: SeasonAward }) {
  const featured = award.id === "quing";

  return (
    <article
      className={`rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 ${
        featured ? "sm:col-span-2" : ""
      }`}
    >
      <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        {award.title}
      </h2>
      <p className="mt-1 text-sm text-zinc-500">{award.criterion}</p>
      <p className="mt-1 text-sm text-zinc-500">{award.method}</p>
      {award.winners.length > 1 ? (
        <p className="mt-4 text-xs font-medium tracking-wide text-zinc-500 uppercase">
          Shared
        </p>
      ) : null}
      {award.winners.length > 0 ? (
        <ul className={`flex flex-col gap-3 ${award.winners.length > 1 ? "mt-2" : "mt-4"}`}>
          {award.winners.map((winner) => (
            <li key={winner.id}>
              <p
                className={`font-semibold tracking-tight text-balance text-zinc-950 dark:text-zinc-50 ${
                  featured ? "text-3xl" : "text-2xl"
                }`}
              >
                {winner.name}
              </p>
              <p className="text-sm tabular-nums text-zinc-500">{winner.stat}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">{award.empty}</p>
      )}
    </article>
  );
}

function AwardsFallback() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="h-36 animate-pulse rounded-2xl bg-zinc-100 sm:col-span-2 dark:bg-zinc-900" />
      <div className="h-36 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-36 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}
