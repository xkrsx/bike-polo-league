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

export const VISION_IMAGE_DETAIL = "high" as const;

const VISION_MODEL = "gpt-4o";
const PLAYERS_KEPT = 3;
const MAX_PENALTY_MARKS = 4;

export const VISION_SYSTEM_PROMPT = `You are an expert data extraction engine for Winter Bike Polo handwritten paper score sheets. 

To prevent reading template headers as player names, follow this strict parsing methodology for every card:

1. **TEAM SCORE**: Look only at the square box on the far right labeled 'SCORE'. Read the single handwritten digit inside it (e.g., '2'). Never calculate scores from goals.
2. **PLAYERS (CRITICAL)**: 
   - Each card has rows for players. 
   - The first column is 'CAPT' (checkboxes). 
   - The second column is 'NAME/NUMBER' where human handwriting is located.
   - **EXCLUDE ALL PRINTED TEXT**: Ignore any words like 'TEAM NAME:', 'PENALTIES', 'GOALS', 'MATCH NO.', 'CAPT', 'SCORE', '30s', '1m', 'EXP'. If an extracted name matches any of these static strings, discard it immediately. Only accept actual human names (e.g., 'ALEX', 'HAYA', 'NOVA', 'KUBAS').
3. **GOALS**: Count the filled/shaded circles in the 9-circle row for that player.
4. **PENALTIES**: Count filled square boxes and checked 30s/1m/EXP marks, returning a single total integer.

Example of a valid player row:
Handwritten text under NAME/NUMBER: 'ALEX' -> Keep.
Printed text under NAME/NUMBER: 'TEAM NAME:' -> Discard/Ignore.

Return strictly valid JSON matching the required schema inside \`response_format: { type: "json_object" }\`.`;

const JSON_SHAPE = `{
  "games": [
    {
      "referees": ["Name1", "Name2"],
      "team1": {
        "players": [
          { "name": "ALEX", "goals": 0, "penalties": 0 }
        ],
        "score": 2
      },
      "team2": {
        "players": [
          { "name": "HAYA", "goals": 0, "penalties": 0 }
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
  {
    type: "image_url";
    image_url: { url: string; detail: typeof VISION_IMAGE_DETAIL };
  },
];

export interface VisionRequestBody {
  model: string;
  temperature: number;
  max_tokens: number;
  response_format: { type: "json_object" };
  messages: [{ role: "system"; content: string }, { role: "user"; content: VisionContent }];
}

export function visionConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function visionBody(
  jpeg: Buffer,
  model: string,
  system: string,
  instruction: string,
  maxTokens: number,
): VisionRequestBody {
  return {
    model,
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: instruction },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
              detail: VISION_IMAGE_DETAIL,
            },
          },
        ],
      },
    ],
  };
}

export function buildVisionRequest(jpeg: Buffer, model = VISION_MODEL): VisionRequestBody {
  return visionBody(
    jpeg,
    model,
    VISION_SYSTEM_PROMPT,
    `Use this schema. Scan filled cards Top-Left, Bottom-Left, Top-Right, Bottom-Right. Ignore blank cards. An empty SCORE box is null.\n${JSON_SHAPE}`,
    2500,
  );
}

function buildCardVisionRequest(
  jpeg: Buffer,
  region: SheetRegion,
  model: string,
): VisionRequestBody {
  return visionBody(
    jpeg,
    model,
    VISION_SYSTEM_PROMPT,
    `This image is the ${REGION_LABEL[region]} card only. Return at most one game with this schema. If the card is blank, return {"games":[]}. An empty SCORE box is null.\n${JSON_SHAPE}`,
    1200,
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
  const name = playerName(row.name);

  if (!name) {
    return null;
  }

  const penalties = readPenalties(row);

  return {
    name,
    goals: clampInt(row.goals, MAX_GOAL_CIRCLES),
    penalties: penalties.penalties,
    fouls: penalties.fouls,
  };
}

function uniqueNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const names: string[] = [];

  for (const entry of value) {
    const name = refereeName(entry);

    if (!name || names.some((existing) => normalizeName(existing) === normalizeName(name))) {
      continue;
    }

    names.push(name);

    if (names.length === 2) {
      break;
    }
  }

  return names;
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
    const sheet: ParsedRefSheet = {
      referees: uniqueNames(row.referees),
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

function visionMessageContent(body: unknown): string {
  if (!body || typeof body !== "object" || !("choices" in body)) {
    throw new Error("Vision response was empty.");
  }

  const choices = (body as { choices?: unknown }).choices;
  const first = Array.isArray(choices) ? choices[0] : null;
  const content =
    first && typeof first === "object" && first !== null && "message" in first
      ? (first as { message?: { content?: unknown } }).message?.content
      : null;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Vision response was empty.");
  }

  return content;
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

async function postVision(body: VisionRequestBody, timeoutMs: number): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Vision request failed (${response.status}).`);
  }

  return parseVisionPayload(visionMessageContent(await response.json()));
}

async function readCroppedCards(
  crops: RefSheetCrop[],
  model: string,
): Promise<{ ok: boolean; cards: LocatedRefSheet[] }> {
  const reads = await Promise.all(
    crops.map(async (crop) => {
      try {
        const payload = await postVision(buildCardVisionRequest(crop.jpeg, crop.region, model), 30_000);

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

export async function readRefSheetWithVision(jpeg: Buffer): Promise<LocatedRefSheet[]> {
  const model = process.env.OPENAI_VISION_MODEL?.trim() || VISION_MODEL;
  const { cropRefSheetQuadrants } = await import("@/lib/ref-sheet-image");
  const crops = await cropRefSheetQuadrants(jpeg).catch((error: unknown) => {
    console.error(error);

    return null;
  });

  if (crops && crops.length === 4) {
    const cropped = await readCroppedCards(crops, model);

    if (cropped.ok) {
      return cropped.cards;
    }
  }

  const payload = await postVision(buildVisionRequest(jpeg, model), 45_000);

  return normalizeVisionCards(payload);
}
