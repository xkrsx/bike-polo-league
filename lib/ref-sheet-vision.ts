import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { RefSheetCrop } from "@/lib/ref-sheet-image";
import { normalizeName } from "@/lib/player-match";
import { SHEET_REGIONS, type SheetRegion } from "@/lib/ref-sheet-layout";
import {
  MAX_GOAL_CIRCLES,
  MAX_THIRTY_SECOND_MARKS,
  isFilledRefSheet,
  penaltyFoulCount,
  readableSheetName,
  type LocatedRefSheet,
  type ParsedRefSheet,
  type SheetPenalties,
  type SheetPlayerLine,
} from "@/lib/ref-sheet-ocr";

const VISION_MODEL = "claude-sonnet-5-5";
const PLAYERS_KEPT = 3;
const MAX_PENALTY_MARKS = 4;

export const VISION_SYSTEM_PROMPT = `You are an expert data extraction engine and assistant for Winter Bike Polo handwritten paper score sheets.

Your job is to extract game data with maximum precision while gracefully handling partially filled sheets and matching player names against the provided active player roster.

RULES:
1. HANDLE PARTIAL / EMPTY CARDS: 
   - The score sheet has a 2x2 grid (4 cards total). If some cards are blank (e.g., right-side column), do NOT fail or throw an error. Simply skip empty cards or return them with empty/null structures in the JSON array.
2. ALLOW MISSING FIELDS: 
   - If 'TEAM NAME' or 'REF' is blank on an active card, do NOT reject the sheet. Return null or "" for those specific missing strings.
3. PLAYER NAME MATCHING & ROSTER RESOLUTION:
   - Match and normalize every handwritten player name against the provided known player roster/dictionary.
   - If a handwritten name has minor spelling variations, typos, or shorthand (e.g., "Aleks", "Alex.", "Kuba"), correct it to match the exact canonical name from the known roster.
   - If a handwritten name is partial or matches multiple players (e.g., just "QUINN" when the roster contains both "Nova Quinn" and "Quinn Adler"), set name to null, or to one best-guess canonical name only when a single roster player is clearly more likely. When name is null, put the handwriting in written (for example "QUINN").
   - If the written name matches multiple full roster names (e.g. sharing a first or last name like Quinn), map them into the suggestions array using the FULL names from the roster, never repeating the raw ambiguous token alone. Do NOT return suggestions: ["QUINN"], even if a roster entry is exactly "Quinn" and the sheet already says "QUINN". Return the other full roster entries, for example suggestions: ["Nova Quinn", "Quinn Adler"], and leave name null.
   - If a name is completely clear and unique, set name to that exact canonical roster name, leave suggestions empty or omit it, and set matchedAs to the raw text read from the sheet. Example: the sheet says "MAYA" and the roster has "Maya Ortiz", so name is "Maya Ortiz", suggestions is [], and matchedAs is "MAYA".
   - If the name is ambiguous and split into suggestions, set name to null and matchedAs to null.
   - Every parsed player object includes name, suggestions, and matchedAs.
   - Do NOT invent or hallucinate new players who are not on the roster unless it's completely legible and undeniable.
4. EXTRACT LEGIBLE DATA:
   - For active cards, extract every clearly written player name, goal count (count filled/shaded circles in the 9-circle row), score (from the square box on the far right), and penalty mark.
5. STRICT NO-HALLUCINATION:
   - Exclude printed template text like 'SCORE', 'CAPT', 'MATCH NO.', 'PENALTIES', 'GOALS', 'REF', 'ASST'. Only accept actual human handwriting.
6. CROSSED-OUT MARKS:
   - Ignore any goal, penalty, or name that has been explicitly crossed out with an 'X' or scribbled over.
7. FALLBACK SAFETY:
   - Only throw an error like "Could not read this ref sheet" if the entire image is completely black, corrupted, unreadable, or not a match sheet at all.
8. JSON OUTPUT:
   - Always return a strictly valid JSON response matching our required schema for all 4 slots/games.`;

const suggestionSchema = z.array(z.string().nullish()).nullish();

const playerSchema = z.object({
  name: z.string().nullish(),
  written: z.string().nullish(),
  matchedAs: z.string().nullish(),
  suggestions: suggestionSchema,
  goals: z.number().nullish(),
  penalties: z.number().nullish(),
});

