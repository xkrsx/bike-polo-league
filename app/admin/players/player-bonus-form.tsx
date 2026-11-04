"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import {
  deletePlayer,
  mergePlayer,
  updatePlayer,
  type DeletePlayerState,
  type MergePlayerState,
  type PlayerActionState,
} from "@/app/actions/admin";
import {
  COSTUME_BONUS_POINTS,
  PODIUM_OPTIONS,
  isPodiumPoints,
  playerBonusFormValues,
  playerDeleteBlockReason,
  sumExtraPoints,
} from "@/lib/player-bonuses";

export interface AdminPlayer {
  id: string;
  name: string;
  isRookie: boolean;
  extraPoints: number;
  podiumPoints: number;
  costumeBonus: boolean;
  customBonusLabel: string;
  customBonusValue: number;
  gamesPlayed: number;
  gamesRefereed: number;
}

const initialSaveState: PlayerActionState = { error: null, saved: false };
const initialDeleteState: DeletePlayerState = { error: null };
const initialMergeState: MergePlayerState = { error: null, merged: false };

interface PlayerOption {
  id: string;
  name: string;
}

const fieldClass =
  "h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition-colors focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200";

function keepPoints(current: string, next: string): string {
  if (next === "" || next === "-" || /^-?\d{1,3}$/.test(next)) {
    return next;
  }

  return current;
}

function previewPoints(value: string): number {
  if (!/^-?\d{1,3}$/.test(value)) {
    return 0;
  }

  return Number(value);
}

function ConfirmDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-confirm-title"
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 text-zinc-950 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="player-confirm-title" className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

const secondaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900";

