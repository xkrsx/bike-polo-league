/** Reading order on the printed 2x2 sheet: top-left, bottom-left, top-right, bottom-right. */
export const SHEET_REGIONS = [
  "top-left",
  "bottom-left",
  "top-right",
  "bottom-right",
] as const;

export type SheetRegion = (typeof SHEET_REGIONS)[number];

export interface SheetWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SheetQuadrant {
  region: SheetRegion;
  text: string;
}

const BIN_COUNT = 48;

function findGutter(centers: number[], start: number, end: number): number | null {
  const span = end - start;

  if (span <= 0 || centers.length < 8) {
    return null;
  }

  const counts = new Array<number>(BIN_COUNT).fill(0);

  for (const center of centers) {
    const ratio = (center - start) / span;
    const index = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor(ratio * BIN_COUNT)));
    counts[index] += 1;
  }

  const from = Math.floor(BIN_COUNT * 0.3);
  const to = Math.ceil(BIN_COUNT * 0.7);
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;

  for (let index = from; index < to; index += 1) {
    if (counts[index] === 0) {
      if (runStart < 0) {
        runStart = index;
      }

      const length = index - runStart + 1;

      if (length > bestLength) {
        bestLength = length;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
    }
  }

  if (bestLength < 2 || bestStart < 0) {
    return null;
  }

  const gutter = start + ((bestStart + bestLength / 2) / BIN_COUNT) * span;
  let before = 0;
  let after = 0;

  for (const center of centers) {
    if (center < gutter) {
      before += 1;
    } else {
      after += 1;
    }
  }

  if (before < 8 || after < 8) {
    return null;
  }

  return gutter;
}

function wordsToLines(words: SheetWord[]): string {
  if (words.length === 0) {
    return "";
  }

  const sorted = [...words].sort((left, right) => left.y0 - right.y0 || left.x0 - right.x0);
  const lines: SheetWord[][] = [];

  for (const word of sorted) {
    const current = lines[lines.length - 1];

    if (!current) {
      lines.push([word]);
      continue;
    }

    const anchor = current[0];
    const height = Math.max(8, anchor.y1 - anchor.y0, word.y1 - word.y0);

    if (word.y0 <= anchor.y0 + height * 0.6) {
      current.push(word);
    } else {
      lines.push([word]);
    }
  }

  return lines
    .map((line) =>
      line
        .sort((left, right) => left.x0 - right.x0)
        .map((word) => word.text.trim())
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean)
    .join("\n");
}

function looksLikeRef(text: string): boolean {
  return /^ref$/i.test(text.replace(/[^A-Za-z]/g, ""));
}

/**
 * A photographed ref sheet is four cards. Split on the empty gutters
 * when at least two quadrants still show a REF label. Quadrants come back
 * in reading order: top-left, bottom-left, top-right, bottom-right.
 * A tight photo of one card stays one block of text.
 */
export function splitRefSheetQuadrants(words: SheetWord[]): SheetQuadrant[] | null {
  const usable = words.filter((word) => /[A-Za-z0-9]/.test(word.text));

  if (usable.length < 16) {
    return null;
  }

  const minX = Math.min(...usable.map((word) => word.x0));
  const maxX = Math.max(...usable.map((word) => word.x1));
  const minY = Math.min(...usable.map((word) => word.y0));
  const maxY = Math.max(...usable.map((word) => word.y1));
  const gutterX = findGutter(
    usable.map((word) => (word.x0 + word.x1) / 2),
    minX,
    maxX,
  );
  const gutterY = findGutter(
    usable.map((word) => (word.y0 + word.y1) / 2),
    minY,
    maxY,
  );

  if (gutterX === null || gutterY === null) {
    return null;
  }

  const groups: Record<SheetRegion, SheetWord[]> = {
    "top-left": [],
    "top-right": [],
    "bottom-left": [],
    "bottom-right": [],
  };

  for (const word of usable) {
    const cx = (word.x0 + word.x1) / 2;
    const cy = (word.y0 + word.y1) / 2;
    const region: SheetRegion =
      cy < gutterY
        ? cx < gutterX
          ? "top-left"
          : "top-right"
        : cx < gutterX
          ? "bottom-left"
          : "bottom-right";
    groups[region].push(word);
  }

  const refCount = SHEET_REGIONS.filter((region) =>
    groups[region].some((word) => looksLikeRef(word.text)),
  ).length;

  if (refCount < 2) {
    return null;
  }

  return SHEET_REGIONS.map((region) => ({
    region,
    text: wordsToLines(groups[region]),
  }));
}