const refereeSchema = z.union([
  z.string(),
  z.object({
    name: z.string().nullish(),
    written: z.string().nullish(),
    matchedAs: z.string().nullish(),
    suggestions: suggestionSchema,
  }),
]);

const teamSchema = z.object({
  players: z.array(playerSchema).nullish(),
  score: z.number().nullish(),
});

const gameSchema = z.object({
  referees: z.array(refereeSchema.nullish()).nullish(),
  team1: teamSchema.nullish(),
  team2: teamSchema.nullish(),
});

const gamesSchema = z.object({
  games: z.array(gameSchema.nullable()),
});

const JSON_SHAPE = `{
  "games": [
    {
      "referees": [{ "name": "Anna Lee", "suggestions": [] }],
      "team1": {
        "players": [
          { "name": "Maya Ortiz", "suggestions": [], "matchedAs": "MAYA", "goals": 2, "penalties": 0 },
          { "name": null, "written": "QUINN", "suggestions": ["Nova Quinn", "Quinn Adler"], "matchedAs": null, "goals": 1, "penalties": 0 }
        ],
        "score": 2
      },
      "team2": {
        "players": [
          { "name": "Alex Example", "suggestions": [], "matchedAs": "ALEX", "goals": 0, "penalties": 0 }
        ],
        "score": 2
      }
    }
  ]
}`;

const REGION_LABEL: Record<SheetRegion, string> = {
  "top-left": "Top-Left",
  "bottom-left": "Bottom-Left",
  "top-right": "Top-Right",
  "bottom-right": "Bottom-Right",
};

type VisionContent = [
  { type: "text"; text: string },
  { type: "image"; image: Buffer; mediaType: "image/jpeg" },
];

export interface VisionRequestBody {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  system: string;
  messages: [{ role: "user"; content: VisionContent }];
}

export function visionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function rosterBlock(names: readonly string[]): string {
  const seen = new Set<string>();
  const roster: string[] = [];

  for (const name of names) {
    const cleaned = name.replace(/\s+/g, " ").trim();
    const key = normalizeName(cleaned);

    if (!cleaned || !key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    roster.push(cleaned);
  }

  roster.sort((left, right) => left.localeCompare(right));

  if (roster.length === 0) {
    return "Active player roster: none provided. Extract a completely legible handwritten name as written. Do not invent players.";
  }

  return `Active player roster. Correct minor spelling variations, typos, and shorthand to these exact canonical names. If a written name is partial or matches a first or last name shared by more than one player, suggestions must be the FULL roster names that contain that text. Never return the raw token alone, such as suggestions: ["QUINN"]:\n${roster.join("\n")}`;
}

function visionBody(
  jpeg: Buffer,
  model: string,
  instruction: string,
  maxOutputTokens: number,
  roster: readonly string[] = [],
): VisionRequestBody {
  return {
    model,
    temperature: 0,
    maxOutputTokens,
    system: VISION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `${instruction}\n${rosterBlock(roster)}` },
          { type: "image", image: jpeg, mediaType: "image/jpeg" },
        ],
      },
    ],
  };
}

export function buildVisionRequest(
  jpeg: Buffer,
  model = VISION_MODEL,
  roster: readonly string[] = [],
): VisionRequestBody {
  return visionBody(
    jpeg,
    model,
    `Use this schema. Return exactly 4 games in this order: Top-Left, Bottom-Left, Top-Right, Bottom-Right. Keep a blank card in its slot with empty players, empty referees, and null scores. A missing TEAM NAME or REF is null. An empty SCORE box is null.\n${JSON_SHAPE}`,
    2500,
    roster,
  );
}

function buildCardVisionRequest(
  jpeg: Buffer,
  region: SheetRegion,
  model: string,
  roster: readonly string[] = [],
): VisionRequestBody {
  return visionBody(
    jpeg,
    model,
    `This image is the ${REGION_LABEL[region]} card only. Return exactly one game with this schema. If the card is blank, return one game with empty players, empty referees, and null scores. A missing TEAM NAME or REF is null. An empty SCORE box is null.\n${JSON_SHAPE}`,
    1200,
    roster,
  );
}

function clampInt(value: unknown, max: number): number {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value.trim())
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.min(max, Math.max(0, Math.round(number)));
}

