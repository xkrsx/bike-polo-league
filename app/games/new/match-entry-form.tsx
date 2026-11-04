"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { createGame, type GameActionState } from "@/app/actions/game";
import { LineupColumns, type LineupPlayer } from "@/app/games/lineup-columns";
import { tallyMatchScore, type MatchLine } from "@/lib/match-sheet";
import {
  penaltySummary,
  REF_SHEET_SKIPPED_FIELDS,
  type ParsedRefSheet,
  type SheetPlayerLine,
} from "@/lib/ref-sheet-ocr";
import { teamA as teamATone, teamB as teamBTone } from "@/lib/team-colors";
import {
  normalizeName,
  playerCorrections,
  resolvePlayerName,
  searchPlayers,
  type PlayerCandidate,
} from "@/lib/player-match";

export interface MatchEntryLine {
  name: string;
  goals: number;
  ownGoals: number;
  fouls: number;
}

interface MatchEntryInitial {
  referee: string;
  teamA: MatchEntryLine[];
  teamB: MatchEntryLine[];
}

type MatchFormAction = (
  previous: GameActionState,
  formData: FormData,
) => Promise<GameActionState>;

interface MatchEntryFormProps {
  players: PlayerCandidate[];
  defaultDate: string;
  initial?: MatchEntryInitial;
  action?: MatchFormAction;
  submitLabel?: string;
  pendingLabel?: string;
  idleMessage?: string;
  cancelHref?: string;
  requireSubmitter?: boolean;
  existingImageUrl?: string | null;
  submittedBy?: string;
  statusLabel?: string;
}

interface LineRow {
  key: string;
  name: string;
  goals: string;
  ownGoals: string;
  fouls: string;
  penaltyHint: string;
}

const initialState: GameActionState = { error: null };

const textFieldClass =
  "h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200";

function lineRows(prefix: string, lines: MatchEntryLine[] | undefined): LineRow[] {
  return [0, 1, 2].map((index) => {
    const line = lines?.[index];

    return {
      key: `${prefix}-${index}`,
      name: line?.name ?? "",
      goals: line ? String(line.goals) : "",
      ownGoals: line ? String(line.ownGoals) : "",
      fouls: line ? String(line.fouls) : "",
      penaltyHint: "",
    };
  });
}

function rowsFromSheet(prefix: string, lines: SheetPlayerLine[]): LineRow[] {
  return [0, 1, 2].map((index) => {
    const line = lines[index];

    return {
      key: `${prefix}-${index}`,
      name: line?.name ?? "",
      goals: line ? String(line.goals) : "",
      ownGoals: "",
      fouls: line ? String(line.fouls) : "",
      penaltyHint: line ? penaltySummary(line.penalties) : "",
    };
  });
}

function statNumber(value: string): number {
  if (!/^\d{1,2}$/.test(value)) {
    return 0;
  }

  return Number(value);
}

function toMatchLine(line: LineRow): MatchLine {
  return {
    name: line.name,
    goals: statNumber(line.goals),
    ownGoals: statNumber(line.ownGoals),
    fouls: statNumber(line.fouls),
  };
}

function updateStat(current: string, next: string): string {
  if (next === "" || /^\d{0,2}$/.test(next)) {
    return next;
  }

  return current;
}

function isNewPlayerName(value: string, players: PlayerCandidate[]): boolean {
  if (!normalizeName(value)) {
    return false;
  }

  return resolvePlayerName(value, players).kind === "none";
}