function PlayerDeleteControl({ player }: { player: AdminPlayer }) {
  const [open, setOpen] = useState(false);
  const blocked = playerDeleteBlockReason(
    player.name,
    player.gamesPlayed,
    player.gamesRefereed,
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center justify-center rounded-full border border-rose-300 px-4 text-sm font-medium text-rose-800 transition-colors hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950"
      >
        Delete Player
      </button>
      {open ? (
        <DeletePlayerDialog
          player={player}
          blocked={blocked}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function DeletePlayerDialog({
  player,
  blocked,
  onClose,
}: {
  player: AdminPlayer;
  blocked: string | null;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(deletePlayer, initialDeleteState);

  return (
    <ConfirmDialog title={`Delete ${player.name}`} onClose={onClose}>
      <form action={formAction} className="mt-4 flex flex-col gap-4">
        <input type="hidden" name="id" value={player.id} />
        {blocked ? (
          <p className="text-sm leading-6 text-amber-800 dark:text-amber-300">{blocked}</p>
        ) : (
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Delete {player.name}? This cannot be undone.
          </p>
        )}
        {state.error ? (
          <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">
            {state.error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          {blocked ? null : (
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-10 items-center justify-center rounded-full bg-rose-700 px-4 text-sm font-medium text-white transition-colors hover:bg-rose-800 disabled:opacity-60"
            >
              {pending ? "Deleting…" : "Confirm delete"}
            </button>
          )}
        </div>
      </form>
    </ConfirmDialog>
  );
}

function MergePlayerControl({
  player,
  others,
}: {
  player: AdminPlayer;
  others: PlayerOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={secondaryButtonClass}>
        Merge Player
      </button>
      {open ? (
        <MergePlayerDialog
          player={player}
          others={others}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function MergePlayerDialog({
  player,
  others,
  onClose,
}: {
  player: AdminPlayer;
  others: PlayerOption[];
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(mergePlayer, initialMergeState);
  const [targetId, setTargetId] = useState("");
  const target = others.find((option) => option.id === targetId);

  useEffect(() => {
    if (state.merged) {
      onClose();
    }
  }, [onClose, state.merged]);

  return (
    <ConfirmDialog title={`Merge ${player.name} into…`} onClose={onClose}>
      <form action={formAction} className="mt-4 flex flex-col gap-4">
        <input type="hidden" name="sourceId" value={player.id} />
        <label className="flex flex-col gap-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
          Target player
          <select
            name="targetId"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            required
            className={fieldClass}
          >
            <option value="">Choose a player</option>
            {others.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        {target ? (
          <p className="text-sm leading-6 text-amber-800 dark:text-amber-300">
            This will reassign all games from {player.name} to {target.name} and
            permanently delete {player.name}.
          </p>
        ) : (
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {others.length === 0
              ? "Add another player before merging."
              : "Choose who should keep the games."}
          </p>
        )}
        {state.error ? (
          <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">
            {state.error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !target}
            className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {pending ? "Merging…" : "Confirm Merge"}
          </button>
        </div>
      </form>
    </ConfirmDialog>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`size-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M5 7.5 10 12.5 15 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayerAdminRow({
  player,
  others,
}: {
  player: AdminPlayer;
  others: PlayerOption[];
}) {
  const bonuses = playerBonusFormValues(player);
  const [state, formAction, pending] = useActionState(updatePlayer, initialSaveState);
  const [name, setName] = useState(player.name);
  const [isRookie, setIsRookie] = useState(player.isRookie);
  const [costumeBonus, setCostumeBonus] = useState(bonuses.costumeBonus);
  const [customBonusEnabled, setCustomBonusEnabled] = useState(
    bonuses.customBonusEnabled,
  );
  const [customBonusLabel, setCustomBonusLabel] = useState(bonuses.customBonusLabel);
  const [customBonusValue, setCustomBonusValue] = useState(
    String(bonuses.customBonusValue),
  );
  const [podiumPoints, setPodiumPoints] = useState(
    isPodiumPoints(player.podiumPoints) ? String(player.podiumPoints) : "0",
  );
  const extraPoints = sumExtraPoints(
    costumeBonus,
    customBonusEnabled ? previewPoints(customBonusValue) : 0,
  );
  const podium = previewPoints(podiumPoints);
  const [open, setOpen] = useState(false);
  const panelId = `player-panel-${player.id}`;

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-base font-medium text-zinc-950 dark:text-zinc-50">
            {player.name}
          </span>
          {player.isRookie ? (
            <span className="inline-flex shrink-0 items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium tracking-wide text-zinc-700 uppercase dark:bg-zinc-800 dark:text-zinc-200">
              Rookie
            </span>
          ) : null}
        </span>
        <Chevron open={open} />
      </button>
      {open ? (
        <div id={panelId} className="flex flex-col gap-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={player.id} />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
            Name
            <input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              maxLength={80}
              required
              className={fieldClass}
            />
          </label>
          <label className="inline-flex h-10 items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
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
        <fieldset className="grid gap-3">
          <legend className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
            Bonuses
          </legend>
          <label className="inline-flex w-fit items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              name="costumeBonus"
              checked={costumeBonus}
              onChange={(event) => setCostumeBonus(event.target.checked)}
              className="size-4 accent-zinc-950 dark:accent-zinc-50"
            />
            Costume (+{COSTUME_BONUS_POINTS})
          </label>
          <label className="inline-flex w-fit items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              name="customBonus"
              checked={customBonusEnabled}
              onChange={(event) => setCustomBonusEnabled(event.target.checked)}
              className="size-4 accent-zinc-950 dark:accent-zinc-50"
            />
            Custom bonus
          </label>
          {customBonusEnabled ? (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <label className="flex flex-col gap-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                Label
                <input
                  name="customBonusLabel"
                  value={customBonusLabel}
                  onChange={(event) => setCustomBonusLabel(event.target.value)}
                  placeholder="Tournament Organizer"
                  maxLength={80}
                  required
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                Value
                <input
                  name="customBonusValue"
                  inputMode="numeric"
                  value={customBonusValue}
                  onChange={(event) =>
                    setCustomBonusValue(
                      keepPoints(customBonusValue, event.target.value),
                    )
                  }
                  required
                  className={`${fieldClass} tabular-nums`}
                />
              </label>
            </div>
          ) : null}
          <label className="flex max-w-xs flex-col gap-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
            Podium
            <select
              name="podiumPoints"
              value={podiumPoints}
              onChange={(event) => setPodiumPoints(event.target.value)}
              className={fieldClass}
            >
              {PODIUM_OPTIONS.map((option) => (
                <option key={option.points} value={option.points}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {!isPodiumPoints(player.podiumPoints) ? (
            <p className="text-xs leading-5 text-amber-700 dark:text-amber-400">
              Saved podium points are {player.podiumPoints}, outside the standard
              places. Saving applies the place selected above.
            </p>
          ) : null}
          <p className="text-xs leading-5 text-zinc-500">
            Adds {extraPoints + podium} bonus points ({extraPoints} extra + {podium}{" "}
            podium).
          </p>
        </fieldset>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <p
            role={state.error ? "alert" : undefined}
            className={`text-xs sm:mr-auto ${
              state.error
                ? "text-rose-700 dark:text-rose-400"
                : "text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {state.error ?? (state.saved ? "Saved" : "")}
          </p>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
      <div className="flex flex-wrap gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <MergePlayerControl player={player} others={others} />
        <PlayerDeleteControl player={player} />
      </div>
        </div>
      ) : null}
    </article>
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
        <PlayerAdminRow
          key={player.id}
          player={player}
          others={players
            .filter((option) => option.id !== player.id)
            .map((option) => ({ id: option.id, name: option.name }))}
        />
      ))}
    </div>
  );
}