function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function refereeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const name = readableSheetName(value);

  if (!name || /^\d+$/.test(name)) {
    return null;
  }

  return name;
}

function playerName(value: unknown): string | null {
  return typeof value === "string" ? readableSheetName(value) : null;
}

function suggestionList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const names: string[] = [];

  for (const entry of value) {
    const name = playerName(entry);

    if (!name || names.some((existing) => normalizeName(existing) === normalizeName(name))) {
      continue;
    }

    names.push(name);

    if (names.length === 4) {
      break;
    }
  }

  return names;
}

interface NamedReading {
  name: string;
  suggestions: string[];
}

function namedReading(value: unknown): NamedReading | null {
  if (typeof value === "string" || value === null || value === undefined) {
    const name = refereeName(value);

    return name ? { name, suggestions: [] } : null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  const suggestions = suggestionList(row.suggestions);
  const name =
    refereeName(row.written) ??
    refereeName(row.matchedAs) ??
    refereeName(row.name) ??
    suggestions[0];

  if (!name) {
    return null;
  }

  return { name, suggestions };
}

function scoreValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d{1,2}$/.test(value.trim())
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(number) || number < 0 || number > 30) {
    return null;
  }

  return number;
}

function readPenalties(row: Record<string, unknown>): {
  penalties: SheetPenalties;
  fouls: number;
} {
  const summed =
    typeof row.penalties === "number" ||
    (typeof row.penalties === "string" && /^\d+$/.test(row.penalties.trim()));

  if (summed) {
    return {
      penalties: { thirtySeconds: 0, oneMinute: false, expulsion: false },
      fouls: clampInt(row.penalties, MAX_PENALTY_MARKS),
    };
  }

  const nested =
    row.penalties && typeof row.penalties === "object"
      ? (row.penalties as Record<string, unknown>)
      : row;
  const penalties: SheetPenalties = {
    thirtySeconds: clampInt(nested.thirtySeconds, MAX_THIRTY_SECOND_MARKS),
    oneMinute: asBool(nested.oneMinute),
    expulsion: asBool(nested.expulsion),
  };

  return { penalties, fouls: penaltyFoulCount(penalties) };
}

function playerLine(value: unknown): SheetPlayerLine | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  const suggestions = suggestionList(row.suggestions);
  const name =
    playerName(row.written) ??
    playerName(row.matchedAs) ??
    playerName(row.name) ??
    suggestions[0];

  if (!name) {
    return null;
  }

  const penalties = readPenalties(row);

  return {
    name,
    suggestions,
    goals: clampInt(row.goals, MAX_GOAL_CIRCLES),
    penalties: penalties.penalties,
    fouls: penalties.fouls,
  };
}

function uniquePeople(value: unknown): NamedReading[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const people: NamedReading[] = [];

  for (const entry of value) {
    const person = namedReading(entry);

    if (!person || people.some((existing) => normalizeName(existing.name) === normalizeName(person.name))) {
      continue;
    }

    people.push(person);

    if (people.length === 2) {
      break;
    }
  }

  return people;
}

function teamLines(value: unknown): SheetPlayerLine[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const lines: SheetPlayerLine[] = [];

  for (const row of value) {
    const line = playerLine(row);

    if (!line || lines.length >= PLAYERS_KEPT) {
      continue;
    }

    lines.push(line);
  }

  return lines;
}

function readTeam(value: unknown): { players: unknown; score: unknown } {
  if (Array.isArray(value)) {
    return { players: value, score: undefined };
  }

  if (value && typeof value === "object") {
    const team = value as Record<string, unknown>;

    return { players: team.players, score: team.score };
  }

  return { players: undefined, score: undefined };
}

function asRegion(value: unknown): SheetRegion | "full" | null {
  if (typeof value !== "string") {
    return null;
  }

  const region = value.trim().toLowerCase();

  if (region === "full" || (SHEET_REGIONS as readonly string[]).includes(region)) {
    return region as SheetRegion | "full";
  }

  return null;
}

function regionRank(region: SheetRegion | "full"): number {
  if (region === "full") {
    return SHEET_REGIONS.length;
  }

  const index = SHEET_REGIONS.indexOf(region);

  return index < 0 ? SHEET_REGIONS.length : index;
}

