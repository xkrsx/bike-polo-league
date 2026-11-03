export interface PlayerCandidate {
  id: string;
  name: string;
  isRookie?: boolean;
}

export type PlayerResolution =
  | { kind: "exact"; player: PlayerCandidate }
  | {
      kind: "similar";
      player: PlayerCandidate;
      reason: "nickname" | "typo";
    }
  | { kind: "ambiguous"; players: PlayerCandidate[] }
  | { kind: "none" };

interface MatchStrength {
  score: number;
  kind: "exact" | "nickname" | "typo";
}

const AMBIGUOUS_MARGIN = 0.02;

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanDisplayName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function levenshtein(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }

  if (right.length === 0) {
    return left.length;
  }

  const previous = new Array<number>(right.length + 1);
  const current = new Array<number>(right.length + 1);

  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;

    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost,
      );
    }

    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column] ?? 0;
    }
  }

  return previous[right.length] ?? 0;
}

function isTypo(query: string, candidate: string): boolean {
  if (!query || !candidate || query === candidate) {
    return false;
  }

  const shortest = Math.min(query.length, candidate.length);

  if (shortest < 3) {
    return false;
  }

  const distance = levenshtein(query, candidate);
  const longest = Math.max(query.length, candidate.length);
  const similarity = 1 - distance / longest;

  if (distance === 1) {
    return similarity >= 0.75;
  }

  return distance === 2 && longest >= 8 && similarity >= 0.8;
}

function matchStrength(query: string, candidateName: string): MatchStrength | null {
  const candidate = normalizeName(candidateName);

  if (!query || !candidate) {
    return null;
  }

  if (query === candidate) {
    return { score: 1, kind: "exact" };
  }

  const tokens = candidate.split(" ").filter(Boolean);
  const singleToken = !query.includes(" ");

  if (
    singleToken &&
    query.length >= 3 &&
    tokens.some((token) => token === query)
  ) {
    return { score: 0.93, kind: "nickname" };
  }

  const targets = singleToken ? [candidate, ...tokens] : [candidate];
  let bestSimilarity = 0;
  let typo = false;

  for (const target of targets) {
    if (!isTypo(query, target)) {
      continue;
    }

    typo = true;
    const distance = levenshtein(query, target);
    const similarity = 1 - distance / Math.max(query.length, target.length);
    bestSimilarity = Math.max(bestSimilarity, similarity);
  }

  if (!typo) {
    return null;
  }

  return { score: 0.8 + bestSimilarity * 0.08, kind: "typo" };
}

export function resolvePlayerName(
  query: string,
  players: PlayerCandidate[],
): PlayerResolution {
  const normalized = normalizeName(query);

  if (!normalized) {
    return { kind: "none" };
  }

  const ranked: Array<{ player: PlayerCandidate; match: MatchStrength }> = [];

  for (const player of players) {
    const match = matchStrength(normalized, player.name);

    if (match) {
      ranked.push({ player, match });
    }
  }

  ranked.sort(
    (left, right) =>
      right.match.score - left.match.score ||
      left.player.name.localeCompare(right.player.name),
  );

  const best = ranked[0];

  if (!best) {
    return { kind: "none" };
  }

  if (best.match.kind === "exact") {
    return { kind: "exact", player: best.player };
  }

  const contenders = ranked.filter(
    (entry) => best.match.score - entry.match.score <= AMBIGUOUS_MARGIN,
  );

  if (contenders.length > 1) {
    return {
      kind: "ambiguous",
      players: contenders.map((entry) => entry.player),
    };
  }

  return {
    kind: "similar",
    player: best.player,
    reason: best.match.kind === "nickname" ? "nickname" : "typo",
  };
}

export function playerCorrections(
  query: string,
  players: PlayerCandidate[],
): PlayerCandidate[] {
  const resolution = resolvePlayerName(query, players);

  if (resolution.kind === "ambiguous") {
    return resolution.players.slice(0, 3);
  }

  if (resolution.kind !== "similar") {
    return [];
  }

  const normalizedQuery = normalizeName(query);
  const completingExistingName =
    resolution.reason === "typo" &&
    normalizeName(resolution.player.name).startsWith(normalizedQuery);

  if (completingExistingName) {
    return [];
  }

  return [resolution.player];
}

export function searchPlayers(
  query: string,
  players: PlayerCandidate[],
): PlayerCandidate[] {
  const normalized = normalizeName(query);

  if (!normalized) {
    return [];
  }

  const ranked: Array<{ player: PlayerCandidate; score: number }> = [];

  for (const player of players) {
    const name = normalizeName(player.name);

    if (!name) {
      continue;
    }

    const tokens = name.split(" ").filter(Boolean);
    let score = 0;

    if (name === normalized) {
      score = 1;
    } else if (name.startsWith(normalized)) {
      score = 0.97;
    } else if (tokens.some((token) => token.startsWith(normalized))) {
      score = 0.95;
    } else if (name.includes(normalized)) {
      score = 0.9;
    }

    const strength = matchStrength(normalized, player.name);

    if (strength && strength.kind !== "exact") {
      score = Math.max(score, strength.score);
    }

    if (score > 0) {
      ranked.push({ player, score });
    }
  }

  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      left.player.name.localeCompare(right.player.name),
  );

  return ranked.slice(0, 6).map((entry) => entry.player);
}