function PlayerNameField({
  id,
  name,
  label,
  value,
  placeholder,
  players,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  placeholder: string;
  players: PlayerCandidate[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = `${id}-suggestions`;
  const corrections = playerCorrections(value, players);
  const correctionIds = new Set(corrections.map((player) => player.id));
  const normalizedValue = normalizeName(value);
  const completions = searchPlayers(value, players).filter((player) => {
    if (correctionIds.has(player.id)) {
      return false;
    }

    return normalizeName(player.name) !== normalizedValue;
  });
  const showCompletions = open && completions.length > 0;

  function accept(playerName: string) {
    onChange(playerName);
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        name={name}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-controls={showCompletions ? listId : undefined}
        className={textFieldClass}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {corrections.map((player) => (
        <button
          key={player.id}
          type="button"
          className="inline-flex w-fit max-w-full items-center rounded-full bg-amber-100 px-3 py-1.5 text-left text-sm font-medium text-amber-950 transition-colors hover:bg-amber-200 dark:bg-amber-400/15 dark:text-amber-100 dark:hover:bg-amber-400/25"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => accept(player.name)}
        >
          Did you mean {player.name}?
        </button>
      ))}
      {corrections.length === 1 ? (
        <p className="text-xs text-zinc-500">
          This existing player will be linked when you save.
        </p>
      ) : null}
      {corrections.length > 1 ? (
        <p className="text-xs text-zinc-500">Choose one of these names.</p>
      ) : null}
      {showCompletions ? (
        <ul
          id={listId}
          className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        >
          {completions.map((player) => (
            <li key={player.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-900"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => accept(player.name)}
              >
                {player.name}
              </button>
            </li>
          ))}
        </ul>
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

function RookieField({
  name,
  value,
  checked,
  onChange,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100">
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-zinc-950 dark:accent-zinc-50"
      />
      Rookie
    </label>
  );
}

function TeamLines({
  sideLabel,
  dotClass,
  namePrefix,
  lines,
  players,
  rookies,
  onChange,
  onRookieChange,
}: {
  sideLabel: string;
  dotClass: string;
  namePrefix: "teamA" | "teamB";
  lines: LineRow[];
  players: PlayerCandidate[];
  rookies: Readonly<Record<string, boolean>>;
  onChange: (lines: LineRow[]) => void;
  onRookieChange: (name: string, checked: boolean) => void;
}) {
  function patch(key: string, next: Partial<Omit<LineRow, "key">>) {
    onChange(
      lines.map((line) => (line.key === key ? { ...line, ...next } : line)),
    );
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
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <PlayerNameField
                  id={`${namePrefix}-name-${line.key}`}
                  name={`${namePrefix}Name`}
                  label={`${sideLabel} player ${index + 1}`}
                  value={line.name}
                  placeholder="Player name"
                  players={players}
                  onChange={(name) => patch(line.key, { name })}
                />
              </div>
              {isNewPlayerName(line.name, players) ? (
                <RookieField
                  name={`${namePrefix}Rookie`}
                  value={String(index)}
                  checked={rookies[normalizeName(line.name)] === true}
                  onChange={(checked) => onRookieChange(line.name, checked)}
                />
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <StatField
                label="Goals"
                name={`${namePrefix}Goals`}
                value={line.goals}
                onChange={(goals) => patch(line.key, { goals })}
              />
              <StatField
                label="Own Goals"
                name={`${namePrefix}OwnGoals`}
                value={line.ownGoals}
                onChange={(ownGoals) => patch(line.key, { ownGoals })}
              />
              <StatField
                label="Fouls"
                name={`${namePrefix}Fouls`}
                value={line.fouls}
                onChange={(fouls) => patch(line.key, { fouls })}
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

const scoreFigure = "text-4xl font-semibold leading-none tabular-nums";

function playerIsRookie(
  name: string,
  players: PlayerCandidate[],
  rookies: Readonly<Record<string, boolean>>,
): boolean {
  const resolution = resolvePlayerName(name, players);

  if (resolution.kind === "exact" || resolution.kind === "similar") {
    return resolution.player.isRookie === true;
  }

  if (resolution.kind === "none") {
    return rookies[normalizeName(name)] === true;
  }

  return false;
}

function namedPlayers(
  lines: LineRow[],
  players: PlayerCandidate[],
  rookies: Readonly<Record<string, boolean>>,
): LineupPlayer[] {
  return lines.flatMap((line) => {
    const name = line.name.trim();

    if (!name) {
      return [];
    }

    return [
      {
        id: line.key,
        name,
        goals: statNumber(line.goals),
        ownGoals: statNumber(line.ownGoals),
        isRookie: playerIsRookie(name, players, rookies),
      },
    ];
  });
}

function Scoreboard({
  teamA,
  teamB,
  players,
  rookies,
  sheetScore,
}: {
  teamA: LineRow[];
  teamB: LineRow[];
  players: PlayerCandidate[];
  rookies: Readonly<Record<string, boolean>>;
  sheetScore: { teamA: number | null; teamB: number | null } | null;
}) {
  const score = tallyMatchScore(teamA.map(toMatchLine), teamB.map(toMatchLine));
  const sheetDiffers =
    sheetScore !== null &&
    ((sheetScore.teamA !== null && sheetScore.teamA !== score.scoreTeamA) ||
      (sheetScore.teamB !== null && sheetScore.teamB !== score.scoreTeamB));

  return (
    <section
      aria-live="polite"
      aria-label={`Red ${score.scoreTeamA}, blue ${score.scoreTeamB}`}
      className="sticky top-4 z-10 flex flex-col items-center gap-4 rounded-2xl bg-zinc-950 px-4 py-5 text-white shadow-lg sm:px-6"
    >
      <div className="flex items-center justify-center gap-3">
        <p className={`${scoreFigure} ${teamATone.onDark}`}>{score.scoreTeamA}</p>
        <p className={`${scoreFigure} text-white`} aria-hidden="true">
          :
        </p>
        <p className={`${scoreFigure} ${teamBTone.onDark}`}>{score.scoreTeamB}</p>
      </div>
      {sheetScore && (sheetScore.teamA !== null || sheetScore.teamB !== null) ? (
        <p className="text-center text-xs leading-5 text-zinc-300">
          Score box {sheetScore.teamA ?? "–"} : {sheetScore.teamB ?? "–"}
          {sheetDiffers
            ? ". Counted goals differ. Add own goals if the other side scored them."
            : ""}
        </p>
      ) : null}
      <LineupColumns
        onDark
        left={namedPlayers(teamA, players, rookies)}
        right={namedPlayers(teamB, players, rookies)}
      />
    </section>
  );
}

function SheetSideReadout({
  label,
  lines,
  score,
}: {
  label: string;
  lines: SheetPlayerLine[];
  score: number | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium text-zinc-950 dark:text-zinc-50">
        {label}
        {score !== null ? <span className="ml-2 tabular-nums text-zinc-500">{score}</span> : null}
      </p>
      {lines.length === 0 ? (
        <p className="text-zinc-500">No players read</p>
      ) : (
        <ul className="flex flex-col gap-1 text-zinc-700 dark:text-zinc-300">
          {lines.map((line) => {
            const penalties = penaltySummary(line.penalties);

            return (
              <li key={`${line.name}-${line.goals}-${penalties}`}>
                {line.name}
                <span className="text-zinc-500">
                  {" "}
                  · {line.goals} {line.goals === 1 ? "goal" : "goals"}
                  {penalties ? ` · ${penalties}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function canPreviewPhoto(file: File): boolean {
  const type = file.type.toLowerCase();

  return type.startsWith("image/") && !type.includes("heic") && !type.includes("heif");
}

function RefSheetReview({
  required,
  existingImageUrl,
  onParsed,
}: {
  required: boolean;
  existingImageUrl?: string | null;
  onParsed: (sheet: ParsedRefSheet) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState<ParsedRefSheet | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  async function selectFile(file: File | null, fromDrop: boolean) {
    if (fromDrop && inputRef.current) {
      const transfer = new DataTransfer();

      if (file) {
        transfer.items.add(file);
      }

      inputRef.current.files = transfer.files;
    }

    setFileName(file?.name ?? null);
    setPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return file && canPreviewPhoto(file) ? URL.createObjectURL(file) : null;
    });

    if (!file) {
      return;
    }

    const id = requestId.current + 1;
    requestId.current = id;
    setStatus("Reading the ref sheet…");
    setParsed(null);

    try {
      const body = new FormData();
      body.set("refSheet", file);
      const response = await fetch("/api/ref-sheets/parse", { method: "POST", body });
      const payload: unknown = await response.json();

      if (id !== requestId.current) {
        return;
      }

      if (
        !response.ok ||
        !payload ||
        typeof payload !== "object" ||
        !("teamA" in payload)
      ) {
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Could not read this ref sheet. Enter the game by hand.";
        setStatus(message);
        return;
      }

      const sheet = payload as ParsedRefSheet;
      setParsed(sheet);
      setStatus(null);
      onParsed(sheet);
    } catch {
      if (id !== requestId.current) {
        return;
      }

      setStatus("Could not read this ref sheet. Enter the game by hand.");
    }
  }

  const shownUrl = previewUrl ?? existingImageUrl ?? null;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50">
          Paper ref sheet
        </h2>
        <p id={`${inputId}-hint`} className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Upload a photo of the match card. Ref and assistant are read as one
          list. Match number, team names, and captain marks are skipped. Check
          the names, goals, penalties, and score box before you submit.
        </p>
        <a
          href="/ref-sheet-template.jpg"
          className="w-fit text-sm font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-50"
        >
          Blank template
        </a>
      </div>
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <label
            htmlFor={inputId}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void selectFile(event.dataTransfer.files[0] ?? null, true);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-4 py-8 text-center transition-colors ${
              dragging
                ? "border-zinc-950 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-900"
                : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              {fileName ?? (existingImageUrl ? "Replace the ref sheet photo" : "Upload the ref sheet")}
            </span>
            <span className="text-xs text-zinc-500">HEIC, PNG, JPG, WEBP, or GIF</span>
          </label>
          {shownUrl ? (
            // Local object URLs and stored sheet photos are chosen at runtime.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shownUrl}
              alt="Ref sheet photo"
              className="max-h-80 w-full rounded-lg object-contain"
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-3 rounded-xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
          <h3 className="text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50">
            Read from the sheet
          </h3>
          {status ? <p className="text-zinc-600 dark:text-zinc-300">{status}</p> : null}
          {parsed ? (
            <>
              <p className="text-zinc-700 dark:text-zinc-300">
                <span className="font-medium text-zinc-950 dark:text-zinc-50">Referees: </span>
                {parsed.referees.length > 0 ? parsed.referees.join(", ") : "None read"}
              </p>
              <SheetSideReadout label="Red" lines={parsed.teamA} score={parsed.scoreTeamA} />
              <SheetSideReadout label="Blue" lines={parsed.teamB} score={parsed.scoreTeamB} />
              {parsed.notes.map((note, index) => (
                <p key={`${index}-${note}`} className="text-xs leading-5 text-zinc-500">
                  {note}
                </p>
              ))}
            </>
          ) : status ? null : (
            <p className="text-zinc-500">
              The photo stays next to this readout so you can correct the form below.
            </p>
          )}
          <p className="text-xs leading-5 text-zinc-500">
            Skipped fields: {REF_SHEET_SKIPPED_FIELDS.join(", ")}.
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        name="refSheet"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
        required={required}
        className="sr-only"
        aria-describedby={`${inputId}-hint`}
        onChange={(event) => {
          void selectFile(event.target.files?.[0] ?? null, false);
        }}
      />
    </section>
  );
}

export function MatchEntryForm({
  players,
  defaultDate,
  initial,
  action = createGame,
  submitLabel = "Submit game",
  pendingLabel = "Submitting…",
  idleMessage = "This game stays pending until it is approved.",
  cancelHref,
  requireSubmitter = true,
  existingImageUrl,
  submittedBy,
  statusLabel,
}: MatchEntryFormProps) {
  const refereeId = useId();
  const dateId = useId();
  const submitterNameId = useId();
  const [state, formAction, pending] = useActionState(action, initialState);
  const [date, setDate] = useState(defaultDate);
  const [referee, setReferee] = useState(initial?.referee ?? "");
  const [teamA, setTeamA] = useState(() => lineRows("team-a", initial?.teamA));
  const [teamB, setTeamB] = useState(() => lineRows("team-b", initial?.teamB));
  const [rookies, setRookies] = useState<Record<string, boolean>>({});
  const [sheetScore, setSheetScore] = useState<{
    teamA: number | null;
    teamB: number | null;
  } | null>(null);
  const [submitterChoice, setSubmitterChoice] = useState("");
  const [guestName, setGuestName] = useState("");
  const [addSubmitter, setAddSubmitter] = useState(false);
  const [submitterRookie, setSubmitterRookie] = useState(false);
  const guestResolution =
    submitterChoice === "guest" && normalizeName(guestName)
      ? resolvePlayerName(guestName, players)
      : null;
  const guestIsNew = guestResolution?.kind === "none";

  function setRookie(name: string, checked: boolean) {
    const key = normalizeName(name);

    if (!key) {
      return;
    }

    setRookies((current) => ({ ...current, [key]: checked }));
  }

  function applySheet(sheet: ParsedRefSheet) {
    setReferee(sheet.referees.join(", "));
    setTeamA(rowsFromSheet("team-a", sheet.teamA));
    setTeamB(rowsFromSheet("team-b", sheet.teamB));
    setSheetScore({ teamA: sheet.scoreTeamA, teamB: sheet.scoreTeamB });
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Scoreboard
        teamA={teamA}
        teamB={teamB}
        players={players}
        rookies={rookies}
        sheetScore={sheetScore}
      />
      <RefSheetReview
        required={requireSubmitter}
        existingImageUrl={existingImageUrl}
        onParsed={applySheet}
      />
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <label
          htmlFor={dateId}
          className="text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50"
        >
          Match date
        </label>
        <input
          id={dateId}
          name="date"
          type="date"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className={`${textFieldClass} mt-3 max-w-xs`}
        />
      </section>
      {requireSubmitter ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50">
            Submitted by
          </h2>
          <label htmlFor="submitter-id" className="sr-only">
            Submitted by
          </label>
          <select
            id="submitter-id"
            name="submitterId"
            required
            value={submitterChoice}
            onChange={(event) => setSubmitterChoice(event.target.value)}
            className={`${textFieldClass} mt-3`}
          >
            <option value="">Choose a player</option>
            {players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
                {player.isRookie ? " (rookie)" : ""}
              </option>
            ))}
            <option value="guest">Other / Guest</option>
          </select>
          {submitterChoice === "guest" ? (
            <div className="mt-3 flex flex-col gap-3">
              <label htmlFor={submitterNameId} className="sr-only">
                Guest name
              </label>
              <input
                id={submitterNameId}
                name="submitterName"
                required
                value={guestName}
                placeholder="Name"
                autoComplete="name"
                onChange={(event) => setGuestName(event.target.value)}
                className={textFieldClass}
              />
              {guestIsNew ? (
                <div className="flex flex-col gap-2">
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    <input
                      type="checkbox"
                      name="addSubmitter"
                      checked={addSubmitter}
                      onChange={(event) => setAddSubmitter(event.target.checked)}
                      className="size-4 accent-zinc-950 dark:accent-zinc-50"
                    />
                    Add this player to the league immediately
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    <input
                      type="checkbox"
                      name="submitterRookie"
                      checked={submitterRookie}
                      disabled={!addSubmitter}
                      onChange={(event) => setSubmitterRookie(event.target.checked)}
                      className="size-4 accent-zinc-950 disabled:opacity-40 dark:accent-zinc-50"
                    />
                    Rookie
                  </label>
                  <p className="text-xs text-zinc-500">
                    The rookie flag is saved when this player is added.
                  </p>
                </div>
              ) : guestResolution?.kind === "ambiguous" ? (
                <p className="text-xs text-zinc-500">
                  Choose one of these players from the list.
                </p>
              ) : guestResolution ? (
                <p className="text-xs text-zinc-500">This name is already in the league.</p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : submittedBy || statusLabel ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50">
            Submission
          </h2>
          {submittedBy ? (
            <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
              Submitted by {submittedBy}
            </p>
          ) : null}
          {statusLabel ? (
            <p className="mt-1 text-sm text-zinc-500">Status: {statusLabel}</p>
          ) : null}
        </section>
      ) : null}
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-950 uppercase dark:text-zinc-50">
          Referees
        </h2>
        <div className="mt-3">
          <PlayerNameField
            id={refereeId}
            name="referees"
            label="Referees"
            value={referee}
            placeholder="Ref, assistant"
            players={players}
            onChange={setReferee}
          />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Ref and assistant, separated by a comma. Leave blank if the match had no referee.
        </p>
        {players.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500">
            No players in the league yet. New names are added when you save.
          </p>
        ) : null}
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <TeamLines
          sideLabel="Red"
          dotClass={teamATone.dot}
          namePrefix="teamA"
          lines={teamA}
          players={players}
          rookies={rookies}
          onChange={setTeamA}
          onRookieChange={setRookie}
        />
        <TeamLines
          sideLabel="Blue"
          dotClass={teamBTone.dot}
          namePrefix="teamB"
          lines={teamB}
          players={players}
          rookies={rookies}
          onChange={setTeamB}
          onRookieChange={setRookie}
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p
          role={state.error ? "alert" : undefined}
          className={
            state.error
              ? "text-sm text-rose-700 dark:text-rose-400"
              : "text-sm text-zinc-500"
          }
        >
          {state.error ?? idleMessage}
        </p>
        <div className="flex shrink-0 gap-2">
          {cancelHref ? (
            <Link
              href={cancelHref}
              className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              Cancel
            </Link>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {pending ? pendingLabel : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
