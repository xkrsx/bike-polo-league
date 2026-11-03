"use client";

import { useMemo, useState } from "react";
import type { PlayerStanding } from "@/lib/scoring";

type SortKey =
  | "rank"
  | "name"
  | "gamesPlayed"
  | "wins"
  | "draws"
  | "losses"
  | "bonusPoints"
  | "points"
  | "goals"
  | "goalsConceded"
  | "ownGoals"
  | "cleanSheets"
  | "fouls";

type SortDirection = "asc" | "desc";

interface RankedStanding extends PlayerStanding {
  rank: number;
}

interface LeaderboardColumn {
  key: SortKey;
  label: string;
  align: "left" | "right";
}

const columns: LeaderboardColumn[] = [
  { key: "rank", label: "#", align: "left" },
  { key: "name", label: "Player", align: "left" },
  { key: "points", label: "Total Points", align: "right" },
  { key: "gamesPlayed", label: "Played", align: "right" },
  { key: "wins", label: "Wins", align: "right" },
  { key: "draws", label: "Draws", align: "right" },
  { key: "losses", label: "Losses", align: "right" },
  { key: "bonusPoints", label: "Bonus", align: "right" },
  { key: "goals", label: "Goals+", align: "right" },
  { key: "goalsConceded", label: "Goals-", align: "right" },
  { key: "ownGoals", label: "Own Goals", align: "right" },
  { key: "cleanSheets", label: "Clean Sheets", align: "right" },
  { key: "fouls", label: "Fouls", align: "right" },
];

function initialDirection(key: SortKey): SortDirection {
  if (key === "name" || key === "rank") {
    return "asc";
  }

  return "desc";
}

function compareValue(
  left: RankedStanding,
  right: RankedStanding,
  key: SortKey,
): number {
  if (key === "name") {
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  }

  return left[key] - right[key];
}

export function LeaderboardTable({ standings }: { standings: PlayerStanding[] }) {
  const ranked = useMemo(
    () => standings.map((player, index) => ({ ...player, rank: index + 1 })),
    [standings],
  );
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "points",
    direction: "desc",
  });

  const rows = useMemo(() => {
    return [...ranked].sort((left, right) => {
      const difference = compareValue(left, right, sort.key);

      if (difference !== 0) {
        return sort.direction === "asc" ? difference : -difference;
      }

      return left.rank - right.rank;
    });
  }, [ranked, sort]);

  function sortBy(key: SortKey) {
    setSort((current) => {
      if (current.key === key) {
        return {
          key,
          direction: current.direction === "desc" ? "asc" : "desc",
        };
      }

      return { key, direction: initialDirection(key) };
    });
  }

  if (standings.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center text-zinc-500 dark:border-zinc-700">
        No players yet. Seed the league to see standings.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full min-w-[1120px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs tracking-wide text-zinc-500 uppercase dark:border-zinc-800">
            {columns.map((column) => {
              const active = sort.key === column.key;
              const align =
                column.align === "right" ? "text-right" : "text-left";

              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    active
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className={`px-3 py-3 font-medium whitespace-nowrap ${align}`}
                >
                  <button
                    type="button"
                    onClick={() => sortBy(column.key)}
                    className={`inline-flex items-center gap-1 rounded-sm transition-colors hover:text-zinc-950 dark:hover:text-zinc-200 ${
                      column.align === "right" ? "ml-auto" : ""
                    } ${active ? "text-zinc-950 dark:text-zinc-50" : ""}`}
                  >
                    {column.label}
                    {active ? (
                      <span aria-hidden="true" className="text-[10px] leading-none">
                        {sort.direction === "asc" ? "▲" : "▼"}
                      </span>
                    ) : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((player) => (
            <tr
              key={player.id}
              className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-900"
            >
              {columns.map((column) => {
                if (column.key === "name") {
                  return (
                    <td
                      key={column.key}
                      className="px-3 py-3.5 font-medium whitespace-nowrap text-zinc-950 dark:text-zinc-50"
                    >
                      <span>{player.name}</span>
                      {player.isRookie ? (
                        <span className="ml-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold tracking-wide text-amber-800 uppercase dark:bg-amber-400/15 dark:text-amber-300">
                          Rookie
                        </span>
                      ) : null}
                    </td>
                  );
                }

                const tone =
                  column.key === "points"
                    ? "font-semibold text-zinc-950 dark:text-zinc-50"
                    : column.key === "rank"
                      ? "text-zinc-500"
                      : "text-zinc-700 dark:text-zinc-300";

                return (
                  <td
                    key={column.key}
                    className={`px-3 py-3.5 tabular-nums ${
                      column.align === "right" ? "text-right" : ""
                    } ${tone}`}
                  >
                    {player[column.key]}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
