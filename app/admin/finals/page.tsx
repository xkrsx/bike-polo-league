import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { SNAKE_DRAFT_RANKS } from "@/lib/finals";
import { getFinalsAdminView } from "@/lib/finals-data";
import { GenerateFinals, PlayoffBracket } from "./finals-panel";
import { FinalsTeams } from "./roster";

export const metadata: Metadata = {
  title: "Finals",
  description: "Generate the snake-draft finals and enter playoff scores",
};

const outlineLink =
  "inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900";

const draftSummary = SNAKE_DRAFT_RANKS.map(
  (ranks, index) => `Team ${index + 1} (${ranks.join(", ")})`,
).join(", ");

export default function FinalsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium tracking-wide text-zinc-500">
            BPV winter league 2026/2027
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Finals
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            The top 12 form four teams in a snake draft: {draftSummary}. Rosters
            stay locked for the semi-finals, the 3rd place match, and the Grand
            Final. Goals count on the leaderboard. Finishing both final games
            sets podium points to 15, 10, and 5.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href="/leaderboard" className={outlineLink}>
            Leaderboard
          </Link>
          <Link href="/awards" className={outlineLink}>
            Awards
          </Link>
        </div>
      </header>
      <Suspense fallback={<FinalsFallback />}>
        <FinalsLoader />
      </Suspense>
    </main>
  );
}

async function FinalsLoader() {
  await connection();
  const view = await getFinalsAdminView();
  const rosterKey = view.teams
    .map((team) => team.players.map((player) => player.id).join("-"))
    .join("|");

  return (
    <div className="flex flex-col gap-8">
      {view.complete ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          Finals are complete. Podium points are on the leaderboard.{" "}
          <Link href="/awards" className="font-medium underline">
            View the awards
          </Link>
          .
        </div>
      ) : null}
      {view.generated && !view.complete ? (
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Podium points for these 12 follow the bracket. They stay at 0 until
          the 3rd place match and the Grand Final both have winners, then the
          leaderboard refreshes.
        </p>
      ) : null}
      <FinalsTeams teams={view.teams} generated={view.generated} />
      <GenerateFinals
        key={rosterKey || "preview"}
        playerCount={view.playerCount}
        generated={view.generated}
        resultsLocked={view.resultsLocked}
      />
      {view.generated ? <PlayoffBracket matches={view.matches} /> : null}
    </div>
  );
}

function FinalsFallback() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-28 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-40 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}
