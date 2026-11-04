import { cleanDisplayName, normalizeName } from "@/lib/player-match";
import {
  splitRefSheetQuadrants,
  type SheetRegion,
  type SheetWord,
} from "@/lib/ref-sheet-layout";

/**
 * Reading rules for the paper ref sheet (`public/ref-sheet-template.jpg`).
 * The page is a 2x2 grid of match cards, read top-left, bottom-left,
 * top-right, then bottom-right. Each card has REF and ASST across the top.
 * Match number, team names, and captain marks are not results. Goals are the
 * filled circles in the 9 GOALS circles. Penalties are the filled boxes for
 * 30s, 30s, 1min, and EXP. Score is the integer in the box under SCORE.
 * A side has up to four rows; the league keeps three players per side.
 * Only cards with a name, a referee, or a score are kept.
 */

export const REF_SHEET_SKIPPED_FIELDS = [
  "match number",
  "team names",
  "captain marks",
] as const;

export interface SheetPenalties {
  thirtySeconds: number;
  oneMinute: boolean;
  expulsion: boolean;
}

export interface SheetPlayerLine {
  name: string;
  goals: number;
  penalties: SheetPenalties;
  fouls: number;
}

export interface ParsedRefSheet {
  referees: string[];
  teamA: SheetPlayerLine[];
  teamB: SheetPlayerLine[];
  scoreTeamA: number | null;
  scoreTeamB: number | null;
  skipped: string[];
  notes: string[];
}

const PLAYERS_KEPT = 3;
export const MAX_GOAL_CIRCLES = 9;
export const MAX_THIRTY_SECOND_MARKS = 2;
const EMPTY_PENALTIES: SheetPenalties = {
  thirtySeconds: 0,
  oneMinute: false,
  expulsion: false,
};

const LABEL_WORDS = new Set([
  "capt",
  "captain",
  "name",
  "number",
  "name/number",
  "goals",
  "goal",
  "penalties",
  "penalty",
  "score",
]);

const EMPTY_BOX = /[□☐]/;
const CIRCLE_RUN = /[●•⬤■☑✓✔*xX✕✖✗✘⊗○◯oO□☐0]{3,}/g;
const PENALTY_TOKEN = String.raw`(?:30\s*s|1\s*m(?:in(?:ute)?)?|exp(?:ulsion)?)`;

export function penaltyFoulCount(penalties: SheetPenalties): number {
  return (
    penalties.thirtySeconds +
    (penalties.oneMinute ? 1 : 0) +
    (penalties.expulsion ? 1 : 0)
  );
}

export function penaltySummary(penalties: SheetPenalties): string {
  const parts: string[] = [];

  if (penalties.thirtySeconds === 1) {
    parts.push("30s");
  } else if (penalties.thirtySeconds >= 2) {
    parts.push("30s × 2");
  }

  if (penalties.oneMinute) {
    parts.push("1m");
  }

  if (penalties.expulsion) {
    parts.push("EXP");
  }

  return parts.join(", ");
}

export function isFilledRefSheet(sheet: ParsedRefSheet): boolean {
  return (
    sheet.referees.length > 0 ||
    sheet.teamA.length > 0 ||
    sheet.teamB.length > 0 ||
    sheet.scoreTeamA !== null ||
    sheet.scoreTeamB !== null
  );
}

interface CardDraft {
  referees: string[];
  teams: TeamBucket[];
  current: TeamBucket | null;
  skipped: Set<string>;
  notes: string[];
}

function createDraft(): CardDraft {
  return {
    referees: [],
    teams: [],
    current: null,
    skipped: new Set<string>(),
    notes: [],
  };
}

function draftHasContent(draft: CardDraft): boolean {
  return (
    draft.referees.length > 0 ||
    draft.teams.some((team) => team.players.length > 0 || team.score !== null)
  );
}

function ensureTeam(draft: CardDraft): TeamBucket {
  if (!draft.current) {
    draft.current = { players: [], score: null };
    draft.teams.push(draft.current);
  }

  return draft.current;
}

function draftToSheet(draft: CardDraft): ParsedRefSheet {
  return {
    referees: draft.referees,
    teamA: draft.teams[0]?.players ?? [],
    teamB: draft.teams[1]?.players ?? [],
    scoreTeamA: draft.teams[0]?.score ?? null,
    scoreTeamB: draft.teams[1]?.score ?? null,
    skipped: [...draft.skipped],
    notes: draft.notes,
  };
}

