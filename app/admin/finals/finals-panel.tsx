"use client";

import { useActionState, useId, useState } from "react";
import {
  generateFinals,
  savePlayoffMatch,
  type FinalsActionState,
} from "@/app/actions/finals";
import { MAX_STAT } from "@/lib/match-sheet";
import {
  FINALS_FIELD_SIZE,
  FINALS_TEAM_DOT,
  type FinalsSideView,
  type OpenPlayoffMatchView,
  type PlayoffMatchView,
} from "@/lib/finals";

const initialState: FinalsActionState = { error: null };

const primaryButton =
  "inline-flex h-10 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";

const secondaryButton =
  "inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900";

const goalInput =
  "h-10 w-16 rounded-lg border border-zinc-300 bg-white px-2 text-center text-sm tabular-nums text-zinc-950 outline-none focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200";

function playerCountLabel(count: number): string {
  return count === 1 ? "1 player" : `${count} players`;
}

function keepStat(current: string, next: string): string {
  if (next === "" || (/^\d{1,2}$/.test(next) && Number(next) <= MAX_STAT)) {
    return next;
  }

  return current;
}

function statValue(value: string): number {
  if (!/^\d{1,2}$/.test(value)) {
    return 0;
  }

  return Number(value);
}

function sideTotal(side: FinalsSideView, goals: Record<string, string>): number {
  return side.players.reduce(
    (total, player) => total + statValue(goals[player.id] ?? ""),
    0,
  );
}

function ErrorText({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

export function GenerateFinals({
  playerCount,
  generated,
  resultsLocked,
}: {
  playerCount: number;
  generated: boolean;
  resultsLocked: boolean;
}) {
  const [state, action, pending] = useActionState(generateFinals, initialState);
  const [confirming, setConfirming] = useState(false);
  const short = playerCount < FINALS_FIELD_SIZE;

  if (generated && resultsLocked) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        A playoff score is saved, so these rosters stay fixed for every remaining game.
      </p>
    );
  }

  if (generated) {
    if (confirming) {
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Replace these teams with the current top {FINALS_FIELD_SIZE}?
          </p>
          <form action={action} className="flex flex-wrap gap-2">
            <button type="submit" className={primaryButton} disabled={pending}>
              {pending ? "Generating…" : "Regenerate"}
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </form>
          <ErrorText message={state.error} />
        </div>
      );
    }

    return (
      <button
        type="button"
        className={secondaryButton}
        onClick={() => setConfirming(true)}
      >
        Generate again
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col items-start gap-3">
      {short ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Finals need the top {FINALS_FIELD_SIZE} players. The leaderboard has{" "}
          {playerCountLabel(playerCount)}.
        </p>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Lock the preview above. The same twelve players stay on these teams
          for the whole bracket.
        </p>
      )}
      <button type="submit" className={primaryButton} disabled={short || pending}>
        {pending ? "Generating…" : "Generate Finals"}
      </button>
      <ErrorText message={state.error} />
    </form>
  );
}

function TeamFields({
  side,
  formId,
  goals,
  onGoal,
}: {
  side: FinalsSideView;
  formId: string;
  goals: Record<string, string>;
  onGoal: (playerId: string, value: string) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
        <span
          aria-hidden="true"
          className={`size-2.5 rounded-full ${FINALS_TEAM_DOT[side.number] ?? "bg-zinc-400"}`}
        />
        Team {side.number}
        {side.result ? (
          <span className="font-medium text-zinc-500">{side.result}</span>
        ) : null}
      </legend>
      <ul className="mt-3 flex flex-col gap-2">
        {side.players.map((player) => {
          const inputId = `${formId}-${player.id}`;

          return (
            <li key={player.id} className="flex items-center justify-between gap-3">
              <label htmlFor={inputId} className="min-w-0 text-sm text-zinc-950 dark:text-zinc-50">
                <span className="font-medium break-words">{player.name}</span>
                <span className="ml-2 text-zinc-500">#{player.rank}</span>
              </label>
              <input
                id={inputId}
                name={`goal:${player.id}`}
                inputMode="numeric"
                autoComplete="off"
                aria-label={`Goals for ${player.name}`}
                className={goalInput}
                value={goals[player.id] ?? ""}
                onChange={(event) =>
                  onGoal(player.id, keepStat(goals[player.id] ?? "", event.target.value))
                }
              />
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function OpenMatchForm({ match }: { match: OpenPlayoffMatchView }) {
  const formId = useId();
  const [state, action, pending] = useActionState(savePlayoffMatch, initialState);
  const [goals, setGoals] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};

    for (const player of [...match.home.players, ...match.away.players]) {
      initial[player.id] = match.saved || player.goals > 0 ? String(player.goals) : "";
    }

    return initial;
  });
  const homeTotal = sideTotal(match.home, goals);
  const awayTotal = sideTotal(match.away, goals);
  const started = Object.values(goals).some((value) => value !== "");
  const level = homeTotal === awayTotal;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">
          Step {match.step} · {match.title}
        </h3>
        {match.saved ? <span className="text-sm text-zinc-500">Saved</span> : null}
      </div>
      <p
        aria-live="polite"
        className="mt-3 text-center text-3xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50"
      >
        <span className="sr-only">
          Team {match.home.number} {homeTotal}, Team {match.away.number} {awayTotal}.
        </span>
        <span aria-hidden="true">
          {homeTotal}
          <span className="px-2 text-zinc-400">:</span>
          {awayTotal}
        </span>
      </p>
      <form action={action} className="mt-4 flex flex-col gap-4">
        <input type="hidden" name="round" value={match.round} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TeamFields
            side={match.home}
            formId={formId}
            goals={goals}
            onGoal={(playerId, value) =>
              setGoals((current) => ({ ...current, [playerId]: value }))
            }
          />
          <TeamFields
            side={match.away}
            formId={formId}
            goals={goals}
            onGoal={(playerId, value) =>
              setGoals((current) => ({ ...current, [playerId]: value }))
            }
          />
        </div>
        <p className="text-sm text-zinc-500">The higher total wins.</p>
        {started && level ? (
          <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
            Playoff games need a winner.
          </p>
        ) : null}
        <ErrorText message={state.error} />
        <button type="submit" className={`${primaryButton} self-start`} disabled={pending || level}>
          {pending ? "Saving…" : match.saved ? "Update result" : "Save result"}
        </button>
      </form>
    </section>
  );
}

function MatchCard({ match }: { match: PlayoffMatchView }) {
  if (!match.open) {
    return (
      <section className="rounded-2xl border border-dashed border-zinc-300 px-4 py-5 dark:border-zinc-700">
        <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">
          Step {match.step} · {match.title}
        </h3>
        <p className="mt-2 text-sm text-zinc-500">{match.waiting}</p>
      </section>
    );
  }

  return <OpenMatchForm match={match} />;
}

export function PlayoffBracket({ matches }: { matches: PlayoffMatchView[] }) {
  const semis = matches.filter((match) => match.step < 3);
  const finals = matches.filter((match) => match.step >= 3);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Bracket</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Semi-finals first: Team 1 vs Team 4, then Team 2 vs Team 3. Goals
          entered here count toward each player&apos;s goals on the leaderboard.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {semis.map((match) => (
            <MatchCard key={match.open ? match.inputKey : match.round} match={match} />
          ))}
        </div>
        <div className="flex flex-col gap-4">
          {finals.map((match) => (
            <MatchCard key={match.open ? match.inputKey : match.round} match={match} />
          ))}
        </div>
      </div>
    </section>
  );
}
