"use client";

import { useActionState, useState } from "react";
import { updatePlayer, type PlayerActionState } from "@/app/actions/player";

export interface AdminPlayer {
  id: string;
  name: string;
  isRookie: boolean;
  extraPoints: number;
  podiumPoints: number;
}

const initialState: PlayerActionState = { error: null, saved: false };

const fieldClass =
  "h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none tabular-nums transition-colors focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200";

function keepPoints(current: string, next: string): string {
  if (next === "" || next === "-" || /^-?\d{1,4}$/.test(next)) {
    return next;
  }

  return current;
}

function PlayerBonusRow({ player }: { player: AdminPlayer }) {
  const [state, formAction, pending] = useActionState(updatePlayer, initialState);
  const [extraPoints, setExtraPoints] = useState(String(player.extraPoints));
  const [podiumPoints, setPodiumPoints] = useState(String(player.podiumPoints));
  const [isRookie, setIsRookie] = useState(player.isRookie);

  return (
    <form
      action={formAction}
      className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-[minmax(0,1.2fr)_8rem_8rem_auto] sm:items-end dark:border-zinc-800 dark:bg-zinc-950"
    >
      <input type="hidden" name="id" value={player.id} />
      <div className="flex min-w-0 flex-col gap-3">
        <h2 className="truncate text-base font-medium text-zinc-950 dark:text-zinc-50">
          {player.name}
        </h2>
        <label className="inline-flex w-fit items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            name="isRookie"
            checked={isRookie}
            onChange={(event) => setIsRookie(event.target.checked)}
            className="size-4 accent-zinc-950 dark:accent-zinc-50"
          />
          Rookie
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
        Extra points
        <input
          name="extraPoints"
          inputMode="numeric"
          value={extraPoints}
          onChange={(event) =>
            setExtraPoints(keepPoints(extraPoints, event.target.value))
          }
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
        Podium points
        <input
          name="podiumPoints"
          inputMode="numeric"
          value={podiumPoints}
          onChange={(event) =>
            setPodiumPoints(keepPoints(podiumPoints, event.target.value))
          }
          className={fieldClass}
        />
      </label>
      <div className="flex flex-col gap-2 sm:items-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <p
          role={state.error ? "alert" : undefined}
          className={`text-xs ${
            state.error
              ? "text-rose-700 dark:text-rose-400"
              : "text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {state.error ?? (state.saved ? "Saved" : "")}
        </p>
      </div>
    </form>
  );
}

export function PlayerBonusList({ players }: { players: AdminPlayer[] }) {
  if (players.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center text-zinc-500 dark:border-zinc-700">
        No players yet. Enter a game to add the first names.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {players.map((player) => (
        <PlayerBonusRow key={player.id} player={player} />
      ))}
    </div>
  );
}
