"use client";

import { useActionState } from "react";
import {
  resetGames,
  resetLeague,
  resetPlayoffs,
  type LeagueActionState,
} from "@/app/actions/league";

const initialState: LeagueActionState = { error: null, message: null };

interface ResetCardProps {
  title: string;
  description: string;
  phrase: string;
  action: (
    previous: LeagueActionState,
    formData: FormData,
  ) => Promise<LeagueActionState>;
  buttonLabel: string;
  tone: "neutral" | "warn" | "danger";
}

const toneClass = {
  neutral:
    "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950",
  warn: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
  danger: "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30",
} as const;

const buttonClass = {
  neutral:
    "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200",
  warn: "bg-amber-700 text-white hover:bg-amber-800",
  danger: "bg-rose-700 text-white hover:bg-rose-800",
} as const;

function ResetCard({
  title,
  description,
  phrase,
  action,
  buttonLabel,
  tone,
}: ResetCardProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form
      action={formAction}
      className={`flex flex-col gap-4 rounded-2xl border p-5 shadow-sm ${toneClass[tone]}`}
    >
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {title}
        </h2>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">{description}</p>
      </div>
      <label className="flex flex-col gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Type {phrase} to confirm
        <input
          name="confirm"
          autoComplete="off"
          spellCheck={false}
          placeholder={phrase}
          className="h-10 rounded-lg border border-zinc-300 bg-white px-3 font-mono text-sm text-zinc-950 outline-none focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200"
        />
      </label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p
          role={state.error ? "alert" : undefined}
          className={
            state.error
              ? "text-sm text-rose-700 dark:text-rose-400"
              : "text-sm text-zinc-600 dark:text-zinc-400"
          }
        >
          {state.error ?? state.message ?? "This cannot be undone from the page."}
        </p>
        <button
          type="submit"
          disabled={pending}
          className={`inline-flex h-11 shrink-0 items-center justify-center rounded-full px-5 text-sm font-medium transition-colors disabled:opacity-60 ${buttonClass[tone]}`}
        >
          {pending ? "Resetting…" : buttonLabel}
        </button>
      </div>
    </form>
  );
}

export function LeagueResetPanel({
  playerCount,
  gameCount,
  finalsCount,
}: {
  playerCount: number;
  gameCount: number;
  finalsCount: number;
}) {
  const players = playerCount === 1 ? "1 player" : `${playerCount} players`;
  const games = gameCount === 1 ? "1 game" : `${gameCount} games`;
  const bracket = finalsCount === 0 ? "No playoff bracket is saved." : "The playoff bracket is saved.";

  return (
    <div className="flex flex-col gap-4">
      <ResetCard
        title="Reset playoffs to regular league"
        description={`${bracket} This removes the finals bracket and sets podium points back to 0. ${players} and ${games} stay.`}
        phrase="RESET PLAYOFFS"
        action={resetPlayoffs}
        buttonLabel="Reset playoffs"
        tone="neutral"
      />
      <ResetCard
        title="Reset games only"
        description={`Deletes all ${games}, pending and approved. ${players} stay on the roster, including rookies and bonuses.`}
        phrase="RESET GAMES"
        action={resetGames}
        buttonLabel="Reset games"
        tone="warn"
      />
      <ResetCard
        title="Reset entire league"
        description={`Clears ${games} and ${players}, and removes the finals. The league starts empty.`}
        phrase="RESET LEAGUE"
        action={resetLeague}
        buttonLabel="Reset entire league"
        tone="danger"
      />
    </div>
  );
}
