"use client";

import { useId, useState } from "react";
import {
  classifyPlayerName,
  cleanDisplayName,
  normalizeName,
  searchPlayers,
  type PlayerCandidate,
} from "@/lib/player-match";

interface SubmitterComboboxProps {
  players: PlayerCandidate[];
  query: string;
  selectedId: string | null;
  addToLeague: boolean;
  rookie: boolean;
  onQueryChange: (value: string) => void;
  onSelect: (player: PlayerCandidate) => void;
  onAddToLeagueChange: (checked: boolean) => void;
  onRookieChange: (checked: boolean) => void;
}

const textFieldClass =
  "h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200";

function linkedPlayer(
  query: string,
  selectedId: string | null,
  players: PlayerCandidate[],
): PlayerCandidate | null {
  const normalized = normalizeName(query);

  if (!normalized) {
    return null;
  }

  const selected = selectedId
    ? players.find((player) => player.id === selectedId)
    : undefined;

  if (selected && normalizeName(selected.name) === normalized) {
    return selected;
  }

  return players.find((player) => normalizeName(player.name) === normalized) ?? null;
}

function stillTyping(query: string, name: string): boolean {
  const normalized = normalizeName(query);
  const candidate = normalizeName(name);

  if (!normalized || !candidate || candidate === normalized) {
    return false;
  }

  const queryTokens = normalized.split(" ");
  const nameTokens = candidate.split(" ");

  if (candidate.startsWith(normalized)) {
    const aligned = nameTokens[queryTokens.length - 1] ?? "";

    return aligned !== queryTokens[queryTokens.length - 1];
  }

  return nameTokens.some(
    (token) => token.startsWith(normalized) && token !== normalized,
  );
}

function fuzzyHints(query: string, players: PlayerCandidate[]): PlayerCandidate[] {
  if (!normalizeName(query) || linkedPlayer(query, null, players)) {
    return [];
  }

  const classified = classifyPlayerName(query, players);
  const hints =
    classified.confidence === "high" && classified.player
      ? [classified.player]
      : classified.suggestions;

  return hints.filter((player) => !stillTyping(query, player.name));
}

export function SubmitterCombobox({
  players,
  query,
  selectedId,
  addToLeague,
  rookie,
  onQueryChange,
  onSelect,
  onAddToLeagueChange,
  onRookieChange,
}: SubmitterComboboxProps) {
  const inputId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const linked = linkedPlayer(query, selectedId, players);
  const hints = linked ? [] : fuzzyHints(query, players);
  const filtered = normalizeName(query) ? searchPlayers(query, players) : players;
  const customName =
    Boolean(normalizeName(query)) && !linked && hints.length === 0 && filtered.length === 0;
  const showList = open && !linked && filtered.length > 0;
  const activeIndex = filtered.length === 0 ? 0 : highlight % filtered.length;

  function choose(player: PlayerCandidate) {
    onSelect(player);
    setOpen(false);
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <label htmlFor={inputId} className="sr-only">
        Submitted by
      </label>
      <input
        id={inputId}
        value={query}
        placeholder="Search players or type a new name"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-activedescendant={showList ? `${listId}-${activeIndex}` : undefined}
        className={textFieldClass}
        onChange={(event) => {
          onQueryChange(event.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();

            if (!showList) {
              setOpen(true);
              setHighlight(0);
              return;
            }

            setHighlight((current) =>
              filtered.length === 0 ? 0 : (current + 1) % filtered.length,
            );
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();

            if (!showList) {
              setOpen(true);
              setHighlight(0);
              return;
            }

            setHighlight((current) =>
              filtered.length === 0 ? 0 : (current - 1 + filtered.length) % filtered.length,
            );
            return;
          }

          if (event.key === "Escape") {
            setOpen(false);
            return;
          }

          if (event.key === "Enter" && showList) {
            event.preventDefault();
            const player = filtered[activeIndex];

            if (player) {
              choose(player);
            }
          }
        }}
      />
      <input type="hidden" name="submitterId" value={linked?.id ?? (normalizeName(query) ? "guest" : "")} />
      {!linked && normalizeName(query) ? (
        <input type="hidden" name="submitterName" value={cleanDisplayName(query)} />
      ) : null}
      {linked ? (
        <p className="text-xs text-zinc-500">Linked to {linked.name}.</p>
      ) : null}
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="League players"
          className="max-h-60 overflow-auto rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        >
          {filtered.map((player, index) => (
            <li key={player.id} role="presentation">
              <button
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`block w-full px-3 py-2 text-left text-sm ${
                  index === activeIndex
                    ? "bg-zinc-100 text-zinc-950 dark:bg-zinc-900 dark:text-zinc-50"
                    : "text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-900"
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(player)}
              >
                {player.name}
                {player.isRookie ? " (rookie)" : ""}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {hints.map((player) => (
        <button
          key={player.id}
          type="button"
          className="inline-flex w-fit max-w-full items-center rounded-full bg-amber-100 px-3 py-1.5 text-left text-sm font-medium text-amber-950 transition-colors hover:bg-amber-200 dark:bg-amber-400/15 dark:text-amber-100 dark:hover:bg-amber-400/25"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(player)}
        >
          Did you mean {player.name}?
        </button>
      ))}
      {customName ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-zinc-500">This name is not in the league yet.</p>
          <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
            <input
              type="checkbox"
              name="addSubmitter"
              checked={addToLeague}
              onChange={(event) => {
                const checked = event.target.checked;
                onAddToLeagueChange(checked);

                if (!checked) {
                  onRookieChange(false);
                }
              }}
              className="size-4 accent-zinc-950 dark:accent-zinc-50"
            />
            Add player to league
          </label>
          <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
            <input
              type="checkbox"
              name="submitterRookie"
              checked={rookie}
              disabled={!addToLeague}
              onChange={(event) => onRookieChange(event.target.checked)}
              className="size-4 accent-zinc-950 disabled:opacity-40 dark:accent-zinc-50"
            />
            Flag player as rookie
          </label>
          <p className="text-xs text-zinc-500">The rookie flag is saved when this player is added.</p>
        </div>
      ) : null}
    </div>
  );
}
