"use client";

import { useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  checkDuplicateMatch,
  submitGames,
  type DuplicateCheckLine,
  type DuplicateMatchView,
  type GameActionState,
} from "@/app/actions/game";
import { LineupColumns, type LineupPlayer } from "@/app/games/lineup-columns";
import { tallyMatchScore, type MatchLine } from "@/lib/match-sheet";
import { classifyPlayerName, cleanDisplayName, normalizeName, type PlayerCandidate } from "@/lib/player-match";
import { penaltySummary, readableSheetName } from "@/lib/ref-sheet-ocr";
import type { SheetRegion } from "@/lib/ref-sheet-layout";
import type { MatchedRefGame, SheetNameMatch } from "@/lib/ref-sheet-match";
import { teamA as teamATone, teamB as teamBTone } from "@/lib/team-colors";
import { SubmitterCombobox } from "./submitter-combobox";

interface GameWizardProps {
  players: PlayerCandidate[];
  defaultDate: string;
}

interface Suggestion {
  id: string;
  name: string;
}

interface DraftPerson {
  playerId: string;
  name: string;
  rawName: string;
  matchedAs: string | null;
  suggestions: Suggestion[];
  preselectedId: string | null;
  rookie: boolean;
}

interface DraftLine extends DraftPerson {
  key: string;
  goals: string;
  ownGoals: string;
  fouls: string;
  penaltyHint: string;
}

interface DraftMatch {
  key: string;
  region: SheetRegion | "full";
  notes: string[];
  scoreTeamA: number | null;
  scoreTeamB: number | null;
  referee: DraftPerson;
  assistant: DraftPerson;
  teamA: DraftLine[];
  teamB: DraftLine[];
}

const initialState: GameActionState = { error: null };

const textFieldClass =
  "h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200";

function canPreviewPhoto(file: File): boolean {
  const type = file.type.toLowerCase();

  return type.startsWith("image/") && !type.includes("heic") && !type.includes("heif");
}

const REGION_LABEL: Record<SheetRegion | "full", string> = {
  "top-left": "Top left card",
  "top-right": "Top right card",
  "bottom-left": "Bottom left card",
  "bottom-right": "Bottom right card",
  full: "Full sheet",
};

function emptyPerson(): DraftPerson {
  return {
    playerId: "new",
    name: "",
    rawName: "",
    matchedAs: null,
    suggestions: [],
    preselectedId: null,
    rookie: false,
  };
}

function sheetNameOf(match: SheetNameMatch): string | null {
  return readableSheetName(match.rawName || match.playerName || match.name || "");
}

function personFrom(match: SheetNameMatch | undefined, roster: PlayerCandidate[]): DraftPerson {
  if (!match) {
    return emptyPerson();
  }

  const rawName = sheetNameOf(match);

  if (!rawName) {
    return emptyPerson();
  }

  if (match.confidence === "low" && match.suggestions.length > 1) {
    return {
      playerId: "new",
      name: cleanDisplayName(rawName),
      rawName,
      matchedAs: null,
      suggestions: match.suggestions,
      preselectedId: null,
      rookie: false,
    };
  }

  const linked =
    match.confidence === "high" && match.playerId
      ? (roster.find((player) => player.id === match.playerId) ?? null)
      : null;
  const classified = classifyPlayerName(rawName, roster);
  const chosen = linked ?? (classified.confidence === "high" ? classified.player : null);

  if (chosen) {
    return {
      playerId: chosen.id,
      name: chosen.name,
      rawName,
      matchedAs: match.matchedAs,
      suggestions: [],
      preselectedId: chosen.id,
      rookie: false,
    };
  }

  const suggestionSource =
    classified.suggestions.length > 0
      ? classified.suggestions.map((player) => ({ id: player.id, name: player.name }))
      : match.suggestions;

  return {
    playerId: "new",
    name: cleanDisplayName(rawName),
    rawName,
    matchedAs: null,
    suggestions: suggestionSource,
    preselectedId: null,
    rookie: false,
  };
}

function lineFrom(
  match: MatchedRefGame["teamA"][number] | undefined,
  key: string,
  roster: PlayerCandidate[],
): DraftLine {
  const person = personFrom(match, roster);

  return {
    ...person,
    key,
    goals: match ? String(match.goals) : "",
    ownGoals: "",
    fouls: match ? String(match.fouls) : "",
    penaltyHint: match ? penaltySummary(match.penalties) : "",
  };
}

function blankLine(key: string): DraftLine {
  return {
    ...emptyPerson(),
    key,
    goals: "",
    ownGoals: "",
    fouls: "",
    penaltyHint: "",
  };
}

function blankMatch(note: string): DraftMatch {
  return {
    key: "manual",
    region: "full",
    notes: [note],
    scoreTeamA: null,
    scoreTeamB: null,
    referee: emptyPerson(),
    assistant: emptyPerson(),
    teamA: [0, 1, 2].map((index) => blankLine(`a-${index}`)),
    teamB: [0, 1, 2].map((index) => blankLine(`b-${index}`)),
  };
}

function draftsFromGames(games: MatchedRefGame[], roster: PlayerCandidate[]): DraftMatch[] {
  return games.map((game, index) => ({
    key: `${game.region}-${index}`,
    region: game.region,
    notes: game.notes.filter((note) => !/was left off/i.test(note)),
    scoreTeamA: game.scoreTeamA,
    scoreTeamB: game.scoreTeamB,
    referee: personFrom(game.referees[0], roster),
    assistant: personFrom(game.referees[1], roster),
    teamA: [0, 1, 2].map((slot) => lineFrom(game.teamA[slot], `a-${index}-${slot}`, roster)),
    teamB: [0, 1, 2].map((slot) => lineFrom(game.teamB[slot], `b-${index}-${slot}`, roster)),
  }));
}

function isMatchedGame(value: unknown): value is MatchedRefGame {
  if (!value || typeof value !== "object") {
    return false;
  }

  const game = value as MatchedRefGame;

  return (
    Array.isArray(game.referees) &&
    Array.isArray(game.teamA) &&
    Array.isArray(game.teamB) &&
    (game.region === "full" ||
      game.region === "top-left" ||
      game.region === "top-right" ||
      game.region === "bottom-left" ||
      game.region === "bottom-right")
  );
}

function statNumber(value: string): number {
  if (!/^\d{1,2}$/.test(value)) {
    return 0;
  }

  return Number(value);
}

function updateStat(current: string, next: string): string {
  if (next === "" || /^\d{0,2}$/.test(next)) {
    return next;
  }

  return current;
}

