"use client";

import { useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { submitGames, type GameActionState } from "@/app/actions/game";
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
    suggestions: [],
    preselectedId: null,
    rookie: false,
  };
}

function sheetNameOf(match: SheetNameMatch & { name?: string }): string | null {
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
    return required ? `Enter a name for every player on the ${label}.` : null;
  }

  if (!normalizeName(name)) {
    return "Use a player name of letters or numbers.";
  }

  return null;
}

function validateMatch(match: DraftMatch): string | null {
  const referee = personProblem(match.referee, "referees", false);
  const assistant = personProblem(match.assistant, "referees", false);

  if (referee || assistant) {
    return referee ?? assistant;
  }

  for (const line of match.teamA) {
    const problem = personProblem(line, "red side", true);

    if (problem) {
      return problem;
    }
  }

  for (const line of match.teamB) {
    const problem = personProblem(line, "blue side", true);

    if (problem) {
      return problem;
    }
  }

  return null;
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
  const live =
    person.playerId === "new" && normalizeName(person.name)
      ? classifyPlayerName(person.name, players)
      : null;
  const visibleSuggestions = (
    live
      ? [
          ...(live.player ? [{ id: live.player.id, name: live.player.name }] : []),
          ...live.suggestions,
        ]
      : person.suggestions
  ).filter(
    (suggestion, index, all) =>
      suggestion.id !== person.playerId &&
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
        <p className="text-xs text-zinc-500">Matched from the sheet.</p>
      ) : null}
      {readAs ? <p className="text-xs text-zinc-500">Read as {readAs}.</p> : null}
      {visibleSuggestions.map((suggestion) => (
        <button
          key={suggestion.id}
          type="button"
          className="inline-flex w-fit max-w-full items-center rounded-full bg-amber-100 px-3 py-1.5 text-left text-sm font-medium text-amber-950 transition-colors hover:bg-amber-200 dark:bg-amber-400/15 dark:text-amber-100 dark:hover:bg-amber-400/25"
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
  dotClass,
  prefix,
  lines,
  players,
  onChange,
}: {
  sideLabel: string;
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
      <div className={`h-1.5 w-10 rounded-full ${dotClass}`} aria-hidden="true" />
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

export function GameWizard({ players, defaultDate }: GameWizardProps) {
  const dateId = useId();
  const photoId = useId();
  const photoRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(submitGames, initialState);
  const [step, setStep] = useState<"setup" | "matches">("setup");
  const [matchIndex, setMatchIndex] = useState(0);
  const [matches, setMatches] = useState<DraftMatch[]>([]);
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

  function openManualMatch(note: string) {
    setManualEntry(false);
    setMatches([blankMatch(note)]);
    setMatchIndex(0);
    setStep("matches");
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
    setManualEntry(true);
    setMatches([blankMatch("Entered online, without a ref sheet photo.")]);
    setMatchIndex(0);
    setLocalError(null);
    setStep("matches");
  }

  async function readSheet() {
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
        openManualMatch(`${message} Enter this game by hand.`);
        return;
      }

      setManualEntry(false);
      setMatches(draftsFromGames(games, players));
      setMatchIndex(0);
      setStep("matches");
    } catch {
      setLocalError("Could not read this ref sheet. Enter the games by hand.");
    } finally {
      setReading(false);
    }
  }

  function goBack() {
    setLocalError(null);

    if (matchIndex === 0) {
      setStep("setup");
      return;
    }

    setMatchIndex((current) => current - 1);
  }

  function goNext() {
    if (!activeMatch) {
      return;
    }

    const problem = validateMatch(activeMatch);

    if (problem) {
      setLocalError(problem);
      return;
    }

    setLocalError(null);
    setMatchIndex((current) => current + 1);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (step !== "matches") {
      event.preventDefault();
      return;
    }

    const file = photoRef.current?.files?.[0];
    const hasPhoto = Boolean(file && file.size > 0);

    if (!hasPhoto && matches.length !== 1) {
      event.preventDefault();
      setLocalError("Without a ref sheet photo, submit one match at a time.");
      return;
    }

    for (let index = 0; index < matches.length; index += 1) {
      const problem = validateMatch(matches[index]);

      if (problem) {
        event.preventDefault();
        setMatchIndex(index);
        setLocalError(problem);
        return;
      }
    }
  }

  const message =
    state.error ??
    localError ??
    (step === "matches"
      ? manualEntry
        ? "This match stays pending until it is approved. Without a photo, only one match can be submitted."
        : "These games stay pending until they are approved."
      : "Upload a ref sheet to read every filled card, or continue without a photo to enter one match.");
  const score = activeMatch
    ? tallyMatchScore(
        activeMatch.teamA.map((line) => toMatchLine(line, players)),
        activeMatch.teamB.map((line) => toMatchLine(line, players)),
      )
    : null;
  const sheetDiffers =
    activeMatch !== null &&
    score !== null &&
    ((activeMatch.scoreTeamA !== null && activeMatch.scoreTeamA !== score.scoreTeamA) ||
      (activeMatch.scoreTeamB !== null && activeMatch.scoreTeamB !== score.scoreTeamB));
  const lastMatch = activeMatch !== null && matchIndex === matches.length - 1;

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
        onChange={(event) => selectFile(event.target.files?.[0] ?? null, false)}
      />
      <div hidden={step !== "setup"} className="flex flex-col gap-6">
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
      <div hidden={step !== "matches" || !activeMatch} className="flex flex-col gap-6">
        {activeMatch && score ? (
          <>
            <section
              aria-live="polite"
              aria-label={`Match ${matchIndex + 1} of ${matches.length}. Red ${score.scoreTeamA}, blue ${score.scoreTeamB}`}
              className="sticky top-4 z-10 flex flex-col items-center gap-4 rounded-2xl bg-zinc-950 px-4 py-5 text-white shadow-lg sm:px-6"
            >
              <p className="text-sm font-semibold tracking-wide text-zinc-300 uppercase">
                Match {matchIndex + 1} of {matches.length}
              </p>
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
              {activeMatch.scoreTeamA !== null || activeMatch.scoreTeamB !== null ? (
                <p className="text-center text-xs leading-5 text-zinc-300">
                  Score box {activeMatch.scoreTeamA ?? "–"} : {activeMatch.scoreTeamB ?? "–"}
                  {sheetDiffers
                    ? ". Counted goals differ. Add own goals if the other side scored them."
                    : ""}
                </p>
              ) : null}
              <LineupColumns
                onDark
                left={namedPlayers(activeMatch.teamA, players)}
                right={namedPlayers(activeMatch.teamB, players)}
              />
            </section>
            {matches.map((match, index) => (
              <div key={match.key} hidden={index !== matchIndex} className="flex flex-col gap-6">
                <div className="grid items-start gap-4 lg:grid-cols-2">
                  <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                    <h2 className="text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50">
                      {manualEntry ? "Online entry" : REGION_LABEL[match.region]}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      Step 2 · check names, goals, penalties, and the score.
                    </p>
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
                  <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                    <h2 className="text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50">
                      Referees
                    </h2>
                    <p className="mt-1 text-xs text-zinc-500">
                      Ref and assistant, kept as one list. Leave either blank if that role was empty.
                    </p>
                    <div className="mt-4 flex flex-col gap-4">
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
                          onChange={(referee) => {
                            setLocalError(null);
                            setMatches((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, referee } : item,
                              ),
                            );
                          }}
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
                          onChange={(assistant) => {
                            setLocalError(null);
                            setMatches((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, assistant } : item,
                              ),
                            );
                          }}
                        />
                      </div>
                    </div>
                  </section>
                </div>
                <div className="grid gap-6 lg:grid-cols-2">
                  <TeamEditor
                    sideLabel="Red"
                    dotClass={teamATone.dot}
                    prefix={`game${index}TeamA`}
                    lines={match.teamA}
                    players={players}
                    onChange={(teamA) => {
                      setLocalError(null);
                      setMatches((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, teamA } : item,
                        ),
                      );
                    }}
                  />
                  <TeamEditor
                    sideLabel="Blue"
                    dotClass={teamBTone.dot}
                    prefix={`game${index}TeamB`}
                    lines={match.teamB}
                    players={players}
                    onChange={(teamB) => {
                      setLocalError(null);
                      setMatches((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, teamB } : item,
                        ),
                      );
                    }}
                  />
                </div>
              </div>
            ))}
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
                <button
                  type="button"
                  onClick={goBack}
                  className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  Back
                </button>
                {lastMatch ? (
                  <button
                    type="submit"
                    disabled={pending}
                    className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                  >
                    {pending
                      ? "Submitting…"
                      : matches.length > 1
                        ? "Submit All Games"
                        : "Submit match"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={goNext}
                    className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                  >
                    Next Match
                  </button>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </form>
  );
}