export function parseRefSheetCards(text: string): ParsedRefSheet[] {
  const cards: ParsedRefSheet[] = [];
  let draft = createDraft();

  const flush = () => {
    const sheet = draftToSheet(draft);

    if (isFilledRefSheet(sheet)) {
      cards.push(sheet);
    }

    draft = createDraft();
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();

    if (!line || /^[._·…\-–—\s]+$/.test(line)) {
      continue;
    }

    const header = parseOfficialLine(line);

    if (header) {
      if (header.startsNewMatch && draftHasContent(draft)) {
        flush();
      }

      if (header.sawMatchNumber) {
        draft.skipped.add("match number");
      }

      for (const name of header.referees) {
        pushUnique(draft.referees, name);
      }

      continue;
    }

    if (isTeamNameLine(line)) {
      draft.skipped.add("team names");

      if (draft.current && (draft.current.players.length > 0 || draft.current.score !== null)) {
        if (draft.teams.length >= 2) {
          flush();
          draft.skipped.add("team names");
        }

        draft.current = { players: [], score: null };
        draft.teams.push(draft.current);
      } else {
        ensureTeam(draft);
      }

      continue;
    }

    if (isCaptainLine(line)) {
      draft.skipped.add("captain marks");
      continue;
    }

    const labeledScore = parseLabeledScore(line);

    if (labeledScore !== null) {
      ensureTeam(draft).score = labeledScore;
      continue;
    }

    const boxedScore = parseBoxedScore(line);

    if (boxedScore !== null && draft.current && draft.current.score === null) {
      draft.current.score = boxedScore;
      continue;
    }

    if (/^\s*(?:CAPT|CAPTAIN)\b/i.test(line)) {
      draft.skipped.add("captain marks");
    }

    if (isLabelLine(line)) {
      continue;
    }

    const score = parseScoreLine(line);

    if (
      score !== null &&
      draft.current &&
      draft.current.players.length >= PLAYERS_KEPT &&
      draft.current.score === null
    ) {
      draft.current.score = score;
      continue;
    }

    const player = parsePlayerLine(line);

    if (!player) {
      continue;
    }

    const team = ensureTeam(draft);

    if (team.players.length >= PLAYERS_KEPT) {
      continue;
    }

    team.players.push(player);
  }

  flush();

  return cards;
}

export function parseRefSheetOcr(text: string): ParsedRefSheet {
  return collapseLocatedSheets(
    parseRefSheetCards(text).map((sheet) => ({
      region: "full" as const,
      sheet,
    })),
  );
}

export function collapseLocatedSheets(located: LocatedRefSheet[]): ParsedRefSheet {
  const [first, ...rest] = located;

  if (!first) {
    return {
      referees: [],
      teamA: [],
      teamB: [],
      scoreTeamA: null,
      scoreTeamB: null,
      skipped: [],
      notes: ["No names or scores were read. Check the photo and enter the sheet by hand."],
    };
  }

  if (rest.length === 0) {
    return first.sheet;
  }

  const extra = rest.length === 1 ? "1 more filled match" : `${rest.length} more filled matches`;

  return {
    ...first.sheet,
    notes: [
      ...first.sheet.notes,
      `${extra} on this photo. Use Submit games to review every card.`,
    ],
  };
}

export interface LocatedRefSheet {
  region: SheetRegion | "full";
  sheet: ParsedRefSheet;
}

export function extractFilledSheets(text: string, words: SheetWord[]): LocatedRefSheet[] {
  const quadrants = splitRefSheetQuadrants(words);

  if (quadrants) {
    const located = quadrants.flatMap((quadrant) =>
      parseRefSheetCards(quadrant.text).map((sheet) => ({
        region: quadrant.region,
        sheet,
      })),
    );

    if (located.length > 0) {
      return located;
    }
  }

  return parseRefSheetCards(text).map((sheet) => ({
    region: "full" as const,
    sheet,
  }));
}

interface TeamBucket {
  players: SheetPlayerLine[];
  score: number | null;
}

interface OfficialLine {
  referees: string[];
  sawMatchNumber: boolean;
  startsNewMatch: boolean;
}

function pushUnique(names: string[], name: string): void {
  const key = normalizeName(name);

  if (!key || names.some((existing) => normalizeName(existing) === key)) {
    return;
  }

  names.push(name);
}

function tidy(value: string): string {
  return cleanDisplayName(
    value
      .replace(/[._·…]{2,}/g, " ")
      .replace(/^[:.\-\s]+|[:.\-\s]+$/g, ""),
  );
}