function choosePlayer(
  person: DraftPerson,
  playerId: string,
  players: PlayerCandidate[],
): DraftPerson {
  if (playerId === "new") {
    return {
      ...person,
      playerId,
      name: person.rawName || person.name,
    };
  }

  const player = players.find((candidate) => candidate.id === playerId);

  return {
    ...person,
    playerId,
    name: player?.name ?? person.name,
  };
}

function displayedName(person: DraftPerson, players: PlayerCandidate[]): string {
  if (person.playerId === "new") {
    return person.name;
  }

  return players.find((player) => player.id === person.playerId)?.name ?? person.name;
}

function lineIsRookie(line: DraftLine, players: PlayerCandidate[]): boolean {
  if (line.playerId === "new") {
    return line.rookie;
  }

  return players.find((player) => player.id === line.playerId)?.isRookie === true;
}

function toMatchLine(line: DraftLine, players: PlayerCandidate[]): MatchLine {
  return {
    name: displayedName(line, players),
    goals: statNumber(line.goals),
    ownGoals: statNumber(line.ownGoals),
    fouls: statNumber(line.fouls),
    isRookie: lineIsRookie(line, players),
  };
}

function namedPlayers(lines: DraftLine[], players: PlayerCandidate[]): LineupPlayer[] {
  return lines.flatMap((line) => {
    const name = displayedName(line, players).trim();

    if (!name) {
      return [];
    }

    return [
      {
        id: line.key,
        name,
        goals: statNumber(line.goals),
        ownGoals: statNumber(line.ownGoals),
        isRookie: lineIsRookie(line, players),
      },
    ];
  });
}

function personProblem(person: DraftPerson, label: string, required: boolean): string | null {
  if (person.playerId !== "new") {
    return null;
  }

  const name = person.name.trim();

  if (!name) {
    return required ? `Enter a name for every player on ${label}.` : null;
  }

  if (!normalizeName(name)) {
    return "Use a player name of letters or numbers.";
  }

  return null;
}

type RoleSlot = "official" | "A" | "B";

function personIdentity(person: DraftPerson, roster: PlayerCandidate[]): string | null {
  if (person.playerId !== "new") {
    return `id:${person.playerId}`;
  }

  const name = normalizeName(person.name);

  if (!name) {
    return null;
  }

  const exact = roster.find((player) => normalizeName(player.name) === name);

  return exact ? `id:${exact.id}` : `name:${name}`;
}

function roleConflict(
  match: DraftMatch,
  roster: PlayerCandidate[],
  scope: "team-a" | "full",
): string | null {
  const seen = new Map<string, { name: string; slot: RoleSlot }>();
  const groups: Array<{ person: DraftPerson; slot: RoleSlot; teamLabel: string }> = [
    { person: match.referee, slot: "official", teamLabel: "the referees" },
    { person: match.assistant, slot: "official", teamLabel: "the referees" },
    ...match.teamA.map((person) => ({
      person,
      slot: "A" as const,
      teamLabel: "team 1",
    })),
  ];

  if (scope === "full") {
    groups.push(
      ...match.teamB.map((person) => ({
        person,
        slot: "B" as const,
        teamLabel: "team 2",
      })),
    );
  }

  for (const group of groups) {
    const identity = personIdentity(group.person, roster);

    if (!identity) {
      continue;
    }

    const name = displayedName(group.person, roster).trim() || "This player";
    const previous = seen.get(identity);

    if (!previous) {
      seen.set(identity, { name, slot: group.slot });
      continue;
    }

    if (previous.slot === "official" && group.slot === "official") {
      return `${name} is listed twice as a referee.`;
    }

    if (previous.slot === "official" || group.slot === "official") {
      return `${name} is a referee and cannot also play.`;
    }

    if (previous.slot !== group.slot) {
      return `${name} is listed on both teams.`;
    }

    return `${name} is listed twice on ${group.teamLabel}.`;
  }

  return null;
}

function validateMatch(match: DraftMatch, roster: PlayerCandidate[]): string | null {
  const referee = personProblem(match.referee, "referees", false);
  const assistant = personProblem(match.assistant, "referees", false);

  if (referee || assistant) {
    return referee ?? assistant;
  }

  for (const line of match.teamA) {
    const problem = personProblem(line, "team 1", true);

    if (problem) {
      return problem;
    }
  }

  for (const line of match.teamB) {
    const problem = personProblem(line, "team 2", true);

    if (problem) {
      return problem;
    }
  }

  return roleConflict(match, roster, "full");
}