function extractCards(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") {
    throw new Error("Vision response did not include games.");
  }

  const record = payload as Record<string, unknown>;
  const cards = record.games ?? record.cards;

  if (!Array.isArray(cards)) {
    throw new Error("Vision response did not include games.");
  }

  return cards;
}

export function normalizeVisionCards(
  payload: unknown,
  forcedRegion?: SheetRegion,
): LocatedRefSheet[] {
  const cards = extractCards(payload);
  const located: LocatedRefSheet[] = [];
  const seen = new Set<string>();

  for (const [index, card] of cards.entries()) {
    if (forcedRegion && located.length > 0) {
      break;
    }

    if (!card || typeof card !== "object") {
      continue;
    }

    const row = card as Record<string, unknown>;
    const region =
      forcedRegion ??
      asRegion(row.region) ??
      (cards.length === 1 ? "full" : (SHEET_REGIONS[index] ?? "full"));

    if (region !== "full" && seen.has(region)) {
      continue;
    }

    const teamA = readTeam(row.team1 ?? row.teamA);
    const teamB = readTeam(row.team2 ?? row.teamB);
    const referees = uniquePeople(row.referees);
    const sheet: ParsedRefSheet = {
      referees: referees.map((person) => person.name),
      refereeSuggestions: referees.map((person) => person.suggestions),
      teamA: teamLines(teamA.players),
      teamB: teamLines(teamB.players),
      scoreTeamA: scoreValue(row.scoreTeamA !== undefined ? row.scoreTeamA : teamA.score),
      scoreTeamB: scoreValue(row.scoreTeamB !== undefined ? row.scoreTeamB : teamB.score),
      skipped: ["match number", "team names", "captain marks"],
      notes: [],
    };

    if (!isFilledRefSheet(sheet)) {
      continue;
    }

    if (region !== "full") {
      seen.add(region);
    }

    located.push({ region, sheet });
  }

  if (!forcedRegion) {
    located.sort((left, right) => regionRank(left.region) - regionRank(right.region));
  }

  return located;
}

export function parseVisionPayload(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    }

    throw new Error("Vision response was not JSON.");
  }
}

function anthropicModel(model: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }

  return createAnthropic({ apiKey })(model);
}

async function postVision(body: VisionRequestBody, timeoutMs: number): Promise<unknown> {
  const result = await generateText({
    model: anthropicModel(body.model),
    system: body.system,
    temperature: body.temperature,
    maxOutputTokens: body.maxOutputTokens,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(timeoutMs),
    messages: body.messages,
    output: Output.object({
      schema: gamesSchema,
      name: "ref_sheet_games",
      description:
        "Four winter bike polo match-card slots. Each player has name and suggestions. Blank cards, missing TEAM NAME or REF fields, and ambiguous names are null or empty. Empty SCORE boxes are null.",
    }),
  });

  return result.output;
}

async function readCroppedCards(
  crops: RefSheetCrop[],
  model: string,
  roster: readonly string[],
): Promise<{ ok: boolean; cards: LocatedRefSheet[] }> {
  const reads = await Promise.all(
    crops.map(async (crop) => {
      try {
        const payload = await postVision(
          buildCardVisionRequest(crop.jpeg, crop.region, model, roster),
          30_000,
        );

        return { ok: true as const, card: normalizeVisionCards(payload, crop.region)[0] ?? null };
      } catch (error) {
        console.error(error);

        return { ok: false as const, card: null };
      }
    }),
  );

  if (!reads.some((read) => read.ok)) {
    return { ok: false, cards: [] };
  }

  return {
    ok: true,
    cards: reads.flatMap((read) => (read.card ? [read.card] : [])),
  };
}

export async function readRefSheetWithVision(
  jpeg: Buffer,
  roster: readonly string[] = [],
): Promise<LocatedRefSheet[]> {
  const model = VISION_MODEL;
  const { cropRefSheetQuadrants } = await import("@/lib/ref-sheet-image");
  const crops = await cropRefSheetQuadrants(jpeg).catch((error: unknown) => {
    console.error(error);

    return null;
  });

  if (crops && crops.length === 4) {
    const cropped = await readCroppedCards(crops, model, roster);

    if (cropped.ok) {
      return cropped.cards;
    }
  }

  const payload = await postVision(buildVisionRequest(jpeg, model, roster), 45_000);

  return normalizeVisionCards(payload);
}