function parseOfficialLine(line: string): OfficialLine | null {
  if (!/^\s*(?:REF|ASST|ASSISTANT|MATCH)\b/i.test(line)) {
    return null;
  }

  const sawMatchNumber = /\bMATCH\b/i.test(line);
  const withoutMatch = line.replace(
    /\bMATCH\s*(?:NO\.?|NUMBER|#)\s*[:.]?\s*([A-Za-z0-9-]+)?/i,
    " ",
  );
  const referees: string[] = [];
  const refMatch = withoutMatch.match(
    /\bREF\s*[:.]?\s*(.*?)(?=\b(?:ASST|ASSISTANT)\b|$)/i,
  );
  const assistantMatch = withoutMatch.match(
    /\b(?:ASST|ASSISTANT)\s*[:.]?\s*(.*)$/i,
  );

  if (refMatch) {
    const name = tidy(refMatch[1] ?? "");

    if (isPlausiblePlayerName(name)) {
      referees.push(name);
    }
  }

  if (assistantMatch) {
    const name = tidy(assistantMatch[1] ?? "");

    if (isPlausiblePlayerName(name)) {
      referees.push(name);
    }
  }

  return {
    referees,
    sawMatchNumber,
    startsNewMatch: /^\s*REF\b/i.test(line),
  };
}

function isTeamNameLine(line: string): boolean {
  return /^\s*TEAM\s*NAME\b/i.test(line);
}

function isCaptainLine(line: string): boolean {
  return /^\s*(?:CAPT|CAPTAIN)\b[:.]?\s*$/i.test(line);
}

function isLabelLine(line: string): boolean {
  const normalized = line
    .toLowerCase()
    .replace(/[^a-z/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return false;
  }

  return normalized.split(" ").every((token) => LABEL_WORDS.has(token));
}

function parseLabeledScore(line: string): number | null {
  const match = line.match(/^\s*SCORE\b\s*[:.]?\s*[\[\(\{]?\s*(\d{1,2})\s*[\]\)\}]?\s*$/i);

  if (!match) {
    return null;
  }

  const value = Number(match[1]);

  return value <= 30 ? value : null;
}

function parseBoxedScore(line: string): number | null {
  const match = /^\s*[\[\(\{]\s*(\d{1,2})\s*[\]\)\}]\s*$/.exec(line);

  if (!match) {
    return null;
  }

  const value = Number(match[1]);

  return value <= 30 ? value : null;
}

function parseScoreLine(line: string): number | null {
  const match = /^\s*[|\[\(\{]?\s*(\d{1,2})\s*[|\]\)\}]?\s*$/.exec(line);

  if (!match) {
    return null;
  }

  const value = Number(match[1]);

  return value <= 30 ? value : null;
}

const LABEL_TOKEN =
  /^(?:capt|captain|name|number|no|goals?|penalt(?:y|ies)|score|ref|asst|assistant|match|team|exp|min|minute|30s|1m)$/i;

const PRINTED_COMPACT =
  /^(?:teamname|namenumber|matchno|matchnumber|penalties|penalty|goals|goal|score|capt|captain|ref|asst|assistant|exp|30s|1m|1min)$/;

function isShortFragment(tokens: string[]): boolean {
  const cores = tokens.map((token) => token.replace(/[^A-Za-z0-9]/g, ""));

  if (cores.some((token) => token.length > 2) || tokens.length < 2) {
    return false;
  }

  if (tokens.length >= 3) {
    return true;
  }

  const allCaps = tokens.every((token) => token === token.toUpperCase());
  const hasLowercaseWord = tokens.some(
    (token) => /[a-z]/.test(token) && token === token.toLowerCase(),
  );

  return allCaps || hasLowercaseWord;
}

/**
 * Handwritten NAME/NUMBER text. Printed headers and split fragments
 * ("le Se", "CU RS CA") are not player names.
 */
export function readableSheetName(value: string): string | null {
  const name = cleanDisplayName(value).replace(/^[:.\-\s]+|[:.\-\s]+$/g, "");

  return isPlausiblePlayerName(name) ? name : null;
}

export function isPlausiblePlayerName(name: string): boolean {
  const cleaned = cleanDisplayName(name).replace(/^[:.\-\s]+|[:.\-\s]+$/g, "");

  if (!cleaned || cleaned.length > 40) {
    return false;
  }

  if (/\b(?:was left off|each side uses|commentary)\b/i.test(cleaned)) {
    return false;
  }

  if (/\b\d+\s*s\b/i.test(cleaned) || /^1\s*m(?:in(?:ute)?)?$/i.test(cleaned)) {
    return false;
  }

  if (PRINTED_COMPACT.test(cleaned.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
    return false;
  }

  const tokens = cleaned.split(/[\s/]+/).filter(Boolean);

  if (tokens.length === 0 || tokens.length > 4) {
    return false;
  }

  if (tokens.every((token) => LABEL_TOKEN.test(token))) {
    return false;
  }

  if (isShortFragment(tokens)) {
    return false;
  }

  return tokens.every(
    (token) => /^[A-Za-z][A-Za-z.'-]*$/.test(token) || /^\d{1,4}$/.test(token),
  );
}

function parsePlayerLine(line: string): SheetPlayerLine | null {
  let working = line
    .replace(/^\s*(?:CAPT|CAPTAIN)\b[:.]?\s*/i, "")
    .replace(/^[☐☑✓✔□■●○◯⬤*\s]+/, "");

  const circles = takeCircles(working);
  working = circles.rest;
  const penalties = takePenalties(working);
  working = tidy(penalties.rest);

  if (!working || isLabelLine(working) || isTeamNameLine(working)) {
    return null;
  }

  let goals = circles.filled;
  const tail = working.match(/^(.*\S)\s+(\d{1,2})$/);

  if (tail && circles.filled === 0) {
    const value = Number(tail[2]);

    if (value <= 10) {
      working = tidy(tail[1] ?? "");
      goals = value;
    }
  }

  if (!working || (!normalizeName(working) && !/^\d{1,4}$/.test(working))) {
    return null;
  }

  if (!isPlausiblePlayerName(working)) {
    return null;
  }

  return {
    name: working,
    goals,
    penalties: penalties.penalties,
    fouls: penaltyFoulCount(penalties.penalties),
  };
}

function penaltyIsChecked(mark: string | undefined): boolean {
  if (!mark) {
    return true;
  }

  const compact = mark.replace(/\s+/g, "");

  if (/^\[[\s_.-]*\]$/.test(compact) || EMPTY_BOX.test(compact)) {
    return false;
  }

  return true;
}

function isFilledBox(mark: string): boolean {
  return !EMPTY_BOX.test(mark);
}

function addPenalty(penalties: SheetPenalties, token: string): void {
  if (/30/i.test(token)) {
    if (penalties.thirtySeconds < MAX_THIRTY_SECOND_MARKS) {
      penalties.thirtySeconds += 1;
    }

    return;
  }

  if (/^1/i.test(token.trim())) {
    penalties.oneMinute = true;
    return;
  }

  penalties.expulsion = true;
}

function takePenalties(line: string): { penalties: SheetPenalties; rest: string } {
  const penalties: SheetPenalties = { ...EMPTY_PENALTIES };
  const pattern = new RegExp(
    String.raw`(\[[^\]]{0,4}\]|[☑✓✔☒■□☐xX])?\s*\b(${PENALTY_TOKEN})\b`,
    "gi",
  );
  let labeled = 0;
  let rest = line.replace(pattern, (_full, mark: string | undefined, token: string) => {
    labeled += 1;

    if (penaltyIsChecked(mark)) {
      addPenalty(penalties, token);
    }

    return " ";
  });

  if (labeled === 0) {
    const boxes = rest.match(/[☑✓✔☒■□☐]/g) ?? [];

    if (boxes.length === 4) {
      if (isFilledBox(boxes[0] ?? "")) {
        penalties.thirtySeconds += 1;
      }

      if (isFilledBox(boxes[1] ?? "")) {
        penalties.thirtySeconds += 1;
      }

      penalties.oneMinute = isFilledBox(boxes[2] ?? "");
      penalties.expulsion = isFilledBox(boxes[3] ?? "");
      rest = rest.replace(/[☑✓✔☒■□☐]/g, " ");
    }
  }

  return { penalties, rest };
}

const GOAL_CIRCLE = /[●•⬤○◯oO0*xX]/;
const FILLED_GOAL = /[●•⬤*xX]/;

function takeCircles(line: string): { filled: number; rest: string } {
  let filled = 0;
  let seen = 0;
  const rest = line.replace(CIRCLE_RUN, (run) => {
    let kept = "";

    for (const mark of run) {
      if (!GOAL_CIRCLE.test(mark)) {
        kept += mark;
        continue;
      }

      if (seen >= MAX_GOAL_CIRCLES) {
        continue;
      }

      seen += 1;

      if (FILLED_GOAL.test(mark)) {
        filled += 1;
      }
    }

    return kept ? ` ${kept} ` : " ";
  });

  return { filled, rest };
}