function PlayerFields({
  id,
  label,
  idName,
  nameName,
  rookieName,
  rookieValue,
  person,
  players,
  onChange,
}: {
  id: string;
  label: string;
  idName: string;
  nameName: string;
  rookieName?: string;
  rookieValue?: string;
  person: DraftPerson;
  players: PlayerCandidate[];
  onChange: (person: DraftPerson) => void;
}) {
  const typedName = normalizeName(person.rawName || person.name);
  const live =
    person.suggestions.length > 1 || person.playerId !== "new" || !normalizeName(person.name)
      ? null
      : classifyPlayerName(person.name, players);
  const visibleSuggestions = (
    person.suggestions.length > 1
      ? person.suggestions
      : live
        ? [
            ...(live.player ? [{ id: live.player.id, name: live.player.name }] : []),
            ...live.suggestions,
          ]
        : person.suggestions
  ).filter(
    (suggestion, index, all) =>
      suggestion.id !== person.playerId &&
      normalizeName(suggestion.name) !== typedName &&
      all.findIndex((item) => item.id === suggestion.id) === index,
  );
  const currentName = displayedName(person, players);
  const readAs =
    person.rawName && normalizeName(person.rawName) !== normalizeName(currentName)
      ? person.rawName
      : "";

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        name={idName}
        value={person.playerId}
        onChange={(event) => onChange(choosePlayer(person, event.target.value, players))}
        className={textFieldClass}
      >
        <option value="new">New player / guest</option>
        {players.map((player) => (
          <option key={player.id} value={player.id}>
            {player.name}
            {player.isRookie ? " (rookie)" : ""}
          </option>
        ))}
      </select>
      {person.playerId === "new" ? (
        <div className="flex items-start gap-2">
          <input
            name={nameName}
            value={person.name}
            placeholder="Name or number"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label={`${label} name`}
            onChange={(event) => onChange({ ...person, name: event.target.value })}
            className={textFieldClass}
          />
          {rookieName && rookieValue ? (
            <label className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100">
              <input
                type="checkbox"
                name={rookieName}
                value={rookieValue}
                checked={person.rookie}
                onChange={(event) => onChange({ ...person, rookie: event.target.checked })}
                className="size-4 accent-zinc-950 dark:accent-zinc-50"
              />
              Rookie
            </label>
          ) : null}
        </div>
      ) : (
        <input type="hidden" name={nameName} value={currentName} />
      )}
      {person.preselectedId && person.playerId === person.preselectedId ? (
        <p className="text-xs text-zinc-500">
          {person.matchedAs
            ? `Matched from the sheet, read as ${person.matchedAs}`
            : "Matched from the sheet."}
        </p>
      ) : readAs ? (
        <p className="text-xs text-zinc-500">Read as {readAs}.</p>
      ) : null}
      {visibleSuggestions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {visibleSuggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              className="inline-flex max-w-full items-center rounded-full bg-amber-100 px-3 py-1.5 text-left text-sm font-medium text-amber-950 transition-colors hover:bg-amber-200 dark:bg-amber-400/15 dark:text-amber-100 dark:hover:bg-amber-400/25"
              onClick={() =>
                onChange({
                  ...person,
                  playerId: suggestion.id,
                  name: suggestion.name,
                })
              }
            >
              Did you mean {suggestion.name}?
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
      <span className="leading-tight">{label}</span>
      <input
        name={name}
        inputMode="numeric"
        aria-label={label}
        value={value}
        placeholder="0"
        className={`${textFieldClass} px-0 text-center tabular-nums`}
        onChange={(event) => onChange(updateStat(value, event.target.value))}
      />
    </label>
  );
}

function TeamEditor({
  sideLabel,
  title,
  dotClass,
  prefix,
  lines,
  players,
  onChange,
}: {
  sideLabel: string;
  title: string;
  dotClass: string;
  prefix: string;
  lines: DraftLine[];
  players: PlayerCandidate[];
  onChange: (lines: DraftLine[]) => void;
}) {
  function patch(key: string, next: DraftLine) {
    onChange(lines.map((line) => (line.key === key ? next : line)));
  }

  return (
    <section
      aria-label={sideLabel}
      className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex items-center gap-3">
        <div className={`h-1.5 w-10 rounded-full ${dotClass}`} aria-hidden="true" />
        <h3 className="text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50">
          {title}
        </h3>
      </div>
      <p className="text-sm text-zinc-500">Players, goals, penalties, and the team score.</p>
      <div className="flex flex-col gap-4">
        {lines.map((line, index) => (
          <div
            key={line.key}
            className="flex flex-col gap-3 border-t border-zinc-100 pt-4 first:border-t-0 first:pt-0 dark:border-zinc-900"
          >
            <PlayerFields
              id={`${prefix}-player-${line.key}`}
              label={`${sideLabel} player ${index + 1}`}
              idName={`${prefix}PlayerId`}
              nameName={`${prefix}Name`}
              rookieName={`${prefix}Rookie`}
              rookieValue={String(index)}
              person={line}
              players={players}
              onChange={(next) => patch(line.key, { ...line, ...next })}
            />
            <div className="grid grid-cols-3 gap-2">
              <StatField
                label="Goals"
                name={`${prefix}Goals`}
                value={line.goals}
                onChange={(goals) => patch(line.key, { ...line, goals })}
              />
              <StatField
                label="Own Goals"
                name={`${prefix}OwnGoals`}
                value={line.ownGoals}
                onChange={(ownGoals) => patch(line.key, { ...line, ownGoals })}
              />
              <StatField
                label="Fouls"
                name={`${prefix}Fouls`}
                value={line.fouls}
                onChange={(fouls) => patch(line.key, { ...line, fouls })}
              />
            </div>
            {line.penaltyHint ? (
              <p className="text-xs text-zinc-500">
                Sheet penalties: {line.penaltyHint}. Each 30s, 1m, or EXP counts as one foul.
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function CardPreview({ url, region }: { url: string; region: SheetRegion | "full" }) {
  if (region === "full") {
    return (
      // Local object URLs are created from the uploaded photo.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt="Uploaded ref sheet"
        className="max-h-[28rem] w-full rounded-lg object-contain"
      />
    );
  }

  const column = region.endsWith("right") ? 1 : 0;
  const row = region.startsWith("bottom") ? 1 : 0;

  return (
    <div className="relative aspect-[5/4] overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
      {/* The crop is a quadrant of the same uploaded photo. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`${REGION_LABEL[region]} on the ref sheet`}
        className="absolute h-[200%] w-[200%] max-w-none"
        style={{ left: `${-column * 100}%`, top: `${-row * 100}%` }}
      />
    </div>
  );
}

const scoreFigure = "text-4xl font-semibold leading-none tabular-nums";

type WizardPhase = "setup" | "match" | "final";
type MatchSubStep = "officials" | "team-b" | "duplicate" | "summary";
type DuplicateChoice = "keep-new" | "use-existing";

interface MatchCheckClear {
  status: "clear";
}

interface MatchCheckDuplicate {
  status: "duplicate";
  match: DuplicateMatchView;
  choice: DuplicateChoice | null;
}

type MatchCheck = MatchCheckClear | MatchCheckDuplicate;

interface ReviewPlayer {
  id: string;
  name: string;
  goals: number;
  ownGoals: number;
  fouls: number;
}

const outlineButton =
  "inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900";

const primaryButton =
  "inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";

function isReady(check: MatchCheck | undefined): boolean {
  if (!check) {
    return false;
  }

  return check.status === "clear" || check.choice !== null;
}

function personWasTyped(person: DraftPerson): boolean {
  return person.playerId !== "new" || person.name.trim().length > 0;
}

function matchHasTypedData(match: DraftMatch): boolean {
  if (personWasTyped(match.referee) || personWasTyped(match.assistant)) {
    return true;
  }

  return [...match.teamA, ...match.teamB].some(
    (line) =>
      personWasTyped(line) || line.goals !== "" || line.ownGoals !== "" || line.fouls !== "",
  );
}

function checkLine(line: DraftLine, roster: PlayerCandidate[]): DuplicateCheckLine {
  return {
    name: displayedName(line, roster),
    playerId: line.playerId,
    goals: line.goals,
    ownGoals: line.ownGoals,
    fouls: line.fouls,
  };
}

function reviewPlayers(lines: DraftLine[], roster: PlayerCandidate[]): ReviewPlayer[] {
  return lines.flatMap((line) => {
    const name = displayedName(line, roster).trim();

    if (!name) {
      return [];
    }

    return [
      {
        id: line.key,
        name,
        goals: statNumber(line.goals),
        ownGoals: statNumber(line.ownGoals),
        fouls: statNumber(line.fouls),
      },
    ];
  });
}

function shownOfficial(person: DraftPerson, roster: PlayerCandidate[]): string {
  return displayedName(person, roster).trim() || "—";
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function TeamScore({ score, sheetScore }: { score: number; sheetScore: number | null }) {
  const differs = sheetScore !== null && sheetScore !== score;

  return (
    <div className="rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Team score</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
        {score}
      </p>
      {sheetScore !== null ? (
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          Score box on the sheet is {sheetScore}.
          {differs ? " Counted goals differ. Add own goals if the other side scored them." : ""}
        </p>
      ) : null}
    </div>
  );
}

function SideList({
  title,
  dotClass,
  players,
}: {
  title: string;
  dotClass: string;
  players: ReviewPlayer[];
}) {
  return (
    <div>
      <p className="flex items-center gap-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
        <span className={`inline-block h-1.5 w-6 rounded-full ${dotClass}`} aria-hidden="true" />
        {title}
      </p>
      {players.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">No players yet</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1 text-sm text-zinc-800 dark:text-zinc-100">
          {players.map((player) => (
            <li key={player.id}>
              <span className="font-medium">{player.name}</span>
              <span className="text-zinc-500">
                {" "}
                · {countLabel(player.goals, "goal", "goals")}
                {player.ownGoals > 0
                  ? ` · ${countLabel(player.ownGoals, "own goal", "own goals")}`
                  : ""}{" "}
                · {countLabel(player.fouls, "penalty", "penalties")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DuplicateColumn({
  title,
  marker,
  selected,
  onSelect,
  scoreTeamA,
  scoreTeamB,
  refereeName,
  assistantName,
  teamA,
  teamB,
  href,
  dateLabel,
  submittedBy,
}: {
  title: string;
  marker?: string;
  selected: boolean;
  onSelect: () => void;
  scoreTeamA: number;
  scoreTeamB: number;
  refereeName: string;
  assistantName: string;
  teamA: ReviewPlayer[];
  teamB: ReviewPlayer[];
  href?: string;
  dateLabel?: string;
  submittedBy?: string;
}) {
  return (
    <article
      onClick={onSelect}
      className={`flex cursor-pointer flex-col gap-4 rounded-2xl border bg-white p-4 text-left shadow-sm dark:bg-zinc-950 ${
        selected
          ? "border-zinc-950 ring-2 ring-zinc-950 dark:border-zinc-50 dark:ring-zinc-50"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <label className="flex items-start gap-3" onClick={(event) => event.stopPropagation()}>
        <input
          type="radio"
          name="duplicateChoice"
          className="mt-1 size-4 accent-zinc-950 dark:accent-zinc-50"
          checked={selected}
          onChange={onSelect}
        />
        <span>
          <span className="block text-sm font-semibold text-zinc-950 dark:text-zinc-50">{title}</span>
          {marker ? (
            <span className="mt-1 inline-flex rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              {marker}
            </span>
          ) : null}
          {dateLabel ? <span className="mt-1 block text-xs text-zinc-500">{dateLabel}</span> : null}
          {submittedBy ? (
            <span className="mt-0.5 block text-xs text-zinc-500">by {submittedBy}</span>
          ) : null}
        </span>
      </label>
      <p className="text-2xl font-semibold tabular-nums">
        <span className={teamATone.text}>{scoreTeamA}</span>
        <span className="px-2 text-zinc-400">:</span>
        <span className={teamBTone.text}>{scoreTeamB}</span>
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Ref {refereeName}. Assistant {assistantName}.
      </p>
      <SideList title="Team 1" dotClass={teamATone.dot} players={teamA} />
      <SideList title="Team 2" dotClass={teamBTone.dot} players={teamB} />
      {href ? (
        <Link
          href={href}
          onClick={(event) => event.stopPropagation()}
          className="text-sm font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-50"
        >
          View saved match
        </Link>
      ) : null}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        className={selected ? primaryButton : outlineButton}
      >
        {title}
      </button>
    </article>
  );
}

export function GameWizard({ players, defaultDate }: GameWizardProps) {
  const dateId = useId();
  const photoId = useId();
  const photoRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(submitGames, initialState);
  const [phase, setPhase] = useState<WizardPhase>("setup");
  const [subStep, setSubStep] = useState<MatchSubStep>("officials");
  const [matchIndex, setMatchIndex] = useState(0);
  const [matches, setMatches] = useState<DraftMatch[]>([]);
  const [checks, setChecks] = useState<Record<string, MatchCheck>>({});
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(false);
  const [ocrPromptOpen, setOcrPromptOpen] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitterQuery, setSubmitterQuery] = useState("");
  const [submitterId, setSubmitterId] = useState<string | null>(null);
  const [addSubmitter, setAddSubmitter] = useState(false);
  const [submitterRookie, setSubmitterRookie] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);
  const activeMatch = matches[matchIndex] ?? null;

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function selectFile(file: File | null, fromDrop: boolean) {
    if (fromDrop && photoRef.current) {
      const transfer = new DataTransfer();

      if (file) {
        transfer.items.add(file);
      }

      photoRef.current.files = transfer.files;
    }

    setFileName(file?.name ?? null);
    setPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return file && canPreviewPhoto(file) ? URL.createObjectURL(file) : null;
    });
  }

  function validateSubmitter(): string | null {
    if (!date) {
      return "Enter a valid match date.";
    }

    if (!normalizeName(submitterQuery)) {
      return "Enter who is submitting these games.";
    }

    return null;
  }

  function validateSetup(): string | null {
    const problem = validateSubmitter();

    if (problem) {
      return problem;
    }

    if (!photoRef.current?.files?.[0]) {
      return "Upload a photo of the ref sheet.";
    }

    return null;
  }

  useEffect(() => {
    if (!ocrPromptOpen) {
      return;
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOcrPromptOpen(false);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ocrPromptOpen]);

  function startMatches(next: DraftMatch[], manual: boolean) {
    setManualEntry(manual);
    setMatches(next);
    setMatchIndex(0);
    setChecks({});
    setIncluded(Object.fromEntries(next.map((match) => [match.key, true])));
    setSubStep("officials");
    setPhase("match");
    setLocalError(null);
    setOcrPromptOpen(false);
  }

  function invalidateMatch(key: string) {
    setChecks((current) => {
      if (!(key in current)) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function updateMatch(index: number, patch: (match: DraftMatch) => DraftMatch) {
    const key = matches[index]?.key;
    setMatches((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? patch(item) : item)),
    );

    if (key) {
      invalidateMatch(key);
    }

    setLocalError(null);
  }

  function onPhotoInput(file: File | null) {
    selectFile(file, false);

    if (!file || phase === "setup" || !manualEntry) {
      return;
    }

    if (matches.some(matchHasTypedData)) {
      setOcrPromptOpen(true);
      return;
    }

    void readSheet("replace");
  }

  function openManualMatch(note: string) {
    startMatches([blankMatch(note)], false);
  }

  function continueWithoutPhoto() {
    const problem = validateSubmitter();

    if (problem) {
      setLocalError(problem);
      return;
    }

    if (photoRef.current) {
      photoRef.current.value = "";
    }

    selectFile(null, false);
    startMatches([blankMatch("Entered online, without a ref sheet photo.")], true);
  }

  async function readSheet(mode: "initial" | "replace" = "initial") {
    const problem = validateSetup();

    if (problem) {
      setLocalError(problem);
      return;
    }

    const file = photoRef.current?.files?.[0];

    if (!file) {
      return;
    }

    setLocalError(null);
    setReading(true);

    try {
      const body = new FormData();
      body.set("refSheet", file);
      const response = await fetch("/api/games/submit", { method: "POST", body });
      const payload: unknown = await response.json();

      if (
        !response.ok ||
        !payload ||
        typeof payload !== "object" ||
        !("games" in payload) ||
        !Array.isArray(payload.games)
      ) {
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Could not read this ref sheet. Enter the games by hand.";
        setLocalError(message);
        return;
      }

      const games = payload.games.filter(isMatchedGame);

      if (games.length === 0) {
        const message =
          "message" in payload && typeof payload.message === "string"
            ? payload.message
            : "No filled match cards were found on this sheet.";

        if (mode === "replace") {
          setLocalError(`${message} The match you typed was kept.`);
          return;
        }

        openManualMatch(`${message} Enter this game by hand.`);
        return;
      }

      startMatches(draftsFromGames(games, players), false);
    } catch {
      setLocalError("Could not read this ref sheet. Enter the games by hand.");
    } finally {
      setReading(false);
    }
  }

  function goBack() {
    setLocalError(null);

    if (phase === "final") {
      setPhase("match");
      setSubStep("summary");
      return;
    }

    if (phase !== "match" || !activeMatch) {
      setPhase("setup");
      return;
    }

    if (subStep === "summary") {
      setSubStep(checks[activeMatch.key]?.status === "duplicate" ? "duplicate" : "team-b");
      return;
    }

    if (subStep === "duplicate") {
      setSubStep("team-b");
      return;
    }

    if (subStep === "team-b") {
      setSubStep("officials");
      return;
    }

    if (matchIndex === 0) {
      setPhase("setup");
      return;
    }

    setMatchIndex((current) => current - 1);
    setSubStep("summary");
  }

  function goToTeamTwo() {
    if (!activeMatch) {
      return;
    }

    const problem =
      personProblem(activeMatch.referee, "the referees", false) ??
      personProblem(activeMatch.assistant, "the referees", false) ??
      activeMatch.teamA.reduce<string | null>(
        (found, line) => found ?? personProblem(line, "team 1", true),
        null,
      ) ??
      roleConflict(activeMatch, players, "team-a");

    if (problem) {
      setLocalError(problem);
      return;
    }

    setLocalError(null);
    setSubStep("team-b");
  }

  async function saveActiveMatch() {
    if (!activeMatch || checking) {
      return;
    }

    const problem = validateMatch(activeMatch, players);

    if (problem) {
      setLocalError(problem);
      return;
    }

    setLocalError(null);
    setChecking(true);
    const key = activeMatch.key;

    try {
      const result = await checkDuplicateMatch({
        date,
        refereeName: displayedName(activeMatch.referee, players),
        refereeId: activeMatch.referee.playerId,
        assistantName: displayedName(activeMatch.assistant, players),
        assistantId: activeMatch.assistant.playerId,
        teamA: activeMatch.teamA.map((line) => checkLine(line, players)),
        teamB: activeMatch.teamB.map((line) => checkLine(line, players)),
      });

      if (!result.ok) {
        setLocalError(result.error);
        return;
      }

      setChecks((current) => ({
        ...current,
        [key]: result.duplicate
          ? { status: "duplicate", match: result.duplicate, choice: null }
          : { status: "clear" },
      }));
      setIncluded((current) => ({
        ...current,
        [key]: !result.duplicate,
      }));
      setSubStep(result.duplicate ? "duplicate" : "summary");
    } catch {
      setLocalError("Could not check this match for duplicates.");
    } finally {
      setChecking(false);
    }
  }

  function chooseDuplicate(choice: DuplicateChoice) {
    if (!activeMatch) {
      return;
    }

    const key = activeMatch.key;
    setChecks((current) => {
      const check = current[key];

      if (!check || check.status !== "duplicate") {
        return current;
      }

      return { ...current, [key]: { ...check, choice } };
    });
    setIncluded((current) => ({ ...current, [key]: choice === "keep-new" }));
    setLocalError(null);
  }

  function confirmDuplicate() {
    if (!activeMatch) {
      return;
    }

    const check = checks[activeMatch.key];

    if (!check || check.status !== "duplicate" || !check.choice) {
      setLocalError('Choose "Save new game" or "Don\'t save, keep saved game".');
      return;
    }

    setLocalError(null);
    setSubStep("summary");
  }

  function openBlockedMatch(index: number) {
    const match = matches[index];
    const check = match ? checks[match.key] : undefined;
    setMatchIndex(index);
    setPhase("match");
    setSubStep(check?.status === "duplicate" && !check.choice ? "duplicate" : "team-b");
  }

  function continueFromSummary() {
    if (!activeMatch || !isReady(checks[activeMatch.key])) {
      setLocalError("Save this match before continuing.");
      return;
    }

    const blocked = matches.findIndex((match) => !isReady(checks[match.key]));

    if (matchIndex >= matches.length - 1) {
      if (blocked !== -1) {
        openBlockedMatch(blocked);
        setLocalError("Save every match and resolve duplicates before the final summary.");
        return;
      }

      setLocalError(null);
      setPhase("final");
      return;
    }

    setLocalError(null);
    setMatchIndex((current) => current + 1);
    setSubStep("officials");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (phase !== "final") {
      event.preventDefault();
      return;
    }

    const blocked = matches.findIndex((match) => !isReady(checks[match.key]));

    if (blocked !== -1) {
      event.preventDefault();
      openBlockedMatch(blocked);
      setLocalError("Resolve every duplicate before submitting.");
      return;
    }

    const file = photoRef.current?.files?.[0];
    const hasPhoto = Boolean(file && file.size > 0);
    const selected = matches.filter((match) => {
      const check = checks[match.key];
      const useExisting = check?.status === "duplicate" && check.choice === "use-existing";

      return !useExisting && included[match.key] !== false;
    });

    if (selected.length === 0) {
      event.preventDefault();
      setLocalError("Select at least one game to submit.");
      return;
    }

    if (!hasPhoto && selected.length !== 1) {
      event.preventDefault();
      setLocalError("Without a ref sheet photo, submit one match at a time.");
      return;
    }

    for (const match of selected) {
      const problem = validateMatch(match, players);
      const index = matches.indexOf(match);

      if (problem) {
        event.preventDefault();
        setPhase("match");
        setMatchIndex(index);
        setSubStep("team-b");
        setLocalError(problem);
        return;
      }
    }
  }

  const selectedCount = matches.filter((match) => {
    const check = checks[match.key];
    const useExisting = check?.status === "duplicate" && check.choice === "use-existing";

    return !useExisting && included[match.key] !== false;
  }).length;
  const idleMessage =
    phase === "final"
      ? selectedCount === 0
        ? "Select at least one new game. Matches kept from the database are not submitted again."
        : "Selected games are saved as pending until they are approved."
      : phase === "match"
        ? subStep === "officials"
          ? "Check the referees and team 1, then continue."
          : subStep === "team-b"
            ? "Check team 2, then save this match."
            : subStep === "duplicate"
              ? "Choose which match to keep before continuing."
              : "This match is ready for the final summary."
        : "Upload a ref sheet to read every filled card, or continue without a photo to enter one match.";
  const message = state.error ?? localError ?? idleMessage;
  const score = activeMatch
    ? tallyMatchScore(
        activeMatch.teamA.map((line) => toMatchLine(line, players)),
        activeMatch.teamB.map((line) => toMatchLine(line, players)),
      )
    : null;
  const activeCheck = activeMatch ? checks[activeMatch.key] : undefined;
  const duplicateChoice = activeCheck?.status === "duplicate" ? activeCheck.choice : null;
  const subStepLabel =
    subStep === "officials"
      ? "Referees and team 1"
      : subStep === "team-b"
        ? "Team 2"
        : subStep === "duplicate"
          ? "Duplicate match"
          : "Match summary";

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-6">
      <input type="hidden" name="gameCount" value={matches.length} />
      <input
        ref={photoRef}
        id={photoId}
        name="refSheet"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
        className="sr-only"
        aria-describedby={`${photoId}-hint`}
        onChange={(event) => onPhotoInput(event.target.files?.[0] ?? null)}
      />
      <div hidden={phase !== "setup"} className="flex flex-col gap-6">
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50">
            Step 1 · Who is submitting
          </p>
          <label
            htmlFor={dateId}
            className="mt-4 block text-sm font-medium text-zinc-800 dark:text-zinc-200"
          >
            Match date
          </label>
          <input
            id={dateId}
            name="date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={`${textFieldClass} mt-2 max-w-xs`}
          />
          <h2 className="mt-5 text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50">
            Submitted by
          </h2>
          <SubmitterCombobox
            players={players}
            query={submitterQuery}
            selectedId={submitterId}
            addToLeague={addSubmitter}
            rookie={submitterRookie}
            onQueryChange={(value) => {
              setSubmitterQuery(value);
              setSubmitterId(null);
              setLocalError(null);
            }}
            onSelect={(player) => {
              setSubmitterQuery(player.name);
              setSubmitterId(player.id);
              setAddSubmitter(false);
              setSubmitterRookie(false);
              setLocalError(null);
            }}
            onAddToLeagueChange={setAddSubmitter}
            onRookieChange={setSubmitterRookie}
          />
        </section>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50">
              Upload ref sheet photo
            </h2>
            <p id={`${photoId}-hint`} className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              The sheet is a 2×2 grid. We read each filled card, then you review
              it before anything is saved. One photo can hold up to four matches.
            </p>
            <a
              href="/ref-sheet-template.jpg"
              className="mt-2 inline-flex text-sm font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-50"
            >
              Blank template
            </a>
            <label
              htmlFor={photoId}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                selectFile(event.dataTransfer.files[0] ?? null, true);
              }}
              className={`mt-4 flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors ${
                dragging
                  ? "border-zinc-950 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {fileName ?? "Upload the ref sheet"}
              </span>
              <span className="text-xs text-zinc-500">HEIC, PNG, JPG, WEBP, or GIF</span>
            </label>
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Ref sheet photo"
                className="mt-4 max-h-80 w-full rounded-lg object-contain"
              />
            ) : null}
            <button
              type="button"
              disabled={reading}
              onClick={() => void readSheet()}
              className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {reading ? "Reading sheet…" : "Read the sheet"}
            </button>
          </section>
          <section className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50">
              Enter online
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Continue without a photo and type one match by hand. A ref sheet is
              not required, and only one match can be submitted this way.
            </p>
            <button
              type="button"
              disabled={reading}
              onClick={continueWithoutPhoto}
              className="mt-4 inline-flex h-11 items-center justify-center self-start rounded-full border border-zinc-300 px-5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              Continue without photo
            </button>
          </section>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p
            role={localError ? "alert" : undefined}
            className={
              localError ? "text-sm text-rose-700 dark:text-rose-400" : "text-sm text-zinc-500"
            }
          >
            {localError ?? message}
          </p>
          {localError && fileName ? (
            <button
              type="button"
              onClick={() => {
                const problem = validateSetup();

                if (problem) {
                  setLocalError(problem);
                  return;
                }

                openManualMatch("Enter this game by hand.");
                setLocalError(null);
              }}
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-medium text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
            >
              Enter this sheet by hand
            </button>
          ) : null}
        </div>
      </div>
      {manualEntry && phase !== "setup" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-zinc-300 px-4 py-3 dark:border-zinc-700">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {fileName
              ? `${fileName} is attached.`
              : "A ref sheet photo is optional. You can add one at any step."}
          </p>
          <button
            type="button"
            disabled={reading}
            onClick={() => photoRef.current?.click()}
            className={outlineButton}
          >
            {reading ? "Reading sheet…" : "Add Ref Sheet Photo"}
          </button>
        </div>
      ) : null}
      <div hidden={phase !== "match" || !activeMatch} className="flex flex-col gap-6">
        {activeMatch && score ? (
          <>
            <section
              aria-live="polite"
              aria-label={`Match ${matchIndex + 1} of ${matches.length}. ${subStepLabel}. Red ${score.scoreTeamA}, blue ${score.scoreTeamB}`}
              className="sticky top-4 z-10 flex flex-col items-center gap-4 rounded-2xl bg-zinc-950 px-4 py-5 text-white shadow-lg sm:px-6"
            >
              <p className="text-sm font-semibold tracking-wide text-zinc-300 uppercase">
                Match {matchIndex + 1} of {matches.length}
              </p>
              <p className="text-sm text-zinc-300">{subStepLabel}</p>
              <div className="flex gap-1.5" aria-hidden="true">
                {matches.map((match, index) => (
                  <span
                    key={match.key}
                    className={`h-1.5 w-8 rounded-full ${
                      index === matchIndex ? "bg-white" : "bg-zinc-700"
                    }`}
                  />
                ))}
              </div>
              <div className="flex items-center justify-center gap-3">
                <p className={`${scoreFigure} ${teamATone.onDark}`}>{score.scoreTeamA}</p>
                <p className={`${scoreFigure} text-white`} aria-hidden="true">
                  :
                </p>
                <p className={`${scoreFigure} ${teamBTone.onDark}`}>{score.scoreTeamB}</p>
              </div>
              {subStep === "officials" || subStep === "team-b" ? (
                <LineupColumns
                  onDark
                  left={namedPlayers(activeMatch.teamA, players)}
                  right={namedPlayers(activeMatch.teamB, players)}
                />
              ) : null}
            </section>
            {matches.map((match, index) => {
              const show = index === matchIndex;
              const matchScore = tallyMatchScore(
                match.teamA.map((line) => toMatchLine(line, players)),
                match.teamB.map((line) => toMatchLine(line, players)),
              );
              const showSheet = show && (subStep === "officials" || subStep === "team-b");

              return (
                <div key={match.key} hidden={!show} className="flex flex-col gap-6">
                  <div hidden={!showSheet} className="flex flex-col gap-4">
                    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                      <h2 className="text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50">
                        {manualEntry ? "Online entry" : REGION_LABEL[match.region]}
                      </h2>
                      {previewUrl ? (
                        <div className="mt-4">
                          <CardPreview url={previewUrl} region={match.region} />
                        </div>
                      ) : null}
                      {match.notes.map((note) => (
                        <p key={note} className="mt-3 text-xs leading-5 text-zinc-500">
                          {note}
                        </p>
                      ))}
                    </section>
                  </div>
                  <div hidden={!show || subStep !== "officials"} className="flex flex-col gap-6">
                    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                      <h2 className="text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50">
                        Referees
                      </h2>
                      <p className="mt-1 text-xs text-zinc-500">
                        Ref and assistant. Leave either blank if that role was empty.
                      </p>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div>
                          <p className="mb-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                            Ref
                          </p>
                          <PlayerFields
                            id={`ref-${match.key}`}
                            label={`Match ${index + 1} ref`}
                            idName={`game${index}RefereeId`}
                            nameName={`game${index}Referee`}
                            person={match.referee}
                            players={players}
                            onChange={(referee) =>
                              updateMatch(index, (item) => ({ ...item, referee }))
                            }
                          />
                        </div>
                        <div>
                          <p className="mb-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                            Assistant
                          </p>
                          <PlayerFields
                            id={`asst-${match.key}`}
                            label={`Match ${index + 1} assistant`}
                            idName={`game${index}AssistantId`}
                            nameName={`game${index}Assistant`}
                            person={match.assistant}
                            players={players}
                            onChange={(assistant) =>
                              updateMatch(index, (item) => ({ ...item, assistant }))
                            }
                          />
                        </div>
                      </div>
                    </section>
                    <TeamEditor
                      sideLabel="Team 1"
                      title="Team 1"
                      dotClass={teamATone.dot}
                      prefix={`game${index}TeamA`}
                      lines={match.teamA}
                      players={players}
                      onChange={(teamA) => updateMatch(index, (item) => ({ ...item, teamA }))}
                    />
                    <TeamScore score={matchScore.scoreTeamA} sheetScore={match.scoreTeamA} />
                  </div>
                  <div hidden={!show || subStep !== "team-b"} className="flex flex-col gap-6">
                    <TeamEditor
                      sideLabel="Team 2"
                      title="Team 2"
                      dotClass={teamBTone.dot}
                      prefix={`game${index}TeamB`}
                      lines={match.teamB}
                      players={players}
                      onChange={(teamB) => updateMatch(index, (item) => ({ ...item, teamB }))}
                    />
                    <TeamScore score={matchScore.scoreTeamB} sheetScore={match.scoreTeamB} />
                  </div>
                </div>
              );
            })}
            {subStep === "duplicate" && activeCheck?.status === "duplicate" ? (
              <section className="flex flex-col gap-4">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                    This match is already saved
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Choose Save new game or Don&apos;t save, keep saved game. Nothing is written
                    over the saved game until you submit.
                  </p>
                </div>
                <div
                  role="radiogroup"
                  aria-label="Choose which match to keep"
                  className="grid items-start gap-4 lg:grid-cols-2"
                >
                  <DuplicateColumn
                    title="Save new game"
                    marker="now by you"
                    selected={duplicateChoice === "keep-new"}
                    onSelect={() => chooseDuplicate("keep-new")}
                    scoreTeamA={score.scoreTeamA}
                    scoreTeamB={score.scoreTeamB}
                    refereeName={shownOfficial(activeMatch.referee, players)}
                    assistantName={shownOfficial(activeMatch.assistant, players)}
                    teamA={reviewPlayers(activeMatch.teamA, players)}
                    teamB={reviewPlayers(activeMatch.teamB, players)}
                  />
                  <DuplicateColumn
                    title="Don't save, keep saved game"
                    selected={duplicateChoice === "use-existing"}
                    onSelect={() => chooseDuplicate("use-existing")}
                    scoreTeamA={activeCheck.match.scoreTeamA}
                    scoreTeamB={activeCheck.match.scoreTeamB}
                    refereeName={activeCheck.match.refereeName ?? "—"}
                    assistantName={activeCheck.match.assistantName ?? "—"}
                    teamA={activeCheck.match.teamA}
                    teamB={activeCheck.match.teamB}
                    href={activeCheck.match.href}
                    dateLabel={activeCheck.match.dateLabel}
                    submittedBy={activeCheck.match.submittedBy}
                  />
                </div>
              </section>
            ) : null}
            {subStep === "summary" ? (
              <section className="flex flex-col items-center rounded-2xl border border-zinc-200 bg-white px-5 py-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                  Match {matchIndex + 1} summary
                </h2>
                <p className="mt-1 max-w-md text-sm text-zinc-500">
                  {activeCheck?.status === "duplicate" && activeCheck.choice === "use-existing"
                    ? "The saved game stays as it is. This new entry will not be submitted."
                    : "This match is ready to include in the final summary."}
                </p>
                <p className="mt-6 text-5xl font-semibold tabular-nums tracking-tight">
                  <span className={teamATone.text}>{score.scoreTeamA}</span>
                  <span className="px-3 text-zinc-400">:</span>
                  <span className={teamBTone.text}>{score.scoreTeamB}</span>
                </p>
                <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">
                  Ref {shownOfficial(activeMatch.referee, players)}. Assistant{" "}
                  {shownOfficial(activeMatch.assistant, players)}.
                </p>
                {activeCheck?.status === "duplicate" && activeCheck.choice === "use-existing" ? (
                  <Link
                    href={activeCheck.match.href}
                    className="mt-3 inline-flex text-sm font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-50"
                  >
                    View saved match
                  </Link>
                ) : null}
              </section>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p
                role={state.error || localError ? "alert" : undefined}
                className={
                  state.error || localError
                    ? "text-sm text-rose-700 dark:text-rose-400"
                    : "text-sm text-zinc-500"
                }
              >
                {message}
              </p>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={goBack} className={outlineButton}>
                  Back
                </button>
                {subStep === "officials" ? (
                  <button type="button" onClick={goToTeamTwo} className={primaryButton}>
                    Next
                  </button>
                ) : null}
                {subStep === "team-b" ? (
                  <button
                    type="button"
                    disabled={checking}
                    onClick={() => void saveActiveMatch()}
                    className={primaryButton}
                  >
                    {checking ? "Checking…" : "Save Match"}
                  </button>
                ) : null}
                {subStep === "duplicate" ? (
                  <button
                    type="button"
                    disabled={duplicateChoice === null}
                    onClick={confirmDuplicate}
                    className={primaryButton}
                  >
                    Continue
                  </button>
                ) : null}
                {subStep === "summary" ? (
                  <button type="button" onClick={continueFromSummary} className={primaryButton}>
                    {matchIndex === matches.length - 1 ? "Go to Final Summary" : "Next Game"}
                  </button>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </div>
      {phase === "final" ? (
        <div className="flex flex-col gap-6">
          <input type="hidden" name="selectGames" value="1" />
          {matches.map((match, index) => {
            const check = checks[match.key];

            if (check?.status !== "duplicate" || check.choice !== "keep-new") {
              return null;
            }

            return (
              <input key={`keep-${match.key}`} type="hidden" name={`game${index}KeepNew`} value="1" />
            );
          })}
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50">
              Final summary
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {selectedCount === 1 ? "1 game" : `${selectedCount} games`} selected. Each one is
              saved as pending.
            </p>
            <ul className="mt-4 flex flex-col gap-3">
              {matches.map((match, index) => {
                const check = checks[match.key];
                const useExisting =
                  check?.status === "duplicate" && check.choice === "use-existing";
                const matchScore = tallyMatchScore(
                  match.teamA.map((line) => toMatchLine(line, players)),
                  match.teamB.map((line) => toMatchLine(line, players)),
                );

                return (
                  <li
                    key={match.key}
                    className="rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800"
                  >
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        name={useExisting ? undefined : `includeGame${index}`}
                        value="1"
                        checked={!useExisting && included[match.key] !== false}
                        disabled={useExisting}
                        onChange={(event) =>
                          setIncluded((current) => ({
                            ...current,
                            [match.key]: event.target.checked,
                          }))
                        }
                        className="mt-1 size-4 accent-zinc-950 disabled:opacity-40 dark:accent-zinc-50"
                      />
                      <span className="min-w-0">
                        <span className="font-medium text-zinc-950 dark:text-zinc-50">
                          Match {index + 1}
                        </span>
                        <span className="mt-1 block text-center text-3xl font-semibold tabular-nums">
                          <span className={teamATone.text}>{matchScore.scoreTeamA}</span>
                          <span className="px-2 text-zinc-400">:</span>
                          <span className={teamBTone.text}>{matchScore.scoreTeamB}</span>
                        </span>
                        <span className="mt-1 block text-sm text-zinc-500">
                          Ref {shownOfficial(match.referee, players)}. Assistant{" "}
                          {shownOfficial(match.assistant, players)}.
                        </span>
                        {useExisting && check.status === "duplicate" ? (
                          <Link
                            href={check.match.href}
                            className="mt-1 inline-flex text-sm font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-50"
                          >
                            Using the saved game from {check.match.dateLabel}
                            {check.match.submittedBy ? ` by ${check.match.submittedBy}` : ""}
                          </Link>
                        ) : null}
                        {check?.status === "duplicate" && check.choice === "keep-new" ? (
                          <span className="mt-1 block text-sm text-zinc-500">
                            Saving this as a new game.
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p
              role={state.error || localError ? "alert" : undefined}
              className={
                state.error || localError
                  ? "text-sm text-rose-700 dark:text-rose-400"
                  : "text-sm text-zinc-500"
              }
            >
              {message}
            </p>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={goBack} className={outlineButton}>
                Back
              </button>
              <button type="submit" disabled={pending || selectedCount === 0} className={primaryButton}>
                {pending ? "Submitting…" : "Submit Selected Games"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {ocrPromptOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${photoId}-ocr-title`}
            className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <h2
              id={`${photoId}-ocr-title`}
              className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
            >
              Add ref sheet photo
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
              Do you want to run OCR on this photo? (This will overwrite current manually entered
              fields)
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setOcrPromptOpen(false)} className={outlineButton}>
                Keep what I typed
              </button>
              <button
                type="button"
                onClick={() => {
                  setOcrPromptOpen(false);
                  void readSheet("replace");
                }}
                className={primaryButton}
              >
                Run OCR
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}
